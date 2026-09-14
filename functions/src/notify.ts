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

import * as admin from "firebase-admin";
import {
  DEFAULT_LANG, normaliseLang, renderNotify, type NotifyLang,
} from "./notifyStrings";

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

const CAP = 200;

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
    .filter((u) => typeof u === "string" && u && u !== spec.createdBy)
    .slice(0, 50);
  if (targets.length === 0) return { rows: 0, pushed: 0, pruned: 0 };

  const snaps = await db.getAll(...targets.map((u) => db.doc(`users/${u}`)));
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
    batch.set(db.collection("notifications").doc(), {
      userId: r.uid,
      createdBy: spec.createdBy,
      type: spec.type,
      titleKey: spec.titleKey.slice(0, 60),
      ...(spec.titleParam ? { titleParam: spec.titleParam.slice(0, CAP) } : {}),
      ...(spec.bodyKey ? { bodyKey: spec.bodyKey.slice(0, 60) } : {}),
      ...(spec.param ? { param: spec.param.slice(0, CAP) } : {}),
      title: renderNotify(spec.titleKey, r.lang, spec.titleParam).slice(0, CAP),
      body: spec.bodyText
        ? spec.bodyText.slice(0, 500)
        : spec.bodyKey ? renderNotify(spec.bodyKey, r.lang, spec.param).slice(0, 500) : "",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  if (spec.push === false) return { rows: recipients.length, pushed: 0, pruned: 0 };

  // ── the push ───────────────────────────────────────────────────────────────
  //
  // Grouped by language, because the text is baked into the payload by the sender. One
  // multicast per language rather than one per person: a family is one or two languages.
  type Bucket = { tokens: string[]; owners: Map<string, string> };
  const byLang = new Map<NotifyLang, Bucket>();
  for (const r of recipients) {
    if (r.tokens.length === 0) continue;
    // The annotation is load-bearing: an inline `{ tokens: [] }` infers `never[]`, so the push
    // below is a type error rather than a list.
    const bucket: Bucket = byLang.get(r.lang) ?? { tokens: [], owners: new Map<string, string>() };
    for (const tok of r.tokens) {
      bucket.tokens.push(tok);
      bucket.owners.set(tok, r.uid);
    }
    byLang.set(r.lang, bucket);
  }

  let pushed = 0;
  const deadByUser = new Map<string, string[]>();

  for (const [lang, bucket] of byLang) {
    const tokens = [...new Set(bucket.tokens)];
    if (tokens.length === 0) continue;
    try {
      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: renderNotify(spec.titleKey, lang, spec.titleParam),
          body: spec.bodyText || (spec.bodyKey ? renderNotify(spec.bodyKey, lang, spec.param) : ""),
        },
        ...(spec.data ? { data: spec.data } : {}),
      });
      pushed += res.successCount;

      // The report every previous sender threw away.
      res.responses.forEach((r, i) => {
        if (r.success) return;
        const code = (r.error as { code?: string } | undefined)?.code || "";
        // ONLY these three mean the address itself is gone. Every other failure — a quota, a
        // timeout, a transient server error — must not cost somebody their token, or one bad
        // minute on Google's side would silently unsubscribe the whole family.
        if (code.includes("registration-token-not-registered") ||
            code.includes("invalid-registration-token") ||
            code.includes("invalid-argument")) {
          const owner = bucket.owners.get(tokens[i]);
          if (!owner) return;
          deadByUser.set(owner, [...(deadByUser.get(owner) ?? []), tokens[i]]);
        }
      });
    } catch (err) {
      // Never fail the caller: the thing being announced has already happened.
      console.error("notify: push failed for", lang, err);
    }
  }

  let pruned = 0;
  for (const [uid, dead] of deadByUser) {
    try {
      await db.doc(`users/${uid}`).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead),
      });
      pruned += dead.length;
    } catch (err) {
      console.error("notify: could not prune tokens for", uid, err);
    }
  }

  return { rows: recipients.length, pushed, pruned };
}

export { DEFAULT_LANG };
