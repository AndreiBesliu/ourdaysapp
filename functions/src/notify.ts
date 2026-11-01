// functions/src/notify.ts
// One way to tell somebody something.
//
// ── The problem this replaces ─────────────────────────────────────────────────────────
//
// There were two independent channels that did not agree about what was worth saying:
//
//   the `notifications` collection — the in-app bell. Written by four places. Correctly
//     translated, because it stores keys and the READER's client renders them.
//   FCM push — sent by four DIFFERENT places, none of which wrote a bell row, all of them in
//     hardcoded English, to everybody, in an app that ships in six languages.
//
// So a chat message pushed but left no trace in the bell; a friend request being accepted left a
// bell row and pushed nothing; and an invitation accepted did the same. Whether you found out
// depended on which of two unrelated code paths somebody had happened to wire.
//
// This is the single path. It writes the row AND sends the push, from one description of the
// event, in each recipient's own language.
//
// ── Dead tokens ──────────────────────────────────────────────────────────────────────
//
// Nothing in this codebase has ever pruned `fcmTokens`. `sendEachForMulticast` reports per-token
// failures and every send discarded that report, so the array only ever grew: a new browser, a
// reinstall, a cleared site — each adds one and none is ever removed. Every send then spends
// calls on addresses that can never arrive. Pruning happens here, once, for every caller.

import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_LANG, normaliseLang, renderNotify, type NotifyLang,
} from "./notifyStrings";
import { clampText } from "./pushText";
import { FCM_BATCH, SEND_THREW, codeWords, deadTokens, dryRunVerdict, unreachedCodes, type SendResult } from "./pushTokens";
import { isPlainDocId } from "./docId";
import { logServerError } from "./errorLog";

export interface NotifySpec {
  /** Who to tell. Deduped; `createdBy` is dropped — nobody is notified of their own action. */
  userIds: string[];
  /** Who caused it. */
  createdBy: string;
  /** Free-form category the client uses for the icon (`friend`, `event`, `game`, …). */
  type: string;
  titleKey: string;
  /** Appended to the title, like `param` is to the body. For a name in the heading. */
  titleParam?: string;
  /** Either a key to translate… */
  bodyKey?: string;
  /** …appended with this. */
  param?: string;
  /**
   * …or raw text that must NOT be translated, because it is the user's own words — a chat
   * message, an event title. Translating user content would be worse than leaving it English.
   */
  bodyText?: string;
  /** Skip the push and leave only a bell row. */
  push?: boolean;
  /** Extra key/values delivered with the push, for click routing. Values must be strings. */
  data?: Record<string, string>;
  /**
   * Keep `createdBy` among the recipients.
   *
   * The default drops the actor, and for almost everything that is right: you do not need to be
   * told about your own message. A broadcast is the exception — an admin announcing something
   * wants to see it land too, and, practically, until the day this was added the only account in
   * the system holding a push token was the admin's, so excluding it made the feature untestable.
   */
  includeActor?: boolean;
  /**
   * A title given as words rather than as a key — a broadcast is typed by a person, not chosen
   * from the dictionary. When set, the bell row is written WITHOUT `titleKey`: the dropdown
   * renders the key whenever one is present, so leaving it in would replace the admin's words
   * with a label. `titleKey` is then only a type-level requirement and is never written or shown.
   */
  titleText?: string;
  /**
   * One piece of news that may be sent again: a reminder that a later run takes over (reminders.ts).
   * The bell rows then get ids made from it and the recipient, so a second call rewrites them instead
   * of adding a second row. Without it, every call writes new rows, as before.
   */
  rowKey?: string;
}

export interface NotifyResult {
  rows: number;
  pushed: number;
  /** Dead tokens removed from `fcmTokens`. */
  pruned: number;
}

interface Recipient {
  uid: string;
  lang: NotifyLang;
  tokens: string[];
}

/** The longest title, in the bell AND in the push (pushText.ts says why the push needs one). */
const CAP = 200;
/** The longest body, likewise. */
const BODY_CAP = 500;

/** Where a tapped push opens. The project is fixed in .firebaserc; there is no runtime lookup for it. */
const APP_ORIGIN = "https://our-days-2a939.web.app";

/** Where a push is validated without being delivered (a dry run): no app subscribes to it. */
const PAYLOAD_CHECK_TOPIC = "payload-check";

/**
 * One document per person, `{ day, failures }`: the UTC day, and the failures (their codes, as the row
 * writes them) for which notify() has written an error row that day about a push that reached none of that
 * person's devices. Deleted with the account (accountDeletion.ts); no rule matches it.
 */
export const PUSH_UNREACHED = "push_unreached";

/**
 * Whether this is the first push today that reached none of `uid`'s devices for THIS failure: one row a
 * day per person and failure, the rest in Cloud Logging. A device that fails every push but is never proved
 * dead (an old web-push subscription refused for its credentials, say) would otherwise write a row for every
 * push its owner gets, every day, until it filled the Health panel (the review, 01.11.2026); a different
 * failure the same day still gets its row (the re-verification). Fail-open: a decision that cannot be made
 * writes the row, so one retry is all it is worth inside a reminders run.
 */
async function firstUnreachedToday(db: admin.firestore.Firestore, uid: string, failure: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const ref = db.doc(`${PUSH_UNREACHED}/${uid}`);
    const userRef = db.doc(`users/${uid}`);
    return await db.runTransaction(async (tx) => {
      const [mark, user] = await tx.getAll(ref, userRef);
      const marked = mark.get("failures");
      const seen = mark.get("day") === day && Array.isArray(marked) ? marked : [];
      if (seen.includes(failure)) return false;
      // Not for an account deleted meanwhile: the mark would outlive the deletion that removes it.
      if (user.exists) tx.set(ref, { day, failures: [...seen, failure].slice(-20) });
      return true;
    }, { maxAttempts: 2 });
  } catch {
    return true;
  }
}

/**
 * The bell row of `rowKey` for one recipient. A hash, so that no length or character of either part
 * can make it an invalid id: a reminder's recipients come from an event's assignees, which members write.
 */
const rowIdFor = (rowKey: string, uid: string): string =>
  createHash("sha256").update(rowKey).update("\u0000").update(uid).digest("hex");

/**
 * Tell people something, in their own language, through both channels.
 *
 * Deliberately NOT transactional. A caller already inside a transaction has done the thing that
 * matters — joined a group, accepted a request — and a failure to deliver news about it must not
 * roll that back. Call it after the transaction commits.
 */
export async function notify(spec: NotifySpec): Promise<NotifyResult> {
  const db = admin.firestore();

  const targets = [...new Set(spec.userIds)]
    // A uid is ONE path segment: it becomes `users/<it>` (docId.ts).
    .filter((u) => isPlainDocId(u) && (spec.includeActor || u !== spec.createdBy))
    .slice(0, 50);
  if (targets.length === 0) return { rows: 0, pushed: 0, pruned: 0 };

  // Only the two fields used, both bounded by the rules (17.10.2026): the rest of a user's document is
  // the owner's to fill, and fifty of them read whole, each with a list of a million nulls, ran the
  // reminders out of memory for everybody.
  const snaps = await db.getAll(...targets.map((u) => db.doc(`users/${u}`)), { fieldMask: ["language", "fcmTokens"] });
  const recipients: Recipient[] = snaps.map((s, i) => ({
    uid: targets[i],
    lang: normaliseLang(s.data()?.language),
    tokens: Array.isArray(s.data()?.fcmTokens)
      ? (s.data()!.fcmTokens as unknown[]).filter((t): t is string => typeof t === "string" && !!t)
      : [],
  }));

  // ── the bell row ───────────────────────────────────────────────────────────
  //
  // The keys are what a reader actually renders. The rendered strings are written too, but in the
  // RECIPIENT's language rather than the sender's — they are the fallback for a client too old to
  // know the key, and a fallback in the wrong language is how a Romanian account came to read one
  // English line among four Romanian ones.
  const batch = db.batch();
  for (const r of recipients) {
    const row = spec.rowKey
      ? db.collection("notifications").doc(rowIdFor(spec.rowKey, r.uid))
      : db.collection("notifications").doc();
    batch.set(row, {
      userId: r.uid,
      createdBy: spec.createdBy,
      type: spec.type,
      ...(spec.titleText ? {} : { titleKey: spec.titleKey.slice(0, 60) }),
      ...(spec.titleParam && !spec.titleText ? { titleParam: clampText(spec.titleParam, CAP) } : {}),
      ...(spec.bodyKey ? { bodyKey: spec.bodyKey.slice(0, 60) } : {}),
      ...(spec.param ? { param: clampText(spec.param, CAP) } : {}),
      title: titleFor(spec, r.lang),
      body: bodyFor(spec, r.lang),
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  if (spec.push === false) return { rows: recipients.length, pushed: 0, pruned: 0 };

  // ── the push ───────────────────────────────────────────────────────────────
  //
  // Grouped by language, because the text is baked into the payload by the sender. One
  // multicast per language rather than one per person: a family is one or two languages.
  // `owners`: EVERY account that lists a token. A shared device can leave one token in two (pushRelease.ts),
  // and a dead one must leave both, as the row about a push must not name only the last of them.
  type Bucket = { tokens: string[]; owners: Map<string, Set<string>>; uids: Set<string> };
  const byLang = new Map<NotifyLang, Bucket>();
  for (const r of recipients) {
    if (r.tokens.length === 0) continue;
    // The annotation is load-bearing: an inline `{ tokens: [] }` infers `never[]`, so the push
    // below is a type error rather than a list.
    const bucket: Bucket = byLang.get(r.lang)
      ?? { tokens: [], owners: new Map<string, Set<string>>(), uids: new Set<string>() };
    bucket.uids.add(r.uid);
    for (const tok of r.tokens) {
      bucket.tokens.push(tok);
      bucket.owners.set(tok, (bucket.owners.get(tok) ?? new Set<string>()).add(r.uid));
    }
    byLang.set(r.lang, bucket);
  }

  // One tag per call: the same notification reaching two subscriptions on one device collapses
  // into one entry instead of showing twice. Distinct calls get distinct tags, so two broadcasts a
  // minute apart both show. A tap opens the app at the route the caller asked for; before this,
  // a tap did nothing — the payload carried no link and the worker set none.
  const tag = `${spec.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const route = spec.data?.route;
  const link = APP_ORIGIN + (typeof route === "string" && route.startsWith("/") ? route : "/");

  let pushed = 0;
  const deadByUser = new Map<string, string[]>();

  for (const [lang, bucket] of byLang) {
    const tokens = [...new Set(bucket.tokens)];
    if (tokens.length === 0) continue;
    // One message for the whole bucket, built once: the dry run below must judge the very same one.
    const message = {
      notification: { title: titleFor(spec, lang), body: bodyFor(spec, lang) },
      // `tag` also rides in data so the page's foreground handler can use the same one.
      data: { ...(spec.data || {}), tag },
      webpush: {
        notification: { icon: "/icons.svg", tag },
        fcmOptions: { link },
      },
    };
    try {
      // In slices of what one call takes. Over 500 tokens a single call throws, and nobody in the bucket
      // got the push; the rules let one account hold 500. Every slice carries the same message, so the
      // verdict below still reads them all as one send. A slice that throws stands as failures that say
      // nothing, about the addresses or about the message.
      const results: SendResult[] = [];
      let threw: unknown = undefined;
      for (let i = 0; i < tokens.length; i += FCM_BATCH) {
        const slice = tokens.slice(i, i + FCM_BATCH);
        try {
          const res = await admin.messaging().sendEachForMulticast({ tokens: slice, ...message });
          pushed += res.successCount;
          results.push(...res.responses.map((r) => ({
            success: r.success,
            code: (r.error as { code?: string } | undefined)?.code,
          })));
        } catch (err) {
          console.error("notify: a push slice threw", spec.type, lang, slice.length, err);
          if (threw === undefined) threw = err ?? new Error("send failed");
          // A dropped HTTP/2 session (GOAWAY, a reset) rejects while the slice's requests may still finish;
          // firebase-admin hands their real outcome over as `pendingBatchResponse`
          // (FirebaseMessagingSessionError). Used only when it answers for every token of the slice.
          type Late = { responses?: Array<{ success: boolean; error?: unknown }> };
          const pending = (err as { pendingBatchResponse?: Promise<Late> } | null)?.pendingBatchResponse;
          const late = pending ? await Promise.resolve(pending).catch(() => null) : null;
          if (late && Array.isArray(late.responses) && late.responses.length === slice.length) {
            pushed += late.responses.filter((r) => r.success).length;
            results.push(...late.responses.map((r) => ({
              success: r.success,
              code: (r.error as { code?: string } | undefined)?.code,
            })));
          } else {
            results.push(...slice.map(() => ({ success: false, code: SEND_THREW })));
          }
        }
      }

      // The report every previous sender threw away. Only an answer about the ADDRESS costs somebody
      // their token. A quota, a timeout or a transient server error must not, or one bad minute on
      // Google's side would silently unsubscribe the whole family; nor may a refused MESSAGE, which
      // FCM reports with the same code as a malformed token (pushTokens.ts).
      let verdict = deadTokens(results);
      let reported = false;
      if (verdict.unproven) {
        // Nothing was delivered to say the message is fine. FCM validates it without delivering it
        // (`dryRun`), to a topic, which needs no subscriber and reaches nobody.
        // Through a resolved promise: the SDK throws its own validation synchronously, not as a rejection.
        const dryRun = await Promise.resolve()
          .then(() => admin.messaging().send({ topic: PAYLOAD_CHECK_TOPIC, ...message }, true))
          .then(() => undefined, (e: unknown) => e ?? new Error("dry run failed"));
        const said = dryRunVerdict(dryRun);
        if (said === "valid") {
          verdict = deadTokens(results, true);
        } else if (said === "refused") {
          // Nobody else hears about a push that reached no one: the caller never fails (see below).
          reported = true;
          await logServerError(
            `push "${spec.type}" refused for all ${tokens.length} tokens as invalid-argument, and a dry run ` +
              `of the same message too: ${String((dryRun as Error)?.message || dryRun).slice(0, 300)}; no token was removed`,
            "notify:push",
          );
        } else {
          console.error("notify: the message check said nothing; no token was removed", spec.type, dryRun);
        }
      }
      for (const i of verdict.dead) {
        for (const owner of bucket.owners.get(tokens[i]) ?? []) {
          deadByUser.set(owner, [...(deadByUser.get(owner) ?? []), tokens[i]]);
        }
      }

      // Reached nobody, and not because its addresses are gone: say so where somebody looks. One failure,
      // one group: the push's type and language go in the stack, which the panel's key leaves out. With
      // the person's uid when the bucket is one person's, and then once a day for them.
      const unreached = reported ? null : unreachedCodes(results, verdict.dead);
      if (unreached) {
        const one = bucket.uids.size === 1 ? [...bucket.uids][0] : null;
        const message = `push reached none of ${tokens.length} tokens: ${codeWords(unreached)}` +
          (threw === undefined ? "" : ` (${String((threw as Error)?.message || threw).slice(0, 300)})`);
        // A call that threw is not one person's device: it always gets its row (the daily cap bounds it).
        if (one !== null && threw === undefined && !(await firstUnreachedToday(db, one, codeWords(unreached)))) {
          console.error("notify:", message, spec.type, one);
        } else {
          await logServerError(message, "notify:push", {
            ...(one !== null ? { uid: one } : {}),
            stack: `push type: ${spec.type}, language: ${lang}`,
          });
        }
      }
    } catch (err) {
      // Never fail the caller: the thing being announced has already happened.
      console.error("notify: push failed for", lang, err);
    }
  }

  let pruned = 0;
  for (const [uid, dead] of deadByUser) {
    try {
      await db.doc(`users/${uid}`).update({
        fcmTokens: FieldValue.arrayRemove(...dead),
      });
      pruned += dead.length;
    } catch (err) {
      console.error("notify: could not prune tokens for", uid, err);
    }
  }

  return { rows: recipients.length, pushed, pruned };
}

/** The title one reader sees, cut like every title: the same text in the bell and in the push. */
function titleFor(spec: NotifySpec, lang: NotifyLang): string {
  return clampText(spec.titleText || renderNotify(spec.titleKey, lang, spec.titleParam), CAP);
}

/** The body one reader sees, likewise. */
function bodyFor(spec: NotifySpec, lang: NotifyLang): string {
  if (spec.bodyText) return clampText(spec.bodyText, BODY_CAP);
  return spec.bodyKey ? clampText(renderNotify(spec.bodyKey, lang, spec.param), BODY_CAP) : "";
}

export { DEFAULT_LANG };
