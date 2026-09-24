import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

import { GoogleGenAI } from "@google/genai";
import { applyCommand } from "./warlordCombat/combat/engine";
import { sanitizeDeploy, createPvpBattle } from "./warlordCombat/combat/pvp";
import type { BattleState, Command } from "./warlordCombat/combat/types";
import { deriveScope } from "./aiScope";
import { fetchAssets, fetchChat, fetchEvents, fetchExpenses } from "./aiSources";
import { dayRangePeriod, monthPeriod, periodDays, isRealDay } from "./period";
import {
  charsPerToken, estimateUsdFor, usageOf, withLedger, textOf,
  effectiveLimits, AI_CONFIG_PATH, AI_LIMITS, LIMITS_SOURCE, AI_MAX_OUTPUT_TOKENS,
} from "./aiLedger";
import { clampAiLimits, configChangeAllowed, type AiConfigFields } from "./aiLimits";
import { changedOutsideAdmin } from "./aiConfigProvenance";
import { mergeRollups } from "./aiSpendMerge";
import { readFriendship, authIdentityOf } from "./friendship";
import { senderStamp, stampedGroupName, trustedEmail } from "./senderIdentity";
import { overrideRsvps } from "./overrideRsvps";
import { notify } from "./notify";
import { groupErrors, fingerprint } from "./errorGrouping";
import { fixFor, fixVerdict } from "./errorFixes";
import {
  ERROR_STATUSES, STATUS_RANK, groupDocId, isErrorStatus, joinState,
} from "./errorState";
import { AI_QUOTA_CODE, isProviderQuotaError, isOwnBudgetRefusal } from "./aiProviderError";
import {
  checklistFailure, checklistReason, refundsQuota,
  CHECKLIST_QUOTA, CHECKLIST_UNCONFIGURED, CHECKLIST_BAD_OUTPUT, CHECKLIST_ERROR,
} from "./aiChecklistOutcome";
import { spanProblem } from "./eventTime";
import type { EventDoc } from "./recurrenceServer";
import {
  digestWindow, digestEventLines, DIGEST_EVENT_SCAN, DIGEST_RECURRING_SCAN,
} from "./digestEvents";
import { transferredCopy } from "./assetTransfer";

// Invite links live in their own module — index.ts is already long, and these four are a
// self-contained feature. Re-exported here because Firebase deploys what index exports.
// They call `admin.firestore()` only inside their handlers, so the initializeApp() below
// has always run by the time one of them executes.
export {
  createGroupInviteLink, peekGroupInviteLink, redeemGroupInviteLink,
  revokeGroupInviteLink, listMyInviteLinks,
} from "./inviteLinks";
export { openDirectChat, onDirectMessageCreated } from "./directChat";
export { sendDueReminders } from "./reminders";
// A daily copy of the health panel into the function logs, which the CLI can read without a
// key — see functions/src/errorDigest.ts for why that gap was worth closing.
export { logErrorDigest } from "./errorDigest";
// Closes arcade sessions nobody came back to. The 24-hour rule is Andrei's, 16.09.2026; the
// decision itself lives in gameSession.ts, byte-identical to the copy the app uses for its End
// button, so a person and the clock close a game the same way.
export { expireIdleGames } from "./games";

admin.initializeApp();

// App Check enforcement is toggled via env so it can be switched on AFTER the
// reCAPTCHA key is registered and verified in monitor mode in the Firebase
// Console — avoids locking out clients that aren't yet sending tokens. Set
// APPCHECK_ENFORCE=true (functions env) to require valid App Check tokens.
const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";

// Require a signed-in caller and apply a basic per-user daily quota on the AI
// callables to curb abuse / runaway Gemini cost. The `ai_usage` collection is
// written only by the Admin SDK here (clients have no matching rule → denied).
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 50);
const NOTIF_DAILY_LIMIT = Number(process.env.NOTIF_DAILY_LIMIT || 100);
// The visibility preview gets its OWN bucket. Five callables already share `ai_usage`, so a
// preview drawing on it would starve the checklist and the category suggestion.
const AI_PREVIEW_DAILY_LIMIT = Number(process.env.AI_PREVIEW_DAILY_LIMIT || 60);
// The user picks the period, so the user picks the input size. This is the first bound.
const AI_MAX_PERIOD_DAYS = Number(process.env.AI_MAX_PERIOD_DAYS || 400);
// Documents one turn may read, distributed as `limit()` values BEFORE any read — you do not
// pay Firestore to fetch a corpus you are then going to throw away at the token ceiling.
const AI_DOC_BUDGET = Number(process.env.AI_DOC_BUDGET || 600);
// One place for the model id, so the ledger's `model` column and the call can never disagree.
// Gemini 3.8 Flash: the newest STABLE model in the Gemini 3 Flash line.
//
// Andrei asked for "Gemini 3 Flash" after seeing `gemini-3-flash-preview` in AI Studio. That one is
// the preview of the original 3 Flash and has since been superseded by stable releases in the same
// family — and it is cheaper to run 3.8 than 3.5, so the newest is also not the dearest. A preview
// model can change under you or be withdrawn; this sits on five paths a family actually uses.
const AI_MODEL = "gemini-3.8-flash";
const WARLORD_CHALLENGE_DAILY_LIMIT = Number(process.env.WARLORD_CHALLENGE_DAILY_LIMIT || 30);
// A battle where the opponent simply stops playing would otherwise lock the units
// staked in it forever (they are excluded from new deployments). After this many hours
// of no move, the waiting player may claim the win.
const WARLORD_TURN_TIMEOUT_HOURS = Number(process.env.WARLORD_TURN_TIMEOUT_HOURS || 24);

// Admin backend access. Source of truth = the `admins/{uid}` collection (locked
// to clients; only the Admin SDK writes it). A VERIFIED email in this bootstrap
// list is auto-granted admin on first admin call (so the owner works out of the
// box, no script) — verification required to block email-squatting.
const BOOTSTRAP_ADMIN_EMAILS = ["besliandrei@gmail.com"];

// Per-user, per-day quota counter (admin-only `*_usage` collections — clients
// have no matching rule → denied). Returns true if within today's limit (and
// records the use), false if over. Shared by the AI callables, the AI trigger,
// and notification fan-out.
async function tryConsumeQuota(uid: string, collection: string, limit: number): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const ref = admin.firestore().doc(`${collection}/${uid}`);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    const count = data && data.date === today ? (data.count || 0) : 0;
    if (count >= limit) return false;
    tx.set(ref, { date: today, count: count + 1 }, { merge: true });
    return true;
  });
}

/**
 * Give back a quota unit taken by `tryConsumeQuota`.
 *
 * The daily CALL quota is consumed at the door, before the budget is even consulted — so a call
 * the budget refuses still burned one of the caller's fifty. Press the kill switch and a person
 * retrying a few times is locked out for the rest of the day AFTER it is lifted, for calls that
 * never reached the model and cost nothing.
 *
 * Only ever decrements the counter for TODAY, and never below zero: a refund for a day that has
 * already rolled over would hand back an allowance nobody spent.
 */
async function releaseQuota(uid: string, kind: string): Promise<void> {
  const db = admin.firestore();
  const ref = db.doc(`${kind}/${uid}`);
  const today = new Date().toISOString().slice(0, 10);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : {};
    if (d.date !== today) return;
    const count = typeof d.count === "number" && d.count > 0 ? d.count : 0;
    if (count === 0) return;
    tx.set(ref, { date: today, count: count - 1 }, { merge: true });
  });
}

// AI callables: require auth + enforce the shared daily AI quota.
async function assertAiCallerAllowed(request: { auth?: { uid?: string } }): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use AI features.");
  }
  if (!(await tryConsumeQuota(uid, "ai_usage", AI_DAILY_LIMIT))) {
    throw new HttpsError("resource-exhausted", "Daily AI limit reached. Please try again tomorrow.");
  }
  return uid;
}

// Admin gate for the admin-backend callables. Admin if `admins/{uid}` exists, or
// the caller's VERIFIED email is in BOOTSTRAP_ADMIN_EMAILS (auto-provisioned into
// `admins/{uid}` on first use so they appear in the admins list). Returns the uid.
async function assertAdmin(request: { auth?: { uid?: string; token?: any } }): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const db = admin.firestore();
  const adminRef = db.doc(`admins/${uid}`);
  const snap = await adminRef.get();
  if (snap.exists) return uid;

  const email = (request.auth?.token?.email || "").toLowerCase();
  const emailVerified = request.auth?.token?.email_verified === true;
  if (emailVerified && BOOTSTRAP_ADMIN_EMAILS.includes(email)) {
    // Auto-provision the bootstrap owner so they show up in the admins list.
    await adminRef.set({
      email,
      name: request.auth?.token?.name || email.split("@")[0],
      addedBy: "bootstrap",
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return uid;
  }
  throw new HttpsError("permission-denied", "Admin access required.");
}

// Whether `uid` is a member of the given group.
async function userInGroup(uid: string, groupId: string): Promise<boolean> {
  if (!groupId) return false;
  const snap = await admin.firestore().doc(`groups/${groupId}`).get();
  const members = snap.exists ? snap.data()?.members : undefined;
  return Array.isArray(members) && members.includes(uid);
}

// Whether `a` and `b` share at least one group.
async function usersShareGroup(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const snap = await admin.firestore().collection("groups").where("members", "array-contains", a).get();
  return snap.docs.some((d) => (d.data().members || []).includes(b));
}



// Stop an event advertising AI work that will never run — and say WHY it will not run.
//
// `onDocumentCreated` fires ONCE per document, so every bad ending here is permanent: there is no
// second attempt for this event, ever. The two endings it used to have both lied about that.
//
//   STRIP — the catch and the non-array branch removed `ai_assistant` and nothing else. The screen
//     draws its "generating checklist…" skeleton exactly while that id is present, so the skeleton
//     vanished and an empty checklist was left. Indistinguishable from the AI having looked and
//     found nothing worth adding.
//   STICK — the daily-quota branch and the missing-key branch returned without touching anything.
//     The id stayed, so the skeleton spun FOREVER: every open of that event, for the rest of its
//     life, claimed a checklist was being generated.
//
// Now there is one ending. The reason is written onto the event, the screen says it in the
// reader's language, and it offers Retry — through `generateAIChecklist`, which already exists, so
// a retry faces the same auth, quota and budget the trigger faced. That is the retry story: not
// the trigger firing again, which it cannot, but the person choosing to.
async function recordChecklistOutcome(
  snapshot: { ref: FirebaseFirestore.DocumentReference },
  data: FirebaseFirestore.DocumentData,
  reason: string,
): Promise<void> {
  try {
    await snapshot.ref.update({
      // Removed in every case: an assignee advertising work that can never run is the STICK
      // ending, and it is the thing this whole path exists to stop.
      //
      // `arrayRemove` rather than a filtered copy of the create-time array, for the same reason
      // the success path uses it: `data` is seconds old by now, and writing it back would
      // un-assign anybody added while the model was being asked.
      assigneeIds: admin.firestore.FieldValue.arrayRemove("ai_assistant"),
      aiChecklist: { status: "failed", reason, at: new Date().toISOString() },
    });
  } catch (err) {
    // Best effort by design: this runs on failure paths, where another write may also fail. But
    // "best effort" was being spent on `console.error` alone, and this is the ONLY thing that ends
    // the trigger's failure path — so when it failed, the event kept `ai_assistant`, the skeleton
    // spun forever, no reason was written, and nothing anywhere recorded that it had happened.
    // The STICK ending, restored by the very function written to abolish it.
    //
    // It goes in the health panel because, unlike the conditions this function RECORDS, a failure
    // to record is not an operating condition: there is no burst, and there is something to fix.
    console.error("could not record the checklist outcome", (err as any)?.message || err);
    void logServerError(
      `could not record the checklist outcome (${reason}): ${(err as any)?.message || err}`,
      "ai:generateChecklist",
      { uid: typeof data?.ownerId === "string" ? data.ownerId : undefined },
    );
  }
}

/**
 * The generation itself: it either writes the checklist, or it THROWS.
 *
 * There is deliberately no `return` in this body. A `return` is how both of the old endings
 * happened — a branch decided to stop and told nobody, and because the caller could not tell that
 * apart from success, the event was left claiming work that was never going to run. Every stop in
 * here is a throw carrying a reason, so the one catch in the caller is the only ending there is.
 */
async function runAutoChecklist(
  snapshot: { ref: FirebaseFirestore.DocumentReference },
  data: FirebaseFirestore.DocumentData,
  ownerId: string | undefined,
): Promise<void> {
  const title = data.title;
  const description = data.description || "";

  const key = process.env.GEMINI_API_KEY_LOCAL;
  if (!key) throw checklistFailure(CHECKLIST_UNCONFIGURED);
  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = `You are a helpful AI Assistant for a family organization app.
The user created a task/event titled "${title}".
${description ? `The description is: "${description}".` : ""}

IMPORTANT: Analyze the language used in the title and description above. You MUST write the entire checklist translated into that exact same language.

If this looks like a Grocery or Shopping list, generate a checklist grouped by supermarket aisles (e.g., "Dairy: Milk", "Produce: Apples").
Otherwise, generate a checklist of 3 to 7 actionable, brief steps or items needed to complete this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Dairy: Milk", "Produce: Apples", "Bakery: Bread"] or ["Step 1", "Step 2"]`;

  const result = await withLedger(
    { feature: 'auto-checklist', model: AI_MODEL, uid: ownerId || 'system' },
    estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(ownerId || 'system')),
    // `maxOutputTokens` is what makes the pessimistic hold honest: `estimateUsdFor` prices
    // the output at this ceiling, and without it nothing stopped a response from exceeding it.
    () => ai.models.generateContent({
      model: AI_MODEL, contents: prompt,
      config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
    }),
    usageOf,
    prompt.length,
  );
  const text = textOf(result);
  const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const list = JSON.parse(cleanText);

  // `JSON.parse` succeeds for `{"items":[...]}`, so this is not the catch's business — and it used
  // to be the path that simply fell off the end. The call was already PAID FOR: the ledger row
  // closed ok, the hold settled, and one of the owner's fifty was spent.
  if (!Array.isArray(list)) throw checklistFailure(CHECKLIST_BAD_OUTPUT);

  const newItems = list.map((itemText) => ({
    id: Date.now().toString() + Math.random().toString().slice(2, 6),
    text: String(itemText),
    isCompleted: false,
    assetUrl: null,
    assetId: null
  }));

  // ATOMIC, because `data` is the document as it was CREATED and the model has been thinking
  // for several seconds since. Writing whole arrays computed from it reverts anything that
  // happened meanwhile: a checklist item somebody typed while the skeleton spun would vanish the
  // moment the AI answered, and a person assigned in those seconds would be un-assigned. Neither
  // failure leaves a trace — the work is simply gone, replaced by an older copy of itself.
  //
  // `arrayUnion` appends without reading, and each item carries a fresh id so none collide.
  // `arrayRemove` takes out exactly the one value that needs to go.
  await snapshot.ref.update({
    checklistItems: admin.firestore.FieldValue.arrayUnion(...newItems),
    // Removed because the work is DONE, which is the one ending that needs no explanation.
    assigneeIds: admin.firestore.FieldValue.arrayRemove("ai_assistant"),
  });
  console.log(`Successfully generated checklist for: ${title}`);
}

export const autoSuggestChecklist = onDocumentCreated({
  document: "events/{eventId}"
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();

  // Not ours: the only two returns left, and both are "this trigger has no job here" rather than
  // "the job failed". Nothing has been promised to anybody at this point.
  if (!data.assigneeIds || !data.assigneeIds.includes("ai_assistant")) {
    return;
  }

  const ownerId = data.ownerId;
  try {
    // Rate-limited by the event owner, sharing the same daily allowance as the callables —
    // otherwise this is a free path to spam Gemini by creating events with the assignee.
    if (ownerId && !(await tryConsumeQuota(ownerId, "ai_usage", AI_DAILY_LIMIT))) {
      throw checklistFailure(CHECKLIST_QUOTA);
    }
    await runAutoChecklist(snapshot, data, ownerId);
  } catch (error) {
    const reason = checklistReason(error);

    // The fifth site. `releaseQuota` was added to the four CALLABLES that recognise our own budget
    // refusal; this one was missed, because a trigger throws to nobody and so had no refusal
    // branch at all. Same fact applies: nothing reached the model, so nothing may be charged.
    if (refundsQuota(reason) && ownerId) {
      await releaseQuota(ownerId, "ai_usage").catch(() => undefined);
    }

    // What belongs in the health panel, and what would bury it.
    //
    // A model that answers with the wrong SHAPE is a defect worth a row. Everything else here is
    // an operating condition that arrives in bursts — a spent budget, a pressed kill switch, a
    // rationing provider, a service with no key — and each one fires per event created, which a
    // person controls. Seventy-four of ninety-five rows in that panel were once a single such
    // condition, with every real bug underneath it.
    if (reason === CHECKLIST_ERROR || reason === CHECKLIST_BAD_OUTPUT) {
      console.error("AI Generation Error", error);
      void logServerError(
        reason === CHECKLIST_BAD_OUTPUT
          ? "model returned a non-array checklist"
          : ((error as any)?.message || "AI generation error"),
        "ai:generateChecklist",
        { stack: (error as any)?.stack, uid: ownerId },
      );
    } else {
      console.log(`auto-checklist stopped for ${ownerId || "unknown"}: ${reason}`);
    }

    await recordChecklistOutcome(snapshot, data, reason);
  }
});

export const onMessageCreated = onDocumentCreated("groups/{groupId}/messages/{messageId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const msgData = snapshot.data();
  const senderId = msgData.senderId;
  const groupId = event.params.groupId;

  try {
    const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
    if (!groupDoc.exists) return;
    const groupData = groupDoc.data();
    if (!groupData) return;

    const members = groupData.members || [];
    const targetUserIds = members.filter((id: string) => id !== senderId);
    
    if (targetUserIds.length === 0) return;

    const senderDoc = await admin.firestore().doc(`users/${senderId}`).get();
    const senderName = senderDoc.data()?.name || senderDoc.data()?.email?.split('@')[0] || "Someone";

    // The conversation list sorts groups and direct chats together, so a group needs the same
    // preview a chat keeps. Server-written for the same reason: a client-writable preview is a
    // way to put words into somebody else's list.
    await admin.firestore().doc(`groups/${groupId}`).set({
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageText: typeof msgData.text === "string" && msgData.text
        ? msgData.text.slice(0, 140)
        : msgData.imageUrl ? "\u{1F4F7}" : msgData.audioUrl ? "\u{1F3A4}" : "",
      lastMessageBy: senderId,
    }, { merge: true });

    // The message TEXT is passed as `bodyText`, never as a key: it is the sender's own words,
    // and translating them would be worse than leaving them alone. Only the wrapper around it —
    // "New message from …" — is rendered in the reader's language.
    await notify({
      userIds: targetUserIds,
      createdBy: senderId,
      type: "chat",
      titleKey: "notifNewMessage",
      titleParam: senderName,
      ...(msgData.text
        ? { bodyText: String(msgData.text) }
        : { bodyKey: msgData.imageUrl ? "notifSentImage" : "notifSentMessage" }),
      data: { route: "/", groupId: String(groupId || "") },
    });
  } catch (error) {
    console.error("Error sending FCM payload:", error);
  }
});

// A friend request used to notify NOTHING — no push, no bell row. You found out by opening the
// Friends screen and noticing a badge. Requests are created client-side with `addDoc`, so this is
// where the news belongs.
export const onFriendRequestCreated = onDocumentCreated("friend_requests/{requestId}", async (event) => {
  const fr = event.data?.data();
  if (!fr) return;

  const fromId = typeof fr.fromId === "string" ? fr.fromId : "";
  if (!fromId) return;

  // WHO sent it, from sources the sender cannot write — stamped before anything below can
  // return early, since the recipient's screen shows this and nothing else. See senderIdentity.ts.
  let stampName = "";
  try {
    const [identity, prof] = await Promise.all([
      authIdentityOf(fromId), admin.firestore().doc(`profiles/${fromId}`).get(),
    ]);
    const sender = senderStamp({
      authEmail: identity.email, authVerified: identity.verified, profileName: prof.data()?.name,
    });
    stampName = sender.name;
    await event.data!.ref.update({ sender });
  } catch (err) {
    // Fires once; a failure is permanent. The screen then says it could not confirm the sender,
    // which is the honest answer — and this makes the failure visible to the owner.
    void logServerError(`friend-request sender stamp failed: ${String(err)}`, "friends:stamp", { uid: fromId });
  }

  try {

    // Two ways a request is addressed, and the common one is the second.
    //
    //   toId   — one tap from a group member's row. Direct.
    //   toEmail — typing an address on the Friends screen, which is how you add somebody who is
    //     not already in a group with you. This is the path most requests take, and the first
    //     version of this trigger did not cover it.
    //
    // Resolving the address to an account leaks nothing: the notification goes to the account
    // holder, and the SENDER is told nothing either way — they cannot learn from this whether the
    // address is registered. If it belongs to no account there is simply nobody to tell; the
    // pending request is waiting on the Friends screen when that person does sign up.
    let toId = typeof fr.toId === "string" ? fr.toId : "";
    if (!toId && typeof fr.toEmail === "string" && fr.toEmail) {
      try {
        toId = (await admin.auth().getUserByEmail(fr.toEmail)).uid;
      } catch {
        return; // no account with that address yet
      }
    }
    if (!toId || toId === fromId) return;

    // A bell and a push, to any uid, as many times as you like.
    //
    // `friend_requests` create constrains `fromId` and `status` and nothing else: `toId` is free,
    // there is no relationship test, no dedupe and no ceiling. So one account could deliver an
    // unlimited stream of notifications to anybody — uids are public — with the text under its
    // own control through the sender name. The ROW is harmless; this fan-out is the megaphone.
    //
    // The same shape `notifyUsers` already uses (`notif_usage/{uid}`, 100 a day), sharing the very
    // same counter so the two cannot be combined to double it. A refusal stops the NOTIFICATION,
    // never the request: it still appears on the recipient's Friends screen when they look, which
    // is where a genuine request is answered anyway.
    if (!(await tryConsumeQuota(fromId, "notif_usage", NOTIF_DAILY_LIMIT))) {
      // The shared constant, not a second literal 100. `notifyUsers` already reads it from the
      // environment, so a hardcoded twin here would silently ignore any change the owner makes
      // and put the two features on different ceilings while sharing one counter.
      //
      // Reported, not merely logged: a bell that stopped ringing is otherwise indistinguishable
      // from a bell nobody rang, and this is the one path where a person's request reaches
      // somebody without a notification to announce it.
      void logServerError(
        `friend-request notification suppressed: daily limit ${NOTIF_DAILY_LIMIT} reached`,
        "friends:notifyQuota",
        { uid: fromId },
      );
      return;
    }

    // The stamp's name: the profile name, else the Auth email's local part. It used to fall back on
    // the request's own `fromEmail`, which the sender writes — so the push on somebody else's
    // phone could say anything they liked. Clamped inside senderStamp.
    const senderName = stampName || "Someone";

    await notify({
      userIds: [toId],
      createdBy: fromId,
      type: "friend",
      titleKey: "notifFriendRequest",
      bodyKey: "notifFriendRequestBody",
      param: senderName,
      data: { route: "/friends" },
    });
  } catch (err) {
    console.error("onFriendRequestCreated: could not notify", err);
  }
});

// The same stamp for a group invitation, plus the group's REAL name. The person invited is not a
// member yet, so the rules do not let their client read the group — the server can. Before this,
// their screen showed the `groupName` and `fromEmail` the sender typed. See senderIdentity.ts.
export const onGroupInviteCreated = onDocumentCreated("group_invites/{inviteId}", async (event) => {
  const inv = event.data?.data();
  if (!inv) return;
  const fromId = typeof inv.fromId === "string" ? inv.fromId : "";
  if (!fromId) return;
  try {
    const db = admin.firestore();
    const groupId = typeof inv.groupId === "string" && inv.groupId ? inv.groupId : "";
    const [identity, prof, group] = await Promise.all([
      authIdentityOf(fromId),
      db.doc(`profiles/${fromId}`).get(),
      groupId ? db.doc(`groups/${groupId}`).get() : Promise.resolve(null),
    ]);
    const sender = senderStamp({
      authEmail: identity.email, authVerified: identity.verified, profileName: prof.data()?.name,
    });
    const verifiedGroupName = group && group.exists ? stampedGroupName(group.data()?.name) : null;
    await event.data!.ref.update(verifiedGroupName ? { sender, verifiedGroupName } : { sender });
  } catch (err) {
    // Fires once. The screen then says it could not confirm the sender — the honest answer.
    void logServerError(`group-invite sender stamp failed: ${String(err)}`, "invites:stamp", { uid: fromId });
  }
});

export const onGameCreated = onDocumentCreated("games/{gameId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const gameData = snapshot.data();
  const creatorId = gameData.createdBy;
  const groupId = gameData.groupId;
  const gameType = gameData.gameType || "a game";

  if (!groupId || !creatorId) return;

  try {
    const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
    if (!groupDoc.exists) return;
    const groupData = groupDoc.data();
    if (!groupData) return;

    const members = groupData.members || [];
    const targetUserIds = members.filter((id: string) => id !== creatorId);
    
    if (targetUserIds.length === 0) return;

    const creatorDoc = await admin.firestore().doc(`users/${creatorId}`).get();
    const creatorName = creatorDoc.data()?.name || creatorDoc.data()?.email?.split('@')[0] || "Someone";

    const readableGameType = gameType.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    // The game's NAME is a proper noun and stays as it is; the sentence around it is translated.
    // The group name is dropped from the title deliberately — the renderer appends one parameter
    // at the end, and "which game" is the more useful half on a lock screen than "which group".
    await notify({
      userIds: targetUserIds,
      createdBy: creatorId,
      type: "game",
      titleKey: "notifNewGame",
      titleParam: readableGameType,
      bodyKey: "notifNewGameBody",
      param: creatorName,
      data: { route: "/", groupId: String(groupId || "") },
    });
  } catch (error) {
    console.error("Error sending Game Invite FCM:", error);
  }
});

export const generateAIChecklist = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { title, description, language = 'en-US' } = request.data;
  if (!title) {
    throw new HttpsError('invalid-argument', 'Title is required.');
  }
  const callerUid = await assertAiCallerAllowed(request);

  try {
    const key = process.env.GEMINI_API_KEY_LOCAL;
    if (!key) {
      // Nothing reached the model — there is no model to reach. The unit was taken at the door
      // by `assertAiCallerAllowed`, so without this a service with no API key silently eats one
      // of the caller's fifty per attempt, and a misconfiguration nobody can see from the app
      // burns the whole day's allowance for free. Fixed in the trigger first; these four were
      // the same bug and were missed.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }
    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are a helpful AI Assistant for a family organization app. 
The user is creating a task/event titled "${title}".
${description ? `The description is: "${description}".` : ""}

IMPORTANT: You MUST write the entire checklist translated into this exact language locale: "${language}".

If this looks like a Grocery or Shopping list, generate a checklist grouped by supermarket aisles (e.g., "Dairy: Milk", "Produce: Apples").
Otherwise, generate a checklist of 3 to 7 actionable, brief steps or items needed to complete this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Dairy: Milk", "Produce: Apples", "Bakery: Bread"] or ["Step 1", "Step 2"]`;

    const result = await withLedger(
      { feature: 'checklist', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      // `maxOutputTokens` is what makes the pessimistic hold honest: `estimateUsdFor` prices
      // the output at this ceiling, and without it nothing stopped a response from exceeding it.
      () => ai.models.generateContent({
        model: AI_MODEL, contents: prompt,
        config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
      }),
      usageOf,
      prompt.length,
    );
    const text = textOf(result);
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const list = JSON.parse(cleanText);

    if (Array.isArray(list)) {
      return { suggestions: list.map(String) };
    }
    return { suggestions: [] };
  } catch (error: any) {
    console.error("AI Generation Error", error);
    // The provider rationing us is not a defect: no bad input, no bad state, nothing to fix.
    // `withLedger` already writes a row per call with the uid, the feature and the code, so the
    // fact is kept — and keeping it OUT of errorLogs is the point. Seventy-four of the ~95 rows
    // in the health panel were this one thing, and the panel sorts by count, so every real bug
    // in the app sat underneath it.
    // A refusal WE made is not an error. Re-thrown with its own code so the client can say which,
    // and kept out of errorLogs for the same reason provider quota was: it would bury every real
    // bug under itself, in bursts, exactly when the panel is needed.
    if (isOwnBudgetRefusal(error)) {
      // Nothing reached the model, so the call must not cost the caller one of their fifty.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('resource-exhausted', (error as any).message);
    }
    if (isProviderQuotaError(error)) throw new HttpsError('resource-exhausted', AI_QUOTA_CODE);
    void logServerError((error as any)?.message || "AI generation error", "ai:generateChecklist", { stack: (error as any)?.stack, uid: callerUid });
    throw new HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
  }
});

export const suggestEventCategory = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { title, description } = request.data;
  if (!title) {
    throw new HttpsError('invalid-argument', 'Title is required.');
  }
  const callerUid = await assertAiCallerAllowed(request);

  try {
    const key = process.env.GEMINI_API_KEY_LOCAL;
    if (!key) {
      // Nothing reached the model — there is no model to reach. The unit was taken at the door
      // by `assertAiCallerAllowed`, so without this a service with no API key silently eats one
      // of the caller's fifty per attempt, and a misconfiguration nobody can see from the app
      // burns the whole day's allowance for free. Fixed in the trigger first; these four were
      // the same bug and were missed.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }
    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are a helpful AI Assistant. Given an event title and optional description, categorize it into exactly one of the following category IDs: "work", "family_time", "chores", "health", "other".
Title: "${title}"
${description ? `Description: "${description}"` : ""}

Return ONLY the category ID string, nothing else. No markdown formatting.`;

    const result = await withLedger(
      { feature: 'category', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      // `maxOutputTokens` is what makes the pessimistic hold honest: `estimateUsdFor` prices
      // the output at this ceiling, and without it nothing stopped a response from exceeding it.
      () => ai.models.generateContent({
        model: AI_MODEL, contents: prompt,
        config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
      }),
      usageOf,
      prompt.length,
    );
    const text = textOf(result).trim().toLowerCase();
    
    const validCategories = ["work", "family_time", "chores", "health", "other"];
    const matchedCategory = validCategories.find(c => text.includes(c)) || "other";

    return { categoryId: matchedCategory };
  } catch (error: any) {
    console.error("AI Category Suggestion Error", error);
    // The provider rationing us is not a defect: no bad input, no bad state, nothing to fix.
    // `withLedger` already writes a row per call with the uid, the feature and the code, so the
    // fact is kept — and keeping it OUT of errorLogs is the point. Seventy-four of the ~95 rows
    // in the health panel were this one thing, and the panel sorts by count, so every real bug
    // in the app sat underneath it.
    // A refusal WE made is not an error. Re-thrown with its own code so the client can say which,
    // and kept out of errorLogs for the same reason provider quota was: it would bury every real
    // bug under itself, in bursts, exactly when the panel is needed.
    if (isOwnBudgetRefusal(error)) {
      // Nothing reached the model, so the call must not cost the caller one of their fifty.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('resource-exhausted', (error as any).message);
    }
    if (isProviderQuotaError(error)) throw new HttpsError('resource-exhausted', AI_QUOTA_CODE);
    void logServerError((error as any)?.message || "AI category error", "ai:suggestCategory", { stack: (error as any)?.stack, uid: callerUid });
    throw new HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
  }
});

export const generateGroupDigest = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { groupId, language = 'en-US' } = request.data;
  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required.');
  }
  const callerUid = await assertAiCallerAllowed(request);

  // MEMBERSHIP. This was missing, and its absence was not a rules gap — everything below
  // reads through the Admin SDK, which ignores firestore.rules entirely. So any signed-in
  // account that knew or guessed a group id received an AI-written summary of that group's
  // private chat. `assertAiCallerAllowed` only proves who you are and that you have quota
  // left; it says nothing about what you may read.
  if (!(await userInGroup(callerUid, groupId))) {
    throw new HttpsError('permission-denied', 'You are not a member of that group.');
  }

  try {
    const key = process.env.GEMINI_API_KEY_LOCAL;
    if (!key) {
      // Nothing reached the model — there is no model to reach. The unit was taken at the door
      // by `assertAiCallerAllowed`, so without this a service with no API key silently eats one
      // of the caller's fifty per attempt, and a misconfiguration nobody can see from the app
      // burns the whole day's allowance for free. Fixed in the trigger first; these four were
      // the same bug and were missed.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }

    const db = admin.firestore();
    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupName = groupDoc.exists ? (groupDoc.data()?.name || "The Group") : "The Group";

    // Get messages from last 48 hours
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    
    // DESC, then reversed. It was `asc` with `limit(50)`, so once a group passed fifty messages
    // in the window the survivors were the OLDEST ones — while the prompt below still asked the
    // model to highlight what happened recently. A busy day produced a digest of the day before.
    const messagesSnapshot = await db.collection(`groups/${groupId}/messages`)
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(pastDate))
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const messageDocs = messagesSnapshot.docs.slice().reverse();
    const digestTruncated = messagesSnapshot.size >= 50;

    // Names come from `profiles`, not `users`. The Admin SDK ignores the rules, and `users` is
    // owner-only — so reading a name from there put data into the answer that the caller has no
    // path to see anywhere else, and the old `email.split('@')[0]` fallback leaked an address.
    //
    // Resolved in ONE pass rather than a `get()` per message inside the loop: fifty sequential
    // round trips is fifty times the latency for a value that repeats.
    const senderIds = Array.from(new Set(
      messageDocs.map((d) => d.data().senderId).filter((x): x is string => typeof x === "string"),
    ));
    const senderNames = new Map<string, string>();
    await Promise.all(chunk(senderIds, 30).map(async (ids) => {
      const snaps = await Promise.all(ids.map((id) => db.doc(`profiles/${id}`).get().catch(() => null)));
      snaps.forEach((snap, i) => {
        const name = snap && snap.exists ? snap.data()?.name : null;
        senderNames.set(ids[i], typeof name === "string" && name ? name : "Someone");
      });
    }));

    let chatHistory = "Recent Chat Messages:\n";
    if (messageDocs.length === 0) {
      chatHistory += "(No recent messages)\n";
    } else {
      for (const docSnap of messageDocs) {
        const d = docSnap.data();
        const senderName = (d.senderId && senderNames.get(d.senderId)) || "Someone";
        chatHistory += `- ${senderName}: ${d.text || (d.imageUrl ? '[Image]' : '[Audio]')}\n`;
      }
    }

    // ── Upcoming events ──────────────────────────────────────────────────────────────────
    //
    // The window and the selection live in `digestEvents.ts`, tested from
    // `src/utils/digestEvents.test.ts` — this section had no test at all, which is most of the
    // reason it was wrong three ways for as long as it was. What is left here is the two reads,
    // and the reason the second one is shaped the way it is.
    //
    // Measured on live on 19.09, before any of it was written: five groups, zero events anywhere
    // in the next eight days, and ONE recurring event in the whole database — belonging to no
    // group. So none of the three defects had a victim that day. They are deterministic all the
    // same: the first fired for every event anybody dated today, from the moment it was saved.
    const eventWindow = digestWindow(new Date().toISOString());

    let upcomingEvents = "Upcoming Events (Next 7 days):\n";
    let eventsTruncated = false;

    if (!eventWindow) {
      // Unreachable from a real clock, and said out loud rather than left as an empty list —
      // "(No upcoming events)" would read as a calendar with nothing on it.
      upcomingEvents += "(Upcoming events unavailable)\n";
    } else {
      const [windowSnap, recurringSnap] = await Promise.all([
        db.collection('events')
          .where('groupId', '==', groupId)
          .where('date', '>=', eventWindow.scanFrom)
          .where('date', '<=', eventWindow.scanTo)
          .orderBy('date', 'asc')
          .limit(DIGEST_EVENT_SCAN)
          .get(),
        // Deliberately NOT scoped by `groupId`, and that is measured rather than assumed: on
        // 19.09 `groupId == X` alongside `recurrenceRule != null` was refused on live with
        // FAILED_PRECONDITION for want of a composite index. Deploying an index so that a query
        // can be narrow — on a code path where a MISSING index throws rather than returning
        // less — is the worse trade when the whole database holds one such document.
        // `digestEventLines` filters by group before anything reads them.
        db.collection('events')
          .where('recurrenceRule', '!=', null)
          .limit(DIGEST_RECURRING_SCAN)
          .get(),
      ]);

      const docs: EventDoc[] = [...windowSnap.docs, ...recurringSnap.docs]
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as EventDoc));
      const selection = digestEventLines(docs, groupId, eventWindow);

      eventsTruncated = selection.truncated
        || windowSnap.size >= DIGEST_EVENT_SCAN
        || recurringSnap.size >= DIGEST_RECURRING_SCAN;

      upcomingEvents += selection.lines.length === 0
        ? "(No upcoming events)\n"
        : selection.lines.join("\n") + "\n";
    }

    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are a helpful AI Assistant for a family/group organization app.
Summarize the recent activity and upcoming events for the group "${groupName}".
Translate your summary to this exact locale language: "${language}".

${chatHistory}

${upcomingEvents}

Provide a brief, friendly, conversational digest (1-2 paragraphs max) that highlights what happened recently and what is coming up. Keep it concise. No markdown headers.`;

    const result = await withLedger(
      { feature: 'group-digest', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      // `maxOutputTokens` is what makes the pessimistic hold honest: `estimateUsdFor` prices
      // the output at this ceiling, and without it nothing stopped a response from exceeding it.
      () => ai.models.generateContent({
        model: AI_MODEL, contents: prompt,
        config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
      }),
      usageOf,
      prompt.length,
    );
    const text = textOf(result).trim();
    
    // The caller is told when the window was cut, so a partial digest can say so instead of
    // reading as the whole story. BOTH halves can cut it — the chat window and the event window
    // each have a ceiling of their own — and a flag covering only one of them would be a promise
    // the other half does not keep.
    return { digest: text, truncated: digestTruncated || eventsTruncated };
  } catch (error: any) {
    console.error("AI Group Digest Error", error);
    // The provider rationing us is not a defect: no bad input, no bad state, nothing to fix.
    // `withLedger` already writes a row per call with the uid, the feature and the code, so the
    // fact is kept — and keeping it OUT of errorLogs is the point. Seventy-four of the ~95 rows
    // in the health panel were this one thing, and the panel sorts by count, so every real bug
    // in the app sat underneath it.
    // A refusal WE made is not an error. Re-thrown with its own code so the client can say which,
    // and kept out of errorLogs for the same reason provider quota was: it would bury every real
    // bug under itself, in bursts, exactly when the panel is needed.
    if (isOwnBudgetRefusal(error)) {
      // Nothing reached the model, so the call must not cost the caller one of their fifty.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('resource-exhausted', (error as any).message);
    }
    if (isProviderQuotaError(error)) throw new HttpsError('resource-exhausted', AI_QUOTA_CODE);
    void logServerError((error as any)?.message || "AI digest error", "ai:groupDigest", { stack: (error as any)?.stack, uid: callerUid });
    throw new HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
  }
});

export const suggestAssetForText = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { text, availableAssets } = request.data;
  if (!text || !availableAssets || !Array.isArray(availableAssets)) {
    throw new HttpsError('invalid-argument', 'text and availableAssets are required.');
  }
  const callerUid = await assertAiCallerAllowed(request);

  try {
    const key = process.env.GEMINI_API_KEY_LOCAL;
    if (!key) {
      // Nothing reached the model — there is no model to reach. The unit was taken at the door
      // by `assertAiCallerAllowed`, so without this a service with no API key silently eats one
      // of the caller's fifty per attempt, and a misconfiguration nobody can see from the app
      // burns the whole day's allowance for free. Fixed in the trigger first; these four were
      // the same bug and were missed.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }

    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `You are an AI that maps text to the most relevant asset card.
Text: "${text}"

Available Assets:
${availableAssets.map((a: any) => `- ID: ${a.id}, Name: ${a.name}`).join('\n')}

Rules:
1. If the text clearly implies groceries, supermarkets, or food shopping, match a supermarket/loyalty card if one exists (e.g. Kaufland, Mega Image, Lidl, Carrefour, Profi, Auchan, Penny).
2. If the text implies health, doctor, or medical, match a health card (e.g. SanoPass, Medicover, Regina Maria).
3. If it implies gym or fitness, match a gym card (e.g. 7Card, WorldClass).
4. Return ONLY the exact string ID of the best matching asset.
5. If no asset matches reasonably well, return the exact string "none".
Do not include any other text or markdown formatting.`;

    const result = await withLedger(
      { feature: 'asset-suggest', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      // `maxOutputTokens` is what makes the pessimistic hold honest: `estimateUsdFor` prices
      // the output at this ceiling, and without it nothing stopped a response from exceeding it.
      () => ai.models.generateContent({
        model: AI_MODEL, contents: prompt,
        config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
      }),
      usageOf,
      prompt.length,
    );
    const resultText = textOf(result).trim();
    
    // Validate that the returned ID is actually in the list, unless it's "none"
    const matchedAsset = availableAssets.find((a: any) => a.id === resultText);
    
    return { assetId: matchedAsset ? matchedAsset.id : null };
  } catch (error: any) {
    console.error("AI Asset Suggestion Error", error);
    // The provider rationing us is not a defect: no bad input, no bad state, nothing to fix.
    // `withLedger` already writes a row per call with the uid, the feature and the code, so the
    // fact is kept — and keeping it OUT of errorLogs is the point. Seventy-four of the ~95 rows
    // in the health panel were this one thing, and the panel sorts by count, so every real bug
    // in the app sat underneath it.
    // A refusal WE made is not an error. Re-thrown with its own code so the client can say which,
    // and kept out of errorLogs for the same reason provider quota was: it would bury every real
    // bug under itself, in bursts, exactly when the panel is needed.
    if (isOwnBudgetRefusal(error)) {
      // Nothing reached the model, so the call must not cost the caller one of their fifty.
      await releaseQuota(callerUid, 'ai_usage').catch(() => undefined);
      throw new HttpsError('resource-exhausted', (error as any).message);
    }
    if (isProviderQuotaError(error)) throw new HttpsError('resource-exhausted', AI_QUOTA_CODE);
    void logServerError((error as any)?.message || "AI asset error", "ai:suggestAsset", { stack: (error as any)?.stack, uid: callerUid });
    throw new HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
  }
});

// ── Notifications fan-out (anti-spam) ──
// Clients can no longer write to `notifications` directly (Firestore rule denies
// create). They call this instead: it requires auth, only lets you notify users
// you SHARE A GROUP with, rate-limits per sender, and writes via the Admin SDK
// with a server-set `createdBy`/`createdAt`.
export const notifyUsers = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { recipientIds, type, title, body, titleKey, bodyKey, param } = request.data || {};
  if (!Array.isArray(recipientIds) || recipientIds.length === 0 || !title) {
    throw new HttpsError("invalid-argument", "recipientIds and title are required.");
  }

  // De-dupe, drop self, cap fan-out per call.
  const recipients = [...new Set(recipientIds)]
    .filter((r) => typeof r === "string" && r !== uid)
    .slice(0, 20);
  if (recipients.length === 0) {
    return { created: 0 };
  }

  if (!(await tryConsumeQuota(uid, "notif_usage", NOTIF_DAILY_LIMIT))) {
    throw new HttpsError("resource-exhausted", "Notification limit reached. Please try again later.");
  }

  const db = admin.firestore();

  // Build the set of users the sender shares a group with.
  const groupsSnap = await db.collection("groups").where("members", "array-contains", uid).get();
  const sharedMembers = new Set<string>();
  groupsSnap.docs.forEach((d) => {
    (d.data().members || []).forEach((m: string) => sharedMembers.add(m));
  });

  const batch = db.batch();
  let created = 0;
  for (const rid of recipients) {
    if (!sharedMembers.has(rid)) continue; // only notify users you share a group with
    const ref = db.collection("notifications").doc();
    batch.set(ref, {
      userId: rid,
      createdBy: uid,
      type: typeof type === "string" ? type : "info",
      // The rendered strings stay, as the fallback for documents the reader's build cannot
      // translate — but they are the SENDER'S language, frozen at write time, which is why a
      // Romanian account was reading "New Task Assigned" next to four Romanian ones.
      title: String(title).slice(0, 200),
      body: typeof body === "string" ? body.slice(0, 500) : "",
      // The keys are what a reader actually renders, in their OWN language. Stored as short opaque
      // strings: `t()` resolves them against a fixed table, so an unknown key falls back rather
      // than injecting anything.
      ...(typeof titleKey === "string" && titleKey ? { titleKey: titleKey.slice(0, 60) } : {}),
      ...(typeof bodyKey === "string" && bodyKey ? { bodyKey: bodyKey.slice(0, 60) } : {}),
      ...(typeof param === "string" && param ? { param: param.slice(0, 200) } : {}),
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  }
  if (created > 0) {
    await batch.commit();
  }
  return { created };
});

// ── Recurring-event single-occurrence override ──
// Clients can't create events they don't own (Firestore: create requires
// ownerId == auth.uid). A single-occurrence override keeps the ORIGINAL owner,
// so it's created here: validates the caller may edit the parent, writes the
// override with the parent's ownerId/groupId (server-authoritative), and adds
// the exception date to the parent.
// The only fields a client may put on a single-occurrence override.
//
// This used to be `...data` — whatever the caller sent, spread into a document the server then
// stamps with the PARENT's ownerId. Three separate things came through that hole:
//
//   * `assigneeIds` / `inviteeId`. The events create rule refuses to name people who are not in
//     your group, but the Admin SDK does not evaluate rules at all, so this callable was a way
//     around it against any uid (and uids are public via the warlordPlayers roster).
//   * `ai_assistant` in `assigneeIds`. The onCreate trigger fires on that value and spends the
//     DOCUMENT OWNER's daily AI quota and budget — so a group member could drain another
//     member's allowance, attributed to her in the ledger.
//   * Anything else at all, on a document owned by someone else.
//
// A list is used rather than a denylist because the next field added to events would otherwise
// be admitted by default.
// Checked against what AddEventModal actually sends and what events actually carry — a field
// missing from here is dropped in silence, which on an override means editing one occurrence
// quietly loses its picture or its emoji.
const OVERRIDE_FIELDS = [
  "title", "description", "date",
  "checklistItems", "isTask", "taskStatus",
  "categoryId", "color", "emoji", "imageUrl",
  "location", "reminderMinutes", "assetId", "time", "timezone",
  // Who the occurrence is for. Found missing on 19.09 by the guard written for `rsvps`, and it
  // is the same defect: the details window writes these through `resolveWriteTarget`, so the
  // ADD path re-sets them and looks fine — but materialising the occurrence any OTHER way, by
  // ticking a checklist item say, dropped everybody who was assigned to that date.
  "assigneeIds", "assigneeId",
  // The span. Relative fields, so an override of one occurrence carries exactly that
  // occurrence's length — see the header of eventTime.ts for why it is not an absolute end.
  "endDayOffset", "endTime",
  // `hiddenFrom` replaced `visibleTo` on 18.09: the audience is stored as the EXCLUSION now, so
  // it cannot go stale when somebody joins the group. `visibleTo` stays on the list because
  // documents written before that still carry it and an override copies what it is given.
  // `rsvps` joined `rsvpEnabled` on 19.09: without it, materialising an occurrence kept the
  // question and dropped every answer, silently, on the write that created the override.
  "rsvpEnabled", "rsvps", "visibleTo", "hiddenFrom",
] as const;

export const createEventOverride = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { parentId, overrideDate, data } = request.data || {};
  if (!parentId || !overrideDate || !data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "parentId, overrideDate and data are required.");
  }
  // `overrideDate` goes into arrayUnion on the parent's exception list unchecked otherwise, so
  // any string at all could be written there — including one that never matches a real day and
  // therefore silently excepts nothing.
  if (typeof overrideDate !== "string" || !isRealDay(overrideDate)) {
    throw new HttpsError("invalid-argument", "overrideDate must be a real yyyy-MM-dd day.");
  }

  const db = admin.firestore();
  const parentRef = db.doc(`events/${parentId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new HttpsError("not-found", "Parent event not found.");
  }
  const p = parentSnap.data() || {};

  const canEdit =
    p.ownerId === uid ||
    (!!p.groupId && (await userInGroup(uid, p.groupId))) ||
    (Array.isArray(p.assigneeIds) && p.assigneeIds.includes(uid));
  if (!canEdit) {
    throw new HttpsError("permission-denied", "You can't edit this event.");
  }

  // Copy only what is on the list, and only when it is actually present.
  const safe: Record<string, unknown> = {};
  for (const key of OVERRIDE_FIELDS) {
    const v = (data as Record<string, unknown>)[key];
    // Firestore rejects `undefined` outright and would fail the whole batch over one absent field.
    if (v !== undefined) safe[key] = v;
  }

  // The span is checked with the SAME rule the form applies before writing, so the two cannot
  // drift into accepting different things. `safe.time` rather than the parent's: an override is a
  // whole document, and the client always sends its time fields.
  const span = spanProblem({ time: safe.time, endDayOffset: safe.endDayOffset, endTime: safe.endTime });
  if (span) {
    throw new HttpsError("invalid-argument", `Invalid event span: ${span}.`);
  }

  // Assignees are allowed through, but only the ones the PARENT already had, plus the caller.
  // That is exactly what materialising an occurrence needs and nothing more: adding somebody new
  // is a separate act that has to face the rules. `ai_assistant` is dropped in every case — an
  // override inherits the parent's checklist, so re-triggering generation would spend the owner's
  // budget for nothing, on somebody else's say-so.
  const parentAssignees: string[] = Array.isArray(p.assigneeIds)
    ? p.assigneeIds.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const allowed = new Set([...parentAssignees, uid]);
  const requested: string[] = Array.isArray((data as Record<string, unknown>).assigneeIds)
    ? ((data as Record<string, unknown>).assigneeIds as unknown[])
        .filter((x): x is string => typeof x === "string")
    : [];
  const assigneeIds = requested.filter((id) => allowed.has(id) && id !== "ai_assistant");
  safe.assigneeIds = assigneeIds;
  safe.assigneeId = assigneeIds[0] ?? null;

  // RSVPs: everybody else's from the PARENT, only the caller's own from the request. The loop above
  // copied the whole map from the client, on the Admin SDK — so the per-person rule was never
  // consulted and one member could answer for the family. See overrideRsvps.ts.
  const rsvps = overrideRsvps(p.rsvps, (data as Record<string, unknown>).rsvps, uid);
  if (rsvps) safe.rsvps = rsvps;
  else delete safe.rsvps;

  // ── ONE override per occurrence ───────────────────────────────────────────────────────────────
  //
  // This used to create a NEW override on every call. A second member with the occurrence still
  // open from before the first one materialised it (CalendarHome keeps the old virtual row) got a
  // second override for the same day, and the event then showed twice.
  //
  // Now it is a transaction: an override already made for this date is RETURNED, not duplicated.
  // What happens to the caller's `data` then depends on what the caller meant:
  //   * materialising (the details window, which then writes its one change to the returned id)
  //     — nothing is applied; the existing override's edits must not be overwritten by a copy of
  //     the parent that the caller happened to be holding;
  //   * `apply: true` (the edit form, whose data IS the edit) — applied to the existing override,
  //     under the same rules as a first edit: other people's RSVPs and assignees kept.
  //
  // `overrideDate` is now stored ON the override. The server's dedupe used to key on the
  // override's own `date`, so moving an occurrence onto another occurrence's day hid that REAL
  // occurrence from reminders and the digest.
  const apply = (request.data as { apply?: unknown }).apply === true;
  const events = db.collection("events");

  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(parentRef);
    if (!fresh.exists) throw new HttpsError("not-found", "Parent event not found.");
    const exceptions: unknown[] = Array.isArray(fresh.data()?.recurrenceExceptions)
      ? fresh.data()!.recurrenceExceptions
      : [];

    // `| undefined` said out loud: `docs[0]` of an empty result IS undefined, whatever the
    // inferred type claims.
    let existing: admin.firestore.QueryDocumentSnapshot | undefined = (await tx.get(
      events.where("overrideOfParent", "==", parentId).where("overrideDate", "==", overrideDate).limit(1),
    )).docs[0];

    if (!existing && exceptions.includes(overrideDate)) {
      // The date is already excepted, so an override was made before `overrideDate` existed, or
      // the occurrence was deleted. A legacy override that was not MOVED sits on its own day.
      const legacy = await tx.get(events.where("overrideOfParent", "==", parentId));
      existing = legacy.docs.find((d) => {
        const x = d.data();
        return typeof x.overrideDate !== "string" && typeof x.date === "string" && x.date.slice(0, 10) === overrideDate;
      });
      // Deleted (or a legacy override moved elsewhere): re-creating it would resurrect something
      // somebody removed, from a stale screen.
      if (!existing) throw new HttpsError("failed-precondition", "That occurrence no longer exists.");
    }

    if (existing) {
      if (apply) {
        const cur = existing.data();
        const upd: Record<string, unknown> = { ...safe, updatedAt: new Date().toISOString() };
        // Recomputed against THIS override, not the parent: its RSVPs and assignees are the ones
        // that apply on this date.
        const curAssignees = Array.isArray(cur.assigneeIds)
          ? cur.assigneeIds.filter((x: unknown): x is string => typeof x === "string") : [];
        const mayAssign = new Set([...curAssignees, ...parentAssignees, uid]);
        const keptAssignees = requested.filter((id) => mayAssign.has(id) && id !== "ai_assistant");
        upd.assigneeIds = keptAssignees;
        upd.assigneeId = keptAssignees[0] ?? null;
        const merged = overrideRsvps(cur.rsvps, (data as Record<string, unknown>).rsvps, uid);
        upd.rsvps = merged ?? admin.firestore.FieldValue.delete();
        tx.update(existing.ref, upd);
      }
      return { id: existing.id, existed: true };
    }

    const overrideRef = events.doc();
    tx.set(overrideRef, {
      ...safe,
      ownerId: p.ownerId, // server-authoritative (keep original owner)
      groupId: p.groupId ?? null, // keep within the parent's group
      // Legacy and inert, but carried from the PARENT rather than from the caller: it is not the
      // client's to state on a document it does not own.
      sharedWithFamily: p.sharedWithFamily ?? false,
      updatedAt: new Date().toISOString(),
      overrideOfParent: parentId,
      overrideDate,
      createdAt: new Date().toISOString(),
    });
    tx.update(parentRef, {
      recurrenceExceptions: admin.firestore.FieldValue.arrayUnion(overrideDate),
    });
    return { id: overrideRef.id, existed: false };
  });
});

// ── Group teardown ──
//
// Deleting a group used to be a client loop over every event carrying that groupId. Two things
// were wrong with it, and both were guaranteed rather than occasional:
//
//   * `allow delete` on events is `resource.data.ownerId == request.auth.uid`, so the FIRST
//     foreign-owned event threw. Everything after it — the invites, the group document itself —
//     never ran, while the owner's own events deleted on earlier iterations were already gone.
//     The flow could not complete, and each retry destroyed a little more.
//   * The "keep" branch wrote `groupId: null` onto events it did not own, which the member-update
//     rule permits — quietly pulling another member's event out of the shared calendar.
//
// So it moves here, where the Admin SDK can see the whole group at once. Note what this does NOT
// do: other members' events are RE-PARENTED to personal, never deleted. Losing the group should
// not lose their data, and the owner was never entitled to delete it.
export const deleteGroupCascade = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { groupId, keepEventIds } = request.data || {};
  if (!groupId || typeof groupId !== "string") {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }
  // The caller's selection applies only to the caller's OWN events. Ids of anything else are
  // ignored rather than trusted — otherwise "keep" would be a way to reach into other people's.
  const keep = new Set(
    (Array.isArray(keepEventIds) ? keepEventIds : [])
      .filter((x: unknown): x is string => typeof x === "string")
      .slice(0, 2000),
  );

  const db = admin.firestore();
  const groupRef = db.doc(`groups/${groupId}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Group not found.");
  }
  if ((groupSnap.data() || {}).ownerId !== uid) {
    throw new HttpsError("permission-denied", "Only the group's owner can delete it.");
  }

  let deleted = 0;
  let freed = 0;
  // No cursor is needed: every document this loop touches stops matching `groupId == groupId`
  // (it is either deleted or re-parented to null), so the same query drains itself. The cap is
  // there so a write that silently fails cannot turn that into a spin.
  for (let page = 0; page < 40; page++) {
    const snap = await db.collection("events").where("groupId", "==", groupId).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) {
      const ev = d.data() || {};
      if (ev.ownerId === uid && !keep.has(d.id)) {
        batch.delete(d.ref);
        deleted++;
      } else {
        batch.update(d.ref, { groupId: null, sharedWithFamily: false });
        freed++;
      }
    }
    await batch.commit();
  }

  const invites = await deleteQueryInBatches(
    db.collection("group_invites").where("groupId", "==", groupId),
  );
  // The chat lives UNDER the group document, so deleting the parent would leave it unreachable
  // and still billed for. Firestore does not cascade; this is the only place that can.
  const messages = await deleteQueryInBatches(db.collection(`groups/${groupId}/messages`));
  await deleteQueryInBatches(db.collection(`groups/${groupId}/typing`));
  await groupRef.delete();

  return { deleted, freed, invites, messages };
});

// ── Asset transfer "keep copy" ──
// Creating an asset owned by ANOTHER user can't be a client write (create
// requires ownerId == auth.uid). The caller must own the source asset and share
// a group with the recipient; the copy is duplicated server-side from the
// (already-updated) original so its data is authoritative.
export const transferAssetCopy = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { assetId, recipientId, mode } = request.data || {};
  if (!assetId || !recipientId) {
    throw new HttpsError("invalid-argument", "assetId and recipientId are required.");
  }
  // "copy" leaves the original with the sender; "move" hands it over entirely. Both go through
  // the same ownership and shared-group checks below — the move used to be a plain client write
  // that skipped them, because the rule only looked at the ownerId the document ALREADY had.
  const move = mode === "move";
  if (recipientId === uid) {
    throw new HttpsError("invalid-argument", "Cannot transfer to yourself.");
  }

  const db = admin.firestore();
  const assetSnap = await db.doc(`assets/${assetId}`).get();
  if (!assetSnap.exists) {
    throw new HttpsError("not-found", "Asset not found.");
  }
  const a = assetSnap.data() || {};
  if (a.ownerId !== uid) {
    throw new HttpsError("permission-denied", "You don't own this asset.");
  }
  if (!(await usersShareGroup(uid, recipientId))) {
    throw new HttpsError("permission-denied", "You can only transfer to members of your groups.");
  }

  // What the copy should be is decided in assetTransfer.ts, where it can be RUN. The shape that
  // was here copied `sharedGroupId` across with everything else, so the SENDER's group could read
  // a card in the RECIPIENT's wallet — harmless while no card was ever shared, and armed the day
  // attaching one to a group event started sharing it.
  const copyRef = db.collection("assets").doc();
  const batch = db.batch();
  batch.set(copyRef, transferredCopy(a, uid, recipientId, new Date().toISOString()));
  // A move is the copy plus removing the source, in ONE batch — a half-done transfer would either
  // duplicate the asset or lose it. The recipient also gets `transferredFrom`, which the old
  // client-side ownerId flip never wrote, so a wallet entry that appeared out of nowhere had
  // nothing on it saying where it came from.
  if (move) batch.delete(assetSnap.ref);
  await batch.commit();
  return { id: copyRef.id, moved: move };
});

// ── Friends: respond to a friend request ──
// Accepting must add each user to the OTHER's `friends` list, but the `users`
// collection is owner-only write — clients can't touch each other's docs. So
// responding goes through this callable (Admin SDK). The caller must be the
// request's recipient (matched by uid or email). On accept, both users get a
// `{uid,name,email}` entry for the other (email lives on the owner-only user
// doc, not the public profile, so we resolve it here) and the sender is notified.
export const respondToFriendRequest = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  const email = (request.auth?.token?.email || "").toLowerCase();
  const emailVerified = request.auth?.token?.email_verified === true;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { requestId, accept } = request.data || {};
  if (!requestId || typeof accept !== "boolean") {
    throw new HttpsError("invalid-argument", "requestId and accept are required.");
  }

  const cap = (s: any) => String(s || "").slice(0, 80);
  const db = admin.firestore();
  const reqRef = db.doc(`friend_requests/${requestId}`);

  // One transaction: re-check status, read both users, and write atomically. The notification
  // is sent AFTER it commits — a failure to announce a friendship must not undo the friendship.
  // A request addressed by email can only be accepted by a caller whose email is
  // VERIFIED (prevents claiming a request sent to an address you don't own).
  // Requests addressed by uid (toId) are always safe (uid can't be spoofed).
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Friend request not found.");
    }
    const fr = snap.data() || {};
    const isRecipient = fr.toId === uid || (emailVerified && !!fr.toEmail && fr.toEmail === email);
    if (!isRecipient) {
      throw new HttpsError("permission-denied", "This request isn't addressed to you.");
    }
    if (fr.status !== "pending") {
      return { status: fr.status };
    }
    if (!accept) {
      tx.update(reqRef, { status: "declined", toId: uid });
      return { status: "declined" };
    }

    const senderUid = fr.fromId;
    if (!senderUid || senderUid === uid) {
      tx.update(reqRef, { status: "declined", toId: uid });
      throw new HttpsError("failed-precondition", "Invalid friend request.");
    }

    const senderAuth = await authIdentityOf(senderUid);
    const senderRef = db.doc(`users/${senderUid}`);
    const accepterRef = db.doc(`users/${uid}`);
    const [senderUser, accepterUser, senderProfile, accepterProfile] = await Promise.all([
      tx.get(senderRef), tx.get(accepterRef),
      tx.get(db.doc(`profiles/${senderUid}`)), tx.get(db.doc(`profiles/${uid}`)),
    ]);

    // Emails from Auth ONLY. `users/{uid}.email` is owner-writable and `fr.fromEmail` is the
    // sender's own claim, and both used to land in the other person's friend list — a stranger's
    // forged address in yours, and, since accepting is the point, yours in theirs.
    const senderEmail = senderAuth.email;
    const senderName = cap(senderProfile.data()?.name || senderUser.data()?.name ||
      (senderEmail || "").split("@")[0] || "Friend");
    const accepterEmail = trustedEmail(email);
    const accepterName = cap(accepterProfile.data()?.name || accepterUser.data()?.name ||
      (accepterEmail || "").split("@")[0] || "Friend");

    // Read-filter-write so each side has exactly ONE entry per friend uid (and a
    // re-accept refreshes name/email instead of accumulating stale duplicates).
    const senderFriends = (senderUser.data()?.friends || []).filter((f: any) => f && f.uid !== uid);
    senderFriends.push({ uid, name: accepterName, email: accepterEmail });
    const accepterFriends = (accepterUser.data()?.friends || []).filter((f: any) => f && f.uid !== senderUid);
    accepterFriends.push({ uid: senderUid, name: senderName, email: senderEmail });

    tx.set(senderRef, { friends: senderFriends }, { merge: true });
    tx.set(accepterRef, { friends: accepterFriends }, { merge: true });
    tx.update(reqRef, { status: "accepted", toId: uid });

    return { status: "accepted", senderUid, accepterName };
  });

  if (outcome.status === "accepted" && outcome.senderUid) {
    // Used to write the bell row and send NO push at all, so whether the sender found out
    // depended on them opening the app.
    await notify({
      userIds: [outcome.senderUid],
      createdBy: uid,
      type: "friend",
      titleKey: "friendRequestAccepted",
      bodyKey: "friendRequestAcceptedBody",
      param: outcome.accepterName,
      data: { route: "/friends" },
    });
  }

  return { status: outcome.status };
});

// ── Friends: remove a friend (mutual) ──
// Friends are objects on each owner-only user doc, so an unfriend must edit BOTH
// docs server-side. Guarded so a caller can only unfriend someone they are
// ACTUALLY friends with (no forced writes to arbitrary strangers' docs) and run
// in a transaction to avoid clobbering a concurrent friends-array update.
export const removeFriend = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { friendUid } = request.data || {};
  if (!friendUid || friendUid === uid) {
    throw new HttpsError("invalid-argument", "A valid friendUid is required.");
  }

  const db = admin.firestore();
  const meRef = db.doc(`users/${uid}`);
  const themRef = db.doc(`users/${friendUid}`);

  return db.runTransaction(async (tx) => {
    const [meSnap, themSnap] = await Promise.all([tx.get(meRef), tx.get(themRef)]);
    // Each side's own document decides what happens to it.
    //
    // The guard was `myFriends.some(...)` alone — a read of the CALLER's document, which the
    // caller may write. So pushing `{ uid: <anyone> }` into your own friends array bought a write
    // into that person's `users/{uid}` document, which nothing else in the app permits. The
    // content of that write was harmless (they were not in your list, so the filter changed
    // nothing) but the shape is the same one that made `openDirectChat` a way to message any
    // account, and an unbounded write channel into strangers' documents is worth closing on its
    // own terms.
    //
    // Cleaning up MY side stays unconditional-ish: a stale one-way entry is exactly what somebody
    // needs to be able to remove. Touching THEIR side now requires that they list me too.
    const myFriends = meSnap.data()?.friends || [];
    if (!myFriends.some((f: any) => f && f.uid === friendUid)) {
      throw new HttpsError("failed-precondition", "You aren't friends with this user.");
    }
    tx.set(meRef, { friends: myFriends.filter((f: any) => f && f.uid !== friendUid) }, { merge: true });
    const theyListMe = ((themSnap.data()?.friends || []) as any[])
      .some((f) => f && f.uid === uid);
    if (themSnap.exists && theyListMe) {
      const theirFriends = (themSnap.data()?.friends || []).filter((f: any) => f && f.uid !== uid);
      tx.set(themRef, { friends: theirFriends }, { merge: true });
    }
    return { ok: true };
  });
});

// ── Accept a group invite ──
// Joining a group means adding yourself to its `members`, but the groups update
// rule requires you to ALREADY be a member — so a non-member's self-add is
// denied. Acceptance therefore goes through this callable (Admin SDK): it
// validates the caller is the invite's recipient (by uid or email) and that the
// invite is pending, then adds them to the group and marks the invite accepted.
export const acceptGroupInvite = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  const email = (request.auth?.token?.email || "").toLowerCase();
  const emailVerified = request.auth?.token?.email_verified === true;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const { inviteId } = request.data || {};
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }

  const db = admin.firestore();
  const inviteRef = db.doc(`group_invites/${inviteId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const inv = snap.data() || {};

    // Email-addressed invites require a VERIFIED email to accept (no claiming an
    // invite to an address you don't own); uid-addressed invites are always safe.
    const isRecipient = inv.toId === uid || (emailVerified && !!inv.toEmail && inv.toEmail.toLowerCase() === email);
    if (!isRecipient) {
      throw new HttpsError("permission-denied", "This invite isn't addressed to you.");
    }
    if (inv.status && inv.status !== "pending") {
      return { status: inv.status, groupId: inv.groupId || null };
    }

    if (inv.groupId) {
      const groupSnap = await tx.get(db.doc(`groups/${inv.groupId}`));
      if (!groupSnap.exists) {
        throw new HttpsError("not-found", "That group no longer exists.");
      }

      // Who VOUCHED for this person, and are they still entitled to?
      //
      // The create rule on group_invites only pins `fromId == request.auth.uid` — the groupId,
      // the toId and the status are all the client's to choose. So a member could write an
      // invite addressed to themselves for their own group, and this function would honour it
      // later with no idea it had never been issued by anyone but the person accepting it.
      // A member removed from a family group could walk straight back in.
      //
      // Both checks below have to live here rather than in the rules: the rules see the invite
      // only as it is CREATED, and the whole trick is to create it while still a member and
      // redeem it after being removed. Membership is therefore re-tested now, at accept time.
      const inviter = typeof inv.fromId === "string" ? inv.fromId : "";
      if (!inviter || inviter === uid) {
        throw new HttpsError("permission-denied", "An invitation has to come from someone else.");
      }
      const members = groupSnap.data()?.members;
      if (!Array.isArray(members) || !members.includes(inviter)) {
        throw new HttpsError("permission-denied", "Whoever sent this invitation is no longer in the group.");
      }
    }

    // Whoever let you in is the one person in the group you certainly know, so accepting an
    // invitation also makes you two friends. Read here, in the read phase; applied below with
    // the other writes, because a transaction may not read after it has written.
    //
    // `inv.fromId` rather than the group: a personal invitation carries no group at all, and it
    // should still make a friendship.
    const inviterUid = typeof inv.fromId === "string" ? inv.fromId : "";
    // Not `inv.fromName` / `inv.fromEmail`: the invitation's sender wrote those. From Auth.
    const inviterAuth = await authIdentityOf(inviterUid);
    const friendship = await readFriendship(tx, db, inviterUid, uid, {
      aEmail: inviterAuth.email, bEmail: email,
    });

    if (inv.groupId) {
      tx.update(db.doc(`groups/${inv.groupId}`), {
        members: admin.firestore.FieldValue.arrayUnion(uid),
      });
    }
    friendship.apply();
    tx.update(inviteRef, { status: "accepted", toId: uid });
    return { status: "accepted", groupId: inv.groupId || null };
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN BACKEND — all gated by assertAdmin(); data served via Admin SDK so we
// never open read rules on user PII. Stats are computed on-read (refreshable).
// ════════════════════════════════════════════════════════════════════════════

// Fetch all Firebase Auth users (paginated, capped) for stats/profiles.
async function listAllAuthUsers(max = 5000): Promise<{ users: admin.auth.UserRecord[]; truncated: boolean }> {
  const out: admin.auth.UserRecord[] = [];
  let token: string | undefined = undefined;
  let truncated = false;
  do {
    const pageSize = Math.min(1000, max - out.length);
    const res: admin.auth.ListUsersResult = await admin.auth().listUsers(pageSize, token);
    out.push(...res.users);
    token = res.pageToken;
    if (token && out.length >= max) { truncated = true; break; }
  } while (token);
  return { users: out.slice(0, max), truncated };
}

const inc = (obj: Record<string, number>, key: string, by = 1) => {
  if (!key) return;
  obj[key] = (obj[key] || 0) + by;
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Delete every doc matching a query, in batches, until exhausted (or a cap).
async function deleteQueryInBatches(query: admin.firestore.Query, max = 3000): Promise<number> {
  let deleted = 0;
  while (deleted < max) {
    const snap = await query.limit(400).get();
    if (snap.empty) break;
    const batch = admin.firestore().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  return deleted;
}

// Delete all Storage objects under the given prefixes (best-effort).
async function deleteStoragePrefixes(prefixes: string[]): Promise<boolean> {
  try {
    const bucket = admin.storage().bucket();
    await Promise.all(prefixes.map((p) => bucket.deleteFiles({ prefix: p }).catch(() => {})));
    return true;
  } catch { return false; }
}

// Record a server-side error so it surfaces in the admin Health panel.
async function logServerError(message: string, where: string, extra?: any): Promise<void> {
  try {
    await admin.firestore().collection("errorLogs").add({
      message: String(message || "server error").slice(0, 1000),
      stack: extra?.stack ? String(extra.stack).slice(0, 4000) : null,
      context: where.slice(0, 200),
      uid: extra?.uid || null,
      source: "server",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch { /* never let logging break the caller */ }
}

// Is the current caller an admin? (Non-throwing for non-admins.)
export const adminCheck = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  try {
    await assertAdmin(request);
    return { isAdmin: true };
  } catch {
    return { isAdmin: false };
  }
});

// Detailed platform statistics across every collection + Firebase Auth.
export const adminGetStats = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Accurate totals come from count() aggregation (never truncated); the capped
  // doc reads below feed the breakdowns and flag `truncated` if they hit a cap.
  const ct = (c: string) => db.collection(c).count().get().then((s) => s.data().count).catch(() => 0);
  const [authResult, usersSnap, groupsSnap, eventsSnap, gamesSnap, assetsSnap,
    friendReqSnap, invitesSnap, notifsSnap, adminsSnap, messagesCount,
    groupsTotal, eventsTotal, gamesTotal, assetsTotal, notifTotal] = await Promise.all([
    listAllAuthUsers(),
    db.collection("users").limit(5000).get(),
    db.collection("groups").limit(5000).get(),
    db.collection("events").limit(8000).get(),
    db.collection("games").limit(5000).get(),
    db.collection("assets").limit(5000).get(),
    db.collection("friend_requests").limit(5000).get(),
    db.collection("group_invites").limit(5000).get(),
    db.collection("notifications").limit(8000).get(),
    db.collection("admins").get(),
    db.collectionGroup("messages").count().get().then((s) => s.data().count).catch(() => 0),
    ct("groups"), ct("events"), ct("games"), ct("assets"), ct("notifications"),
  ]);
  const authUsers = authResult.users;
  const truncated = authResult.truncated ||
    usersSnap.size >= 5000 || groupsSnap.size >= 5000 || eventsSnap.size >= 8000 ||
    gamesSnap.size >= 5000 || assetsSnap.size >= 5000 || friendReqSnap.size >= 5000 ||
    invitesSnap.size >= 5000 || notifsSnap.size >= 8000;

  // ── Users (Firebase Auth + Firestore user docs) ──
  const byProvider: Record<string, number> = {};
  let verified = 0; let signups7d = 0; let signups30d = 0;
  authUsers.forEach((u) => {
    if (u.emailVerified) verified++;
    const created = u.metadata?.creationTime ? new Date(u.metadata.creationTime).getTime() : 0;
    if (created && now - created < 7 * day) signups7d++;
    if (created && now - created < 30 * day) signups30d++;
    inc(byProvider, u.providerData?.[0]?.providerId || "password");
  });
  let withBirthday = 0; let withPhoto = 0; let pushEnabled = 0; let withFriends = 0; let totalFriendEntries = 0;
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.birthday) withBirthday++;
    if (u.photoURL) withPhoto++;
    if (Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0) pushEnabled++;
    if (Array.isArray(u.friends) && u.friends.length > 0) { withFriends++; totalFriendEntries += u.friends.length; }
  });

  // ── Groups ──
  let memberships = 0; let largest = 0; let shared = 0;
  groupsSnap.forEach((d) => {
    const m = (d.data().members || []).length;
    memberships += m;
    if (m > largest) largest = m;
    if (m > 1) shared++;
  });

  // ── Events ──
  const evByCategory: Record<string, number> = {};
  let tasks = 0; let completedTasks = 0; let recurring = 0; let withReminder = 0; let sharedFam = 0; let withRsvp = 0;
  eventsSnap.forEach((d) => {
    const e = d.data();
    if (e.isTask) { tasks++; if (e.taskStatus === "completed") completedTasks++; }
    if (e.recurrenceRule) recurring++;
    if (e.reminderMinutes !== null && e.reminderMinutes !== undefined) withReminder++;
    // Counts group membership, which is what sharing an event has MEANT since the wallet fix.
    // `sharedWithFamily` is now written as a constant false on every new event, so this tile
    // read 0 while half the calendar genuinely sat in a shared group.
    if (e.groupId) sharedFam++;
    if (e.rsvpEnabled) withRsvp++;
    inc(evByCategory, e.categoryId || "other");
  });

  // ── Games ──
  const gByType: Record<string, number> = {}; const gByStatus: Record<string, number> = {};
  let finalized = 0;
  gamesSnap.forEach((d) => {
    const g = d.data();
    inc(gByType, g.gameType || "unknown");
    inc(gByStatus, g.status || "unknown");
    if (g.finalized) finalized++;
  });

  // ── Assets ──
  const aByCategory: Record<string, number> = {}; let assetsShared = 0;
  assetsSnap.forEach((d) => {
    const a = d.data();
    // The field the rules and queries actually consult. `sharedWithFamily` on an asset is a
    // derived echo of the legacy flag that never granted anybody access, so this tile claimed
    // sixteen shared assets while the wallet itself labelled those same sixteen "Never shared".
    if (typeof a.sharedGroupId === "string" && a.sharedGroupId) assetsShared++;
    inc(aByCategory, a.category || "Uncategorized");
  });

  // ── Social ──
  const frByStatus: Record<string, number> = {}; const invByStatus: Record<string, number> = {};
  friendReqSnap.forEach((d) => inc(frByStatus, d.data().status || "pending"));
  invitesSnap.forEach((d) => inc(invByStatus, d.data().status || "pending"));

  // ── Notifications ──
  const nByType: Record<string, number> = {}; let unread = 0;
  notifsSnap.forEach((d) => {
    const n = d.data();
    if (!n.read) unread++;
    inc(nByType, n.type || "info");
  });

  return {
    generatedAt: new Date().toISOString(),
    truncated, // true if a breakdown read hit its cap (totals from count() stay accurate)
    users: {
      total: authUsers.length, verified, unverified: authUsers.length - verified,
      withBirthday, withPhoto, pushEnabled, withFriends,
      friendships: Math.floor(totalFriendEntries / 2),
      signups7d, signups30d, byProvider,
    },
    groups: {
      total: groupsTotal, memberships, shared, solo: groupsTotal - shared,
      avgMembers: groupsTotal ? Math.round((memberships / groupsTotal) * 10) / 10 : 0,
      largest,
    },
    events: {
      total: eventsTotal, tasks, completedTasks, pendingTasks: tasks - completedTasks,
      plainEvents: eventsTotal - tasks, recurring, withReminder, sharedWithFamily: sharedFam,
      withRsvp, byCategory: evByCategory,
    },
    games: { total: gamesTotal, byType: gByType, byStatus: gByStatus, finalized },
    messages: { total: messagesCount },
    assets: { total: assetsTotal, shared: assetsShared, byCategory: aByCategory },
    social: { friendRequests: frByStatus, groupInvites: invByStatus },
    notifications: { total: notifTotal, unread, byType: nByType },
    admins: { total: adminsSnap.size },
  };
});

// All user profiles — Firebase Auth merged with Firestore + per-user activity.
export const adminListProfiles = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const [authResult, usersSnap, profilesSnap, groupsSnap, eventsSnap, adminsSnap] = await Promise.all([
    listAllAuthUsers(),
    db.collection("users").limit(5000).get(),
    db.collection("profiles").limit(5000).get(),
    db.collection("groups").limit(5000).get(),
    db.collection("events").limit(8000).get(),
    db.collection("admins").get(),
  ]);
  const authUsers = authResult.users;

  const userDocs: Record<string, any> = {};
  usersSnap.forEach((d) => { userDocs[d.id] = d.data(); });
  const profileDocs: Record<string, any> = {};
  profilesSnap.forEach((d) => { profileDocs[d.id] = d.data(); });
  const groupCount: Record<string, number> = {};
  groupsSnap.forEach((d) => (d.data().members || []).forEach((uid: string) => inc(groupCount, uid)));
  const eventCount: Record<string, number> = {};
  eventsSnap.forEach((d) => { const o = d.data().ownerId; if (o) inc(eventCount, o); });
  const adminUids = new Set(adminsSnap.docs.map((d) => d.id));

  const profiles = authUsers.map((u) => {
    const fs = userDocs[u.uid] || {};
    const pr = profileDocs[u.uid] || {};
    return {
      uid: u.uid,
      email: u.email || fs.email || null,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      name: fs.name || pr.name || u.displayName || null,
      photoURL: fs.photoURL || pr.photoURL || u.photoURL || null,
      provider: u.providerData?.[0]?.providerId || "password",
      createdAt: u.metadata?.creationTime || null,
      lastSignInAt: u.metadata?.lastSignInTime || null,
      birthday: fs.birthday || pr.birthday || null,
      friends: Array.isArray(fs.friends) ? fs.friends.length : 0,
      groups: groupCount[u.uid] || 0,
      events: eventCount[u.uid] || 0,
      pushEnabled: Array.isArray(fs.fcmTokens) && fs.fcmTokens.length > 0,
      isAdmin: adminUids.has(u.uid),
    };
  }).sort((a, b) => (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime()));

  return { profiles, count: profiles.length, truncated: authResult.truncated };
});

// Current admins with display details.
export const adminListAdmins = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const snap = await db.collection("admins").get();
  const admins = await Promise.all(snap.docs.map(async (d) => {
    const data = d.data();
    let email = data.email || null;
    let name = data.name || null;
    let emailVerified: boolean | null = null;
    try {
      const u = await admin.auth().getUser(d.id);
      email = email || u.email || null;
      name = name || u.displayName || null;
      emailVerified = u.emailVerified;
    } catch { /* auth user may be gone */ }
    return {
      uid: d.id, email, name, emailVerified,
      addedBy: data.addedBy || null,
      addedAt: data.addedAt?.toDate?.()?.toISOString?.() || null,
      bootstrap: BOOTSTRAP_ADMIN_EMAILS.includes((email || "").toLowerCase()),
    };
  }));
  return { admins };
});

// Grant or revoke admin (admin-only). Accepts a uid or an email. Last-admin
// protected; the bootstrap owner re-provisions on next call so can't be locked out.
export const adminSetAdmin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const callerUid = await assertAdmin(request);
  const { uid, email, makeAdmin } = request.data || {};
  if (typeof makeAdmin !== "boolean" || (!uid && !email)) {
    throw new HttpsError("invalid-argument", "makeAdmin and a uid or email are required.");
  }

  let targetUid = uid as string | undefined;
  let targetEmail = (email || "").toLowerCase();
  let targetName: string | undefined;
  try {
    const rec = targetUid
      ? await admin.auth().getUser(targetUid)
      : await admin.auth().getUserByEmail(targetEmail);
    targetUid = rec.uid;
    targetEmail = (rec.email || targetEmail).toLowerCase();
    targetName = rec.displayName || undefined;
  } catch {
    throw new HttpsError("not-found", "No user found for that uid/email.");
  }

  const db = admin.firestore();
  const ref = db.doc(`admins/${targetUid}`);

  if (makeAdmin) {
    await ref.set({
      email: targetEmail || null,
      name: targetName || (targetEmail ? targetEmail.split("@")[0] : null),
      addedBy: callerUid,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, uid: targetUid, makeAdmin: true };
  }

  // Revoke inside a transaction so the last-admin check and the delete are
  // atomic (two concurrent revokes can't both pass the floor and empty the set).
  await db.runTransaction(async (tx) => {
    const all = await tx.get(db.collection("admins"));
    const targetSnap = await tx.get(ref);
    if (!targetSnap.exists) return; // already not an admin → no-op
    if (all.size <= 1) {
      throw new HttpsError("failed-precondition", "Can't remove the last admin.");
    }
    tx.delete(ref);
  });
  return { ok: true, uid: targetUid, makeAdmin: false };
});

// ── Error monitoring ──
// Clients report captured errors here (rate-limited); the Admin SDK writes the
// `errorLogs` collection so clients can't write it directly.
export const logClientError = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  const { message, stack, url, context } = request.data || {};
  if (!message) return { ok: false };
  // Require auth so every report is rate-limited (no unauthenticated spam path).
  if (!uid) return { ok: false };
  if (!(await tryConsumeQuota(uid, "error_usage", 200))) return { ok: false, throttled: true };
  const ua = (request.rawRequest as any)?.headers?.["user-agent"];
  await admin.firestore().collection("errorLogs").add({
    message: String(message).slice(0, 1000),
    stack: stack ? String(stack).slice(0, 4000) : null,
    url: url ? String(url).slice(0, 500) : null,
    context: context ? String(context).slice(0, 200) : null,
    uid,
    email: request.auth?.token?.email || null,
    userAgent: ua ? String(ua).slice(0, 300) : null,
    source: "client",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** How many error rows the health check reads in order to group them. */
const ERROR_SCAN_LIMIT = 500;

/** How many state documents to fetch per `getAll`. Chunked so no group is left without its state. */
const STATE_CHUNK = 300;

/**
 * Read the stored state for a set of fingerprints, keyed by fingerprint.
 *
 * Returns a lookup rather than an array so the caller has no indices to line up: the defect this
 * replaces was a slice applied to the refs and not to the groups, which made every group past the
 * cap report `new` — silently, and worst for the rare recurrences the whole mechanism exists for.
 */
async function readErrorStates(
  db: FirebaseFirestore.Firestore, keys: readonly string[],
): Promise<(key: string) => Record<string, unknown> | null> {
  const byKey = new Map<string, Record<string, unknown>>();
  const refs = keys.map((k) => db.doc(`errorGroups/${groupDocId(k)}`));
  for (let i = 0; i < refs.length; i += STATE_CHUNK) {
    const snaps = await db.getAll(...refs.slice(i, i + STATE_CHUNK));
    snaps.forEach((snap, j) => {
      const data = snap.data() as Record<string, unknown> | undefined;
      if (data) byKey.set(keys[i + j], data);
    });
  }
  return (key: string) => byKey.get(key) || null;
}

// Health / observability: recent errors + AI & notification usage.
export const adminGetHealth = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const today = new Date().toISOString().slice(0, 10);
  const [errSnap, errCount, aiSnap, notifSnap, notifRowsToday] = await Promise.all([
    // Deeper than the list shows. Fifty rows is enough to READ, but not enough to group: the
    // point of grouping is to say how often something happens, and a count taken from a window
    // narrower than the log is a count of the window.
    db.collection("errorLogs").orderBy("createdAt", "desc").limit(ERROR_SCAN_LIMIT).get(),
    db.collection("errorLogs").count().get().then((s) => s.data().count).catch(() => 0),
    db.collection("ai_usage").limit(3000).get(),
    db.collection("notif_usage").limit(3000).get(),
    // Rows actually written today, by anything. The quota ledger above is a different thing —
    // per-user allowance for user-initiated sends — and the shared notify() path never touches
    // it, so a tile built on it read 0 while a broadcast had just written eight rows.
    db.collection("notifications").where("createdAt", ">=", new Date(`${today}T00:00:00.000Z`))
      .count().get().then((s) => s.data().count).catch(() => 0),
  ]);
  const scanned = errSnap.docs.map((d) => {
    const e = d.data();
    return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.()?.toISOString?.() || null };
  });
  // Eighty logged errors is rarely eighty problems. The list answers "what happened last"; the
  // groups answer "what is wrong", which is the question somebody opening this screen actually has.
  const grouped = groupErrors(scanned as any);

  // A few real occurrences per group, so the panel can show them UNDER the problem they belong to
  // instead of as a flat list beside it. Capped per group rather than overall: the point is that
  // every problem can be opened, and a global cap would spend the whole budget on the noisiest one.
  const OCCURRENCES_PER_GROUP = 6;
  const occurrences = new Map<string, unknown[]>();
  for (const r of scanned as any[]) {
    if (!r.message) continue;
    const key = fingerprint(r.message, r.context);
    let list = occurrences.get(key);
    if (!list) { list = []; occurrences.set(key, list); }
    if (list.length < OCCURRENCES_PER_GROUP) {
      list.push({
        id: r.id, createdAt: r.createdAt, url: r.url || null,
        email: r.email || null, stack: r.stack || null,
      });
    }
  }

  // Still returned, though nothing renders it any more. A tab left open across this deploy is
  // running the previous panel, which reads this field; dropping it would make that tab claim
  // "No errors logged" — a lie, and exactly the stale-tab failure this app already has a notice for.
  const errors = scanned.slice(0, 50);

  // ── what has already been looked at ─────────────────────────────────────
  //
  // The state lives per GROUP, never per row: marking seventy-four rows of one thing is not a
  // workflow, and the row ids change every time the log rolls over while the fingerprint does not.
  //
  // Read state for EVERY group, in chunks. The first version sliced the refs to 200 and then mapped
  // over all of them, so from the 201st onward `stateSnaps[i]` was undefined and the group reported
  // `new` for ever — and since groups are ordered by how often they happen, the one that sits past
  // the cap is the rare one: a bug resolved while it was frequent that has since recurred ONCE.
  // That is precisely the case the watermark exists to catch, so the cap silently removed the
  // feature from the only situation that needed it. `errorDigest.ts` had it right, which is how it
  // was clear this was an error rather than a decision.
  //
  // Each group also carries whether anybody has CLAIMED to have fixed it, and whether that claim
  // still stands. The panel offers "Resolved" only where one does — otherwise it was asking the
  // person looking at the screen to certify something only the person who wrote the fix could know.
  const errorGroups = joinState(grouped, await readErrorStates(db, grouped.map((g) => g.key)))
    .map((g) => {
      const fix = fixFor(g.key);
      return {
        ...g,
        fix: fix ? { kind: fix.kind, commit: fix.commit || null, since: fix.since, what: fix.what, verify: fix.verify } : null,
        fixVerdict: fixVerdict(fix, g.lastSeen),
        recent: occurrences.get(g.key) || [],
      };
    });

  // Regressed first, then new, then merely known, then done — and within each, the frequent ones.
  errorGroups.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.count - a.count);

  const errorCounts: Record<string, number> = { new: 0, seen: 0, resolved: 0, regressed: 0 };
  for (const g of errorGroups) errorCounts[g.status] = (errorCounts[g.status] || 0) + 1;
  let aiToday = 0; const aiTop: { uid: string; count: number }[] = [];
  aiSnap.forEach((d) => { const u = d.data(); if (u.date === today && u.count) { aiToday += u.count; aiTop.push({ uid: d.id, count: u.count }); } });
  aiTop.sort((a, b) => b.count - a.count);
  let notifToday = 0;
  notifSnap.forEach((d) => { const u = d.data(); if (u.date === today) notifToday += u.count || 0; });
  return {
    errors, errorGroups, errorCounts, errorTotal: errCount,
    // Says plainly whether the counts above cover the whole log or only its newest slice.
    errorsScanned: scanned.length, errorScanLimit: ERROR_SCAN_LIMIT,
    truncated: aiSnap.size >= 3000 || notifSnap.size >= 3000,
    ai: { today: aiToday, dailyLimitPerUser: AI_DAILY_LIMIT, activeUsers: aiTop.length, top: aiTop.slice(0, 10) },
    notifications: { today: notifToday, rowsToday: notifRowsToday, dailyLimitPerUser: NOTIF_DAILY_LIMIT },
  };
});

/**
 * Move one or more error groups between new / seen / resolved.
 *
 * The WATERMARK is computed here, from the log, and never accepted from the caller. It is the whole
 * mechanism by which a resolved group comes back when it happens again, so a wrong value does not
 * produce an error anybody would notice — it quietly disables the check, which is the worst kind of
 * defect this panel could have.
 */
export const adminSetErrorStatus = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = await assertAdmin(request);
  const { fingerprints, status, note, onlyIfClaimHolds } = request.data || {};

  if (!isErrorStatus(status)) {
    throw new HttpsError("invalid-argument", `status must be one of ${ERROR_STATUSES.join(", ")}`);
  }
  const keys = Array.isArray(fingerprints)
    ? [...new Set(fingerprints.filter((f: unknown): f is string => typeof f === "string" && !!f))]
    : [];
  if (keys.length === 0 || keys.length > 100) {
    throw new HttpsError("invalid-argument", "fingerprints must hold between 1 and 100 keys.");
  }

  const db = admin.firestore();
  const snap = await db.collection("errorLogs").orderBy("createdAt", "desc").limit(ERROR_SCAN_LIMIT).get();
  const scanned = snap.docs.map((d) => {
    const e = d.data();
    return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.()?.toISOString?.() || null };
  });
  const byKey = new Map(groupErrors(scanned as any).map((g) => [g.key, g]));

  const now = new Date().toISOString();
  const batch = db.batch();
  let written = 0;
  const refused = { failed: 0, unclaimed: 0, missing: 0 };

  for (const key of keys) {
    const group = byKey.get(key);
    // A key with nothing behind it is either a stale screen or a typed request. Writing state for a
    // group that does not exist would leave a row nothing can ever clear.
    if (!group) { refused.missing++; continue; }

    // The bulk path. The CHECK happens here rather than on the screen that asked, because a screen
    // can be minutes old: a claim that has since been refuted by a new occurrence must not be
    // applied just because the browser still believes it holds. Manual resolution is unaffected —
    // an admin who fixed something without writing a claim can still say so.
    if (onlyIfClaimHolds === true) {
      const verdict = fixVerdict(fixFor(key), group.lastSeen);
      if (verdict !== "holding") {
        if (verdict === "failed") refused.failed++; else refused.unclaimed++;
        continue;
      }
    }
    batch.set(db.doc(`errorGroups/${groupDocId(key)}`), {
      schema: 1,
      fingerprint: key,
      status,
      // The newest occurrence known right now. Anything after this refutes a "resolved".
      watermark: group.lastSeen || now,
      sample: String(group.sample || "").slice(0, 300),
      note: typeof note === "string" ? note.slice(0, 500) : null,
      // Clear the stamps of the status NOT being set. `merge: true` never removes a field, so a
      // group reopened after being resolved kept its `resolvedAt` and went on reporting a resolve
      // time it no longer had — a screen quietly describing a state that is over.
      ...(status === "resolved"
        ? { resolvedAt: now, resolvedBy: uid, seenAt: null, seenBy: null }
        : status === "seen"
          ? { seenAt: now, seenBy: uid, resolvedAt: null, resolvedBy: null }
          : { seenAt: null, seenBy: null, resolvedAt: null, resolvedBy: null }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    written++;
  }

  if (written > 0) await batch.commit();
  return { ok: true, written, skipped: keys.length - written, refused };
});

// Full detail for one user (drill-down).
export const adminGetUser = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const { uid } = request.data || {};
  if (!uid || typeof uid !== "string" || uid.includes("/")) throw new HttpsError("invalid-argument", "A valid uid is required.");
  const db = admin.firestore();

  let authRec: any = null;
  try {
    const u = await admin.auth().getUser(uid);
    authRec = {
      email: u.email || null, emailVerified: u.emailVerified, disabled: u.disabled,
      displayName: u.displayName || null, photoURL: u.photoURL || null,
      provider: u.providerData?.[0]?.providerId || "password",
      createdAt: u.metadata?.creationTime || null, lastSignInAt: u.metadata?.lastSignInTime || null,
    };
  } catch { /* auth user may be gone */ }

  const [userDoc, profileDoc, groupsSnap, eventsSnap, gamesSnap, assetsSnap, adminSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`profiles/${uid}`).get(),
    db.collection("groups").where("members", "array-contains", uid).limit(200).get(),
    db.collection("events").where("ownerId", "==", uid).limit(500).get(),
    db.collection("games").where("createdBy", "==", uid).limit(200).get(),
    db.collection("assets").where("ownerId", "==", uid).limit(500).get(),
    db.doc(`admins/${uid}`).get(),
  ]);
  const ud = userDoc.data() || {};
  return {
    uid, auth: authRec, isAdmin: adminSnap.exists,
    isProtected: adminSnap.exists || BOOTSTRAP_ADMIN_EMAILS.includes((authRec?.email || "").toLowerCase()),
    name: ud.name || profileDoc.data()?.name || authRec?.displayName || null,
    birthday: ud.birthday || null,
    pushEnabled: Array.isArray(ud.fcmTokens) && ud.fcmTokens.length > 0,
    friends: Array.isArray(ud.friends) ? ud.friends.map((f: any) => ({ uid: f?.uid, name: f?.name, email: f?.email })) : [],
    groups: groupsSnap.docs.map((d) => ({ id: d.id, name: d.data().name || "Group", members: (d.data().members || []).length })),
    counts: { groups: groupsSnap.size, events: eventsSnap.size, games: gamesSnap.size, assets: assetsSnap.size },
    recentEvents: eventsSnap.docs.slice(0, 10).map((d) => {
      const e = d.data();
      return { id: d.id, title: e.title || "(untitled)", date: e.date || null, isTask: !!e.isTask, taskStatus: e.taskStatus || null };
    }),
  };
});

// Moderate a user: enable | disable | forceVerify | delete. Admins/owner and the
// caller themselves are protected from disable/delete.
export const adminModerateUser = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const callerUid = await assertAdmin(request);
  const { uid, action } = request.data || {};
  if (!uid || typeof uid !== "string" || uid.includes("/")) throw new HttpsError("invalid-argument", "A valid uid is required.");
  if (!action) throw new HttpsError("invalid-argument", "action is required.");
  if (uid === callerUid) throw new HttpsError("failed-precondition", "You can't moderate your own account.");

  const db = admin.firestore();
  const adminSnap = await db.doc(`admins/${uid}`).get();
  // "No such account" is an ANSWER — it cannot be an admin by email. Anything else is the lookup
  // FAILING, and swallowing that quietly reduced this check to `admins/{uid}` alone. That matters
  // because of the line below: force-verifying a bootstrap-email account lets it auto-escalate to
  // admin. During an Auth blip, a plain admin could have done exactly that to an address not yet
  // in the roster. A guard that weakens itself on error is not a guard.
  let targetEmail = "";
  try {
    targetEmail = ((await admin.auth().getUser(uid)).email || "").toLowerCase();
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") {
      console.error("adminModerateUser: could not resolve the target", err?.message || err);
      throw new HttpsError("unavailable", "Could not verify the target account. Nothing was changed.");
    }
  }
  const isTargetAdmin = adminSnap.exists || BOOTSTRAP_ADMIN_EMAILS.includes(targetEmail);
  // Protect admins/owner from disable, delete, AND forceVerify (force-verifying a
  // bootstrap-email account would let it auto-escalate to admin).
  if (isTargetAdmin && (action === "disable" || action === "delete" || action === "forceVerify")) {
    throw new HttpsError("failed-precondition", "You can't disable, delete, or force-verify another admin.");
  }

  if (action === "enable") { await admin.auth().updateUser(uid, { disabled: false }); return { ok: true }; }
  if (action === "disable") { await admin.auth().updateUser(uid, { disabled: true }); return { ok: true }; }
  if (action === "forceVerify") { await admin.auth().updateUser(uid, { emailVerified: true }); return { ok: true }; }

  if (action === "delete") {
    // Read the user's own friends first (peers) so we can unlink both sides.
    const meDoc = await db.doc(`users/${uid}`).get();
    const myFriends: any[] = Array.isArray(meDoc.data()?.friends) ? meDoc.data()!.friends : [];

    // Unlink the deleted uid from every peer's mutual friends array.
    await Promise.all(myFriends.map(async (f: any) => {
      if (!f?.uid) return;
      try {
        const peerRef = db.doc(`users/${f.uid}`);
        const peer = await peerRef.get();
        if (!peer.exists) return;
        const pf = (peer.data()?.friends || []).filter((x: any) => x && x.uid !== uid);
        await peerRef.set({ friends: pf }, { merge: true });
      } catch { /* ignore a bad peer */ }
    }));

    // Remove from every group's members.
    const groupsSnap = await db.collection("groups").where("members", "array-contains", uid).limit(400).get();
    await Promise.all(groupsSnap.docs.map((g) =>
      g.ref.update({ members: admin.firestore.FieldValue.arrayRemove(uid) }).catch(() => {})));

    // Delete owned/created content + friend requests (paginated to exhaustion).
    const events = await deleteQueryInBatches(db.collection("events").where("ownerId", "==", uid));
    const assets = await deleteQueryInBatches(db.collection("assets").where("ownerId", "==", uid));
    const games = await deleteQueryInBatches(db.collection("games").where("createdBy", "==", uid));
    const frFrom = await deleteQueryInBatches(db.collection("friend_requests").where("fromId", "==", uid));
    const frTo = await deleteQueryInBatches(db.collection("friend_requests").where("toId", "==", uid));
    // Expenses were NOT deleted here, and that corrupts every group the person was in. The rows
    // survive, the surviving members can still read them (the rule grants any member the group
    // ledger), the balance still SUMS the departed person's spending — but the divisor shrank when
    // they were removed from the group's member list twenty lines above. So everyone left is
    // quietly told they owe more than they do, for good.
    const expenses = await deleteQueryInBatches(db.collection("expenses").where("ownerId", "==", uid));
    // Notifications addressed to a deleted account are unreachable by anyone: the rules key them to
    // the recipient's own uid, so nothing but this can ever remove them.
    const notifications = await deleteQueryInBatches(db.collection("notifications").where("userId", "==", uid));

    // Delete the user's uploaded Storage files.
    const storageDeleted = await deleteStoragePrefixes([
      `assets/${uid}/`, `events/${uid}/`, `checklists/${uid}/`,
      `profiles/${uid}_`, `backgrounds/${uid}_`,
    ]);

    // Delete the user's own docs.
    await Promise.all([
      db.doc(`users/${uid}`).delete().catch(() => {}),
      db.doc(`profiles/${uid}`).delete().catch(() => {}),
      db.doc(`admins/${uid}`).delete().catch(() => {}),
      db.doc(`ai_usage/${uid}`).delete().catch(() => {}),
      db.doc(`notif_usage/${uid}`).delete().catch(() => {}),
      db.doc(`error_usage/${uid}`).delete().catch(() => {}),
      db.doc(`warlord_challenge_usage/${uid}`).delete().catch(() => {}),
      // Warlord: the world-roster entry and the cloud-synced kingdom. Both are
      // otherwise undeletable (clients cannot delete them) and the roster is
      // world-readable, so a deleted account would linger in the player directory.
      db.doc(`warlordPlayers/${uid}`).delete().catch(() => {}),
      db.doc(`warlordDomains/${uid}`).delete().catch(() => {}),
    ]);

    // Finally the Auth account.
    let authDeleted = false;
    try { await admin.auth().deleteUser(uid); authDeleted = true; } catch { /* already gone */ }

    return {
      ok: true, deleted: true, authDeleted, storageDeleted,
      counts: { groups: groupsSnap.size, events, assets, games, expenses, notifications, friendRequests: frFrom + frTo, friendsUnlinked: myFriends.length },
      note: "Group chat messages authored by the user are retained as group history.",
    };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});

// ── Broadcast a notification to all users or one group (admin-only) ──
export const adminBroadcast = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const callerUid = await assertAdmin(request);
  const { target, title, body } = request.data || {};
  // A string, and not a blank one. A truthy non-string (an array, say) passed the old check, and
  // String([]) is "" — which made notify() fall back to a titleKey that exists nowhere, so the
  // bell would have shown the literal text "notifBroadcast". Unreachable from the form; cheap to close.
  if (typeof title !== "string" || !title.trim() || !target) throw new HttpsError("invalid-argument", "target and title are required.");
  const db = admin.firestore();

  let recipients: string[] = [];
  if (target === "all") {
    const res = await listAllAuthUsers();
    recipients = res.users.map((u) => u.uid);
  } else {
    const g = await db.doc(`groups/${target}`).get();
    if (!g.exists) throw new HttpsError("not-found", "Group not found.");
    recipients = (g.data()?.members || []).filter((x: any) => typeof x === "string");
  }
  recipients = [...new Set(recipients)];

  // Through notify(), which is where the push lives. This used to write the bell rows by hand in
  // batches of 400 and stop — no push, ever, for as long as the button has existed. The admin
  // panel said "Sent to 8 users" and eight phones stayed dark. Chunked to notify()'s own recipient
  // cap; the actor is kept because an announcement is for everyone including its author.
  let created = 0;
  let pushed = 0;
  let pruned = 0;
  for (const group of chunk(recipients, 50)) {
    const r = await notify({
      userIds: group,
      createdBy: callerUid,
      includeActor: true,
      type: "broadcast",
      titleKey: "notifBroadcast", // never written nor shown: titleText takes its place
      titleText: String(title).slice(0, 200),
      bodyText: typeof body === "string" ? body.slice(0, 500) : "",
      data: { route: "/" },
    });
    created += r.rows;
    pushed += r.pushed;
    pruned += r.pruned;
  }
  return { ok: true, created, pushed, pruned };
});

// ── All groups with per-group activity (admin-only) ──
export const adminListGroups = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const [groupsSnap, eventsSnap, gamesSnap] = await Promise.all([
    db.collection("groups").limit(2000).get(),
    db.collection("events").limit(8000).get(),
    db.collection("games").limit(5000).get(),
  ]);
  const evByGroup: Record<string, number> = {};
  eventsSnap.forEach((d) => { const g = d.data().groupId; if (g) inc(evByGroup, g); });
  const gaByGroup: Record<string, number> = {};
  gamesSnap.forEach((d) => { const g = d.data().groupId; if (g) inc(gaByGroup, g); });

  const groups = groupsSnap.docs.map((d) => {
    const g = d.data();
    return {
      id: d.id, name: g.name || "Group", ownerId: g.ownerId || null,
      members: (g.members || []).length, memberUids: g.members || [],
      events: evByGroup[d.id] || 0, games: gaByGroup[d.id] || 0,
    };
  }).sort((a, b) => b.members - a.members);
  return { groups };
});

// ── Growth over the last 30 days (signups / events / games) ──
export const adminGetGrowth = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const days = 30;
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const mkBuckets = () => {
    const m: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) m[dayKey(now - i * dayMs)] = 0;
    return m;
  };
  const cutoff = now - (days - 1) * dayMs - (now % dayMs); // start-of-day, days-1 ago (UTC-ish)
  const signups = mkBuckets(); const events = mkBuckets(); const games = mkBuckets();
  const tsOf = (c: any): number => typeof c === "string" ? new Date(c).getTime() : (c?.toDate?.()?.getTime?.() || 0);

  const [authRes, eventsSnap, gamesSnap] = await Promise.all([
    listAllAuthUsers(),
    db.collection("events").limit(8000).get(),
    db.collection("games").limit(5000).get(),
  ]);
  authRes.users.forEach((u) => {
    const t = u.metadata?.creationTime ? new Date(u.metadata.creationTime).getTime() : 0;
    if (t >= cutoff) { const k = dayKey(t); if (k in signups) signups[k]++; }
  });
  eventsSnap.forEach((d) => { const t = tsOf(d.data().createdAt); if (t >= cutoff) { const k = dayKey(t); if (k in events) events[k]++; } });
  gamesSnap.forEach((d) => { const t = tsOf(d.data().createdAt); if (t >= cutoff) { const k = dayKey(t); if (k in games) games[k]++; } });

  const toSeries = (m: Record<string, number>) => Object.entries(m).map(([date, count]) => ({ date, count }));
  return { days, signups: toSeries(signups), events: toSeries(events), games: toSeries(games) };
});

// ═══════════════════════════════════════════════════════════════════════════
// Warlord PvP — SERVER-AUTHORITATIVE battle host.
//
// Trust model: the client may only (a) create an inert 'waiting' challenge doc
// (firestore.rules create-fence forces state/seed/winner null) and (b) call the
// callables below. Every server-owned field (state, status, winner, seed, deploy,
// players) is fenced from client updates in firestore.rules; the Admin SDK here
// bypasses the fence. Move legality is decided EXCLUSIVELY by the same pure
// deterministic engine the clients run (functions/src/warlordCombat/ — a byte-
// identical copy of the game's combat engine), so optimistic client UI reconciles
// exactly with the authoritative state.
//
// Known limit (documented, accepted for v1): armies live only in each player's
// localStorage, so deploy payloads are client-claimed. sanitizeDeploy BOUNDS them
// (caps, derived vet, no statsOverride) but cannot verify provenance — a true fix
// needs a server-side domain registry.
// ═══════════════════════════════════════════════════════════════════════════

const WARLORD_GAME_TYPE = "warlord-battle";
const WARLORD_CID = /^[PE]\d{1,3}$/;

// Validate AND rebuild the command — only whitelisted fields reach the engine.
function parseWarlordCommand(raw: any): Command | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.kind === "END_TURN") return { kind: "END_TURN" };
  if (raw.kind === "MOVE") {
    if (typeof raw.id !== "string" || !WARLORD_CID.test(raw.id)) return null;
    const x = raw.to?.x;
    const y = raw.to?.y;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 63 || y > 63) return null;
    return { kind: "MOVE", id: raw.id, to: { x, y } };
  }
  if (raw.kind === "ATTACK") {
    if (typeof raw.id !== "string" || !WARLORD_CID.test(raw.id)) return null;
    if (typeof raw.targetId !== "string" || !WARLORD_CID.test(raw.targetId)) return null;
    return { kind: "ATTACK", id: raw.id, targetId: raw.targetId };
  }
  return null;
}

function requireGameId(data: any): string {
  const gameId = data?.gameId;
  if (typeof gameId !== "string" || !gameId || gameId.includes("/")) {
    throw new HttpsError("invalid-argument", "A valid gameId is required.");
  }
  return gameId;
}

// Defender locks in their deployment; the server validates BOTH payloads, generates
// the seed (unknowable before both armies are committed), builds the authoritative
// initial BattleState and flips the doc to 'playing'.
export const acceptWarlordChallenge = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const gameId = requireGameId(request.data);
  const { unitIds, combatants } = request.data || {};

  // Defender payload is pure input — validate before the transaction.
  const defender = sanitizeDeploy({ unitIds, combatants }, "ENEMY");
  if (!defender.ok) throw new HttpsError("invalid-argument", `Invalid deployment: ${defender.error}`);

  const db = admin.firestore();
  const ref = db.doc(`games/${gameId}`);
  const deployRef = db.doc(`warlordDeploys/${gameId}`); // challenger army, Admin-SDK-only

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Challenge not found.");
    const g = snap.data()!;
    if (g.gameType !== WARLORD_GAME_TYPE) throw new HttpsError("failed-precondition", "Not a Warlord battle.");
    if (g.status !== "waiting") throw new HttpsError("failed-precondition", "Challenge already accepted or resolved.");
    // Belt & suspenders vs a forged create that slipped past the rules fence.
    if (g.state != null || g.seed != null) throw new HttpsError("failed-precondition", "Malformed challenge.");
    const players = g.players;
    if (!Array.isArray(players) || players.length !== 2 ||
        typeof players[0] !== "string" || typeof players[1] !== "string" ||
        players[0] === players[1] || players[0] !== g.createdBy || players[1] !== g.opponentUid) {
      throw new HttpsError("failed-precondition", "Malformed challenge.");
    }
    if (uid !== g.opponentUid) throw new HttpsError("permission-denied", "This challenge isn't addressed to you.");

    // A GROUP TAG is optional (Warlord is one world: any user may challenge any
    // other). When a battle carries one, it must still be honest — both players
    // members — so re-check it inside the tx. A global battle has groupId === null;
    // note `groups/${null}` is a VALID path string, so this must be guarded or every
    // global challenge would fail the membership check.
    const battleGroupId = typeof g.groupId === "string" && g.groupId ? g.groupId : null;
    if (battleGroupId) {
      const groupSnap = await tx.get(db.doc(`groups/${battleGroupId}`));
      const members = groupSnap.exists ? groupSnap.data()?.members : undefined;
      if (!Array.isArray(members) || !members.includes(players[0]) || !members.includes(players[1])) {
        throw new HttpsError("permission-denied", "Both players must be members of the group.");
      }
    }

    // The challenger's army lives in the Admin-only warlordDeploys doc (never readable
    // by the opponent while waiting → no pre-commit counter-picking). Re-sanitize it.
    const deploySnap = await tx.get(deployRef);
    const challenger = sanitizeDeploy(deploySnap.exists ? deploySnap.data() : undefined, "PLAYER");
    if (!challenger.ok) {
      throw new HttpsError("failed-precondition", `Challenger deployment invalid: ${challenger.error}`);
    }

    // Server-owned seed, generated only after BOTH deploys are locked in.
    const seed = crypto.randomInt(0, 0x100000000); // CSPRNG uint32 (engine applies seed >>> 0)
    const state = createPvpBattle(challenger.combatants, defender.combatants, seed);

    tx.update(ref, {
      status: "playing",
      seed,
      state,
      // Both deploys become public now (the battle is full-information once playing);
      // write-back reads unitIds from here.
      deploy: {
        [g.createdBy]: { unitIds: challenger.unitIds, combatants: challenger.combatants },
        [uid]: { unitIds: defender.unitIds, combatants: defender.combatants },
      },
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMoveAt: admin.firestore.FieldValue.serverTimestamp(), // turn-timeout clock
    });
    tx.delete(deployRef); // private staging no longer needed
    return { ok: true };
  });
});

// Create a PvP challenge (server-authoritative). The challenger's army is validated
// here and stored in the Admin-only `warlordDeploys/{gameId}` doc so the opponent
// cannot read it before committing their own; the public game doc stays army-free
// while 'waiting'. (Client cannot create warlord docs directly — rules deny it.)
export const createWarlordChallenge = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { groupId, opponentUid, unitIds, combatants } = request.data || {};
  // groupId is OPTIONAL: Warlord is one shared world, so any app user may challenge
  // any other. A groupId (when supplied) only tags the battle to that group so it
  // also shows up in the group's arcade list — it is never a permission requirement.
  const groupIdOrNull = typeof groupId === "string" && groupId ? groupId : null;
  if (typeof opponentUid !== "string" || !opponentUid || opponentUid === uid) {
    throw new HttpsError("invalid-argument", "A valid, distinct opponent is required.");
  }
  if (opponentUid.includes("/")) throw new HttpsError("invalid-argument", "Invalid opponent id.");
  const deploy = sanitizeDeploy({ unitIds, combatants }, "PLAYER");
  if (!deploy.ok) throw new HttpsError("invalid-argument", `Invalid deployment: ${deploy.error}`);

  // Anyone may challenge anyone (one world), so the abuse control is a per-sender daily
  // cap rather than a relationship gate — each challenge costs the target a push + docs.
  if (!(await tryConsumeQuota(uid, "warlord_challenge_usage", WARLORD_CHALLENGE_DAILY_LIMIT))) {
    throw new HttpsError("resource-exhausted", "Daily challenge limit reached. Please try again tomorrow.");
  }

  const db = admin.firestore();
  // The opponent must be a real app user (a profile doc is created on every login).
  const oppProfile = await db.doc(`profiles/${opponentUid}`).get();
  if (!oppProfile.exists) throw new HttpsError("not-found", "That player doesn't exist.");
  // When a group is supplied, both players must actually be in it (it becomes a
  // visibility tag on the doc, so it must be honest).
  if (groupIdOrNull) {
    const groupSnap = await db.doc(`groups/${groupIdOrNull}`).get();
    const members = groupSnap.exists ? groupSnap.data()?.members : undefined;
    if (!Array.isArray(members) || !members.includes(uid) || !members.includes(opponentUid)) {
      throw new HttpsError("permission-denied", "Both players must be members of that group.");
    }
  }

  const gameRef = db.collection("games").doc();
  const date = new Date().toISOString().slice(0, 10);
  const batch = db.batch();
  batch.set(gameRef, {
    groupId: groupIdOrNull,
    date,
    gameType: WARLORD_GAME_TYPE,
    status: "waiting",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
    winner: null,
    players: [uid, opponentUid],
    opponentUid,
    stake: "war",
    seed: null,
    state: null,
    // NO deploy while waiting — the challenger's army stays in warlordDeploys.
  });
  batch.set(db.doc(`warlordDeploys/${gameRef.id}`), {
    challengerUid: uid,
    unitIds: deploy.unitIds,
    combatants: deploy.combatants,
  });
  // In-app notification for the opponent. Written here (Admin SDK) rather than via
  // notifyUsers, which only allows notifying users you share a GROUP with — global
  // challenges have no group. Mirrors respondToFriendRequest's direct write.
  // Clamped, and belt-and-braces on purpose: `profiles` now caps `name` at 60 characters in the
  // rules, but this string becomes a PUSH NOTIFICATION on a stranger's phone — a challenge may be
  // sent to any uid with no group, no friendship and no prior contact. A value that arrives from
  // another document is not this function's to trust, whatever another file promises about it.
  const rawName = (await db.doc(`profiles/${uid}`).get()).data()?.name;
  const challengerName =
    (typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 40) : "A challenger");
  await batch.commit();

  // One call instead of a hand-written row plus a hand-written push that had drifted into saying
  // the same thing twice, in English, with no token pruning. Never fails the challenge.
  await notify({
    userIds: [opponentUid],
    createdBy: uid,
    type: "warlord_challenge",
    titleKey: "notifWarlordChallenge",
    bodyKey: "notifWarlordChallengeBody",
    param: challengerName,
    data: { route: "/warlord" },
  });
  return { gameId: gameRef.id };
});

interface WarlordLadderUpdate { winner: string | null; loser: string | null }

// Record a finished battle in the public world roster (server-only fields).
// Best-effort: a ladder-stat hiccup must never fail the battle itself.
async function recordWarlordResult(winnerUid: string | null, loserUid: string | null): Promise<void> {
  try {
    const db = admin.firestore();
    const inc = admin.firestore.FieldValue.increment(1);
    const writes: Promise<unknown>[] = [];
    if (winnerUid) writes.push(db.doc(`warlordPlayers/${winnerUid}`).set({ wins: inc }, { merge: true }));
    if (loserUid) writes.push(db.doc(`warlordPlayers/${loserUid}`).set({ losses: inc }, { merge: true }));
    await Promise.all(writes);
  } catch (e) {
    console.error("Warlord ladder update failed:", e);
  }
}

// Apply one battle command. The seat check + the pure engine are the entire
// authority: an illegal command is rejected (applied:false, nothing persisted —
// the engine's skip path consumes no rng, so dropping it is determinism-safe).
export const submitWarlordCommand = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const gameId = requireGameId(request.data);
  const cmd = parseWarlordCommand(request.data?.command);
  if (!cmd) throw new HttpsError("invalid-argument", "Malformed command.");

  const db = admin.firestore();
  const ref = db.doc(`games/${gameId}`);
  let ladder: WarlordLadderUpdate | null = null;

  const result = await db.runTransaction(async (tx) => {
    ladder = null; // transaction callbacks re-run on contention — never reuse an aborted attempt's value
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Game not found.");
    const g = snap.data()!;
    if (g.gameType !== WARLORD_GAME_TYPE || g.status !== "playing") {
      throw new HttpsError("failed-precondition", "Not an active Warlord battle.");
    }
    const battle = g.state as BattleState;
    if (!battle || battle.status !== "ONGOING") {
      throw new HttpsError("failed-precondition", "Battle already resolved.");
    }
    if (!Array.isArray(g.players) || !g.players.includes(uid)) {
      throw new HttpsError("permission-denied", "You aren't a participant in this battle.");
    }
    const seatUid = g.players[battle.side === "PLAYER" ? 0 : 1];
    if (seatUid !== uid) throw new HttpsError("permission-denied", "Not your turn.");

    const next = applyCommand(battle, cmd);

    // The engine's reject path appends a 'skipped' entry; a legal command never does.
    const last = next.log.length > 0 ? next.log[next.log.length - 1] : null;
    if (last && last.kind === "skipped") {
      return { applied: false, finished: false };
    }

    const patch: Record<string, unknown> = {
      state: next,
      lastMoveAt: admin.firestore.FieldValue.serverTimestamp(), // resets the turn-timeout clock
    };
    const finished = next.status !== "ONGOING";
    if (finished) {
      const winnerUid =
        next.status === "PLAYER_WON" ? g.players[0] :
        next.status === "ENEMY_WON" ? g.players[1] : null; // DRAW → null (arcade convention)
      patch.status = "finished";
      patch.winner = winnerUid;
      patch.finalized = true; // server-side session lock; leaderboard needs no client write
      patch.endedAt = admin.firestore.FieldValue.serverTimestamp();
      ladder = winnerUid
        ? { winner: winnerUid, loser: g.players.find((p: string) => p !== winnerUid) ?? null }
        : null; // draws don't move the ladder
    }
    tx.update(ref, patch);
    return { applied: true, finished };
  });

  const done = ladder as WarlordLadderUpdate | null;
  if (done) await recordWarlordResult(done.winner, done.loser);
  return result;
});

// Retreat (= concede) an active battle, or decline/cancel a waiting challenge.
export const forfeitWarlordBattle = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const gameId = requireGameId(request.data);

  const db = admin.firestore();
  const ref = db.doc(`games/${gameId}`);
  let ladder: WarlordLadderUpdate | null = null;

  const result = await db.runTransaction(async (tx) => {
    ladder = null; // see above: reset per attempt so retries/early returns can't replay it
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Game not found.");
    const g = snap.data()!;
    if (g.gameType !== WARLORD_GAME_TYPE) throw new HttpsError("failed-precondition", "Not a Warlord battle.");
    if (!Array.isArray(g.players) || !g.players.includes(uid)) {
      throw new HttpsError("permission-denied", "You aren't a participant in this battle.");
    }

    if (g.status === "finished") return { ok: true, already: true }; // idempotent

    if (g.status === "waiting") {
      tx.delete(ref); // decline (opponent) or cancel (creator) — no scoreboard noise
      tx.delete(db.doc(`warlordDeploys/${gameId}`)); // clean the private staging doc
      return { ok: true, declined: true };
    }

    // playing → retreat = loss. Mark BOTH the doc and the state (terminal annotation,
    // never replayed through applyCommand, consumes no rng) so the client write-back
    // (applyBattleResult reads state.winner) needs no special case.
    const loserIsChallenger = uid === g.players[0];
    const winnerUid = loserIsChallenger ? g.players[1] : g.players[0];
    const s = structuredClone(g.state) as BattleState;
    s.status = loserIsChallenger ? "ENEMY_WON" : "PLAYER_WON";
    s.winner = loserIsChallenger ? "ENEMY" : "PLAYER";
    s.phase = "RESOLVED";
    s.log.push({ turn: s.turn, side: s.side, kind: "victory", detail: { status: s.status, forfeit: 1 } });

    tx.update(ref, {
      status: "finished",
      winner: winnerUid,
      forfeitedBy: uid,
      finalized: true,
      state: s,
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ladder = { winner: winnerUid, loser: uid };
    return { ok: true };
  });

  const done = ladder as WarlordLadderUpdate | null;
  if (done) await recordWarlordResult(done.winner, done.loser);
  return result;
});

// Claim a win when the opponent has stopped playing. Without this, an abandoned
// battle is immortal: it never ends, and the units staked in it are excluded from
// every new deployment — an opponent who simply walks away would permanently
// confiscate part of your army, with "retreat" (a self-inflicted loss) as the only exit.
// Only the WAITING player may claim, and only after the timeout has actually elapsed.
export const claimWarlordTimeout = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const gameId = requireGameId(request.data);

  const db = admin.firestore();
  const ref = db.doc(`games/${gameId}`);
  let ladder: WarlordLadderUpdate | null = null;

  const result = await db.runTransaction(async (tx) => {
    ladder = null; // reset per attempt (callbacks re-run on contention)
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Game not found.");
    const g = snap.data()!;
    if (g.gameType !== WARLORD_GAME_TYPE) throw new HttpsError("failed-precondition", "Not a Warlord battle.");
    if (g.status === "finished") return { ok: true, already: true }; // idempotent
    if (g.status !== "playing") throw new HttpsError("failed-precondition", "That battle hasn't started.");
    if (!Array.isArray(g.players) || !g.players.includes(uid)) {
      throw new HttpsError("permission-denied", "You aren't a participant in this battle.");
    }
    const battle = g.state as BattleState;
    if (!battle || battle.status !== "ONGOING") throw new HttpsError("failed-precondition", "Battle already resolved.");

    // Only the player who is WAITING can claim — you can never time out your own turn.
    const stalledUid = g.players[battle.side === "PLAYER" ? 0 : 1];
    if (stalledUid === uid) throw new HttpsError("failed-precondition", "It's your turn — make a move.");

    const stampMs =
      (g.lastMoveAt?.toMillis?.() as number | undefined) ??
      (g.startedAt?.toMillis?.() as number | undefined) ?? 0;
    // A battle from before this field existed has no clock; start it now rather than
    // handing out a free win.
    if (!stampMs) {
      tx.update(ref, { lastMoveAt: admin.firestore.FieldValue.serverTimestamp() });
      // RETURNED, not thrown. A throw inside a transaction rolls the whole transaction back, the
      // update above included — so the clock never started, every claim said it just had, and a
      // battle from before this field existed could never time out at all. The error is thrown
      // below, after the commit, so the player still gets the same message.
      return { clockStarted: true as const };
    }
    const elapsedH = (Date.now() - stampMs) / 3600000;
    if (elapsedH < WARLORD_TURN_TIMEOUT_HOURS) {
      const left = Math.ceil(WARLORD_TURN_TIMEOUT_HOURS - elapsedH);
      throw new HttpsError("failed-precondition", `Not yet — the opponent has ${left}h left to move.`);
    }

    // Terminal annotation, same shape as a forfeit: the stalled side loses.
    const stalledIsChallenger = stalledUid === g.players[0];
    const s = structuredClone(battle) as BattleState;
    s.status = stalledIsChallenger ? "ENEMY_WON" : "PLAYER_WON";
    s.winner = stalledIsChallenger ? "ENEMY" : "PLAYER";
    s.phase = "RESOLVED";
    s.log.push({ turn: s.turn, side: s.side, kind: "victory", detail: { status: s.status, timeout: 1 } });

    tx.update(ref, {
      status: "finished",
      winner: uid,
      timedOutBy: stalledUid,
      finalized: true,
      state: s,
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ladder = { winner: uid, loser: stalledUid };
    return { ok: true, claimed: true };
  });

  const done = ladder as WarlordLadderUpdate | null;
  if (done) await recordWarlordResult(done.winner, done.loser);
  if ("clockStarted" in result) {
    throw new HttpsError("failed-precondition", "The timeout clock has just started for this battle.");
  }
  return result;
});

// Turn/lifecycle push notifications. Fires on EVERY games/{id} update (Firestore
// triggers can't filter on field values) — exits before any reads for other types.
// Performs zero Firestore writes → cannot retrigger itself.
export const onWarlordBattleUpdated = onDocumentUpdated("games/{gameId}", async (event) => {
  const change = event.data;
  if (!change) return;
  const after = change.after.data();
  if (!after || after.gameType !== WARLORD_GAME_TYPE) return;
  const before = change.before.data() || {};
  const players: string[] = Array.isArray(after.players) ? after.players : [];
  if (players.length !== 2) return;

  // One push target set per branch (else-if: the accept write flips status AND
  // creates state — it must not also fire the turn branch).
  let targets: { uid: string; titleKey: string; bodyKey: string }[] = [];

  if (before.status === "waiting" && after.status === "playing") {
    targets = [{
      uid: players[0], // initial side = PLAYER = seat 0 (the challenger moves first)
      titleKey: "notifWarlordJoined",
      bodyKey: "notifWarlordJoinedBody",
    }];
  } else if (before.status !== "finished" && after.status === "finished") {
    const w = after.winner;
    // Retreat is a separate KEY rather than a suffix appended to the outcome: the renderer only
    // appends one parameter, and a parameter is the same string for every recipient — so a
    // translated "(by retreat)" could not be expressed that way at all.
    const retreat = !!after.forfeitedBy;
    targets = players.map((uid) => ({
      uid,
      titleKey: "notifWarlordOver",
      bodyKey: w == null
        ? "notifWarlordDraw"
        : uid === w
          ? (retreat ? "notifWarlordVictoryRetreat" : "notifWarlordVictory")
          : (retreat ? "notifWarlordDefeatRetreat" : "notifWarlordDefeat"),
    }));
  } else if (after.status === "playing" && before.state?.side !== after.state?.side) {
    const seatUid = players[after.state.side === "PLAYER" ? 0 : 1];
    targets = [{ uid: seatUid, titleKey: "notifWarlordTurn", bodyKey: "notifWarlordTurnBody" }];
  }
  if (targets.length === 0) return;

  // `createdBy` is the OTHER player: notify drops the actor from its own recipients, and here the
  // recipient IS the person being told, so naming them as the cause would silently deliver
  // nothing at all.
  for (const t of targets) {
    await notify({
      userIds: [t.uid],
      createdBy: players.find((p: string) => p !== t.uid) || "",
      type: "warlord",
      titleKey: t.titleKey,
      bodyKey: t.bodyKey,
      data: { route: "/warlord" },
    });
  }
});


// ── The assistant's visibility oracle ───────────────────────────────────────────────────
//
// Slice 1 of the cross-group assistant, and deliberately NOT the assistant: this calls no
// model, persists nothing and costs no tokens. It answers one question — "what would the
// assistant be able to see for me, in this period?" — as numbers and titles, so the whole
// privacy claim can be checked against the calendar on screen BEFORE a single token is spent.
//
// It reads only through `deriveScope`, whose branded return type is the only thing the
// fetchers accept, and it uses its OWN quota bucket: the shared `ai_usage` bucket is already
// split between five callables, and letting a preview eat it would starve the checklist and
// the category suggestion by lunchtime.
export const aiPreviewScope = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  if (!(await tryConsumeQuota(uid, "ai_preview_usage", AI_PREVIEW_DAILY_LIMIT))) {
    throw new HttpsError("resource-exhausted", "Daily preview limit reached.");
  }

  const { from, to, year, month } = (request.data || {}) as Record<string, unknown>;
  const period =
    typeof from === "string" && typeof to === "string"
      ? dayRangePeriod(from, to)
      : typeof year === "number" && typeof month === "number"
        ? monthPeriod(year, month)
        : null;
  if (!period) {
    // Refuses rather than guessing: a guessed period answers about a different month than the
    // one asked about, and the caller could never see that it had happened.
    throw new HttpsError("invalid-argument", "Give either {from,to} as yyyy-MM-dd, or {year,month}.");
  }
  if (periodDays(period) > AI_MAX_PERIOD_DAYS) {
    throw new HttpsError("invalid-argument", `A period may not exceed ${AI_MAX_PERIOD_DAYS} days.`);
  }

  try {
    const scope = await deriveScope(uid);
    const [events, chat, assets, expenses] = await Promise.all([
      fetchEvents(scope, period, AI_DOC_BUDGET),
      fetchChat(scope, period, Math.floor(AI_DOC_BUDGET / 2)),
      fetchAssets(scope, Math.floor(AI_DOC_BUDGET / 4)),
      fetchExpenses(scope, period, Math.floor(AI_DOC_BUDGET / 4)),
    ]);

    // All three, not just expenses. The fetchers stay free of side effects and report the
    // condition as data; logging is the caller's job. A missing composite index looks exactly
    // like a quiet month otherwise — which is how a denied collection went unnoticed for three
    // months, and there was no reason for events and chat to be exempt from the lesson.
    for (const [what, src] of [["expenses", expenses], ["events", events], ["chat", chat]] as const) {
      if (src.unavailable) {
        void logServerError(`${what} ${src.unavailable}`, "ai:previewScope", { uid });
      }
    }

    return {
      period: { fromDay: period.fromDay, toDay: period.toDay, days: periodDays(period) },
      scope: {
        groups: scope.groupIds.length,
        totalGroups: scope.totalGroups,
        truncated: scope.truncated,
      },
      events: {
        count: events.items.length,
        complete: events.complete,
        // `complete` reflects only whether the Firestore READ was cut. The slice below is a
        // second, later truncation that contributed nothing to it, so a caller was handed 200 of
        // 900 rows next to `count: 900` and `complete: true`. The screen builds its day list
        // purely from `preview`, so the missing days simply were not there.
        previewTruncated: events.items.length > 200,
        // Titles, so this can be compared against the calendar by eye. Nothing else from the
        // document: no description, no location, no checklist, no assignees.
        ...(events.unavailable ? { unavailable: events.unavailable } : {}),
        preview: events.items.slice(0, 200).map((e) => ({
          day: e.day, title: e.title, isTask: e.isTask,
          scopeLabel: e.scopeLabel, outOfScope: e.outOfScope, virtual: e.virtual,
        })),
      },
      chat: {
        count: chat.items.length,
        complete: chat.complete,
        ...(chat.unavailable ? { unavailable: chat.unavailable } : {}),
      },
      assets: { count: assets.items.length, complete: assets.complete },
      expenses: {
        count: expenses.items.length,
        complete: expenses.complete,
        previewTruncated: expenses.items.length > 200,
        // Carried through, so "could not read" never arrives looking like "nothing to read".
        ...(expenses.unavailable ? { unavailable: expenses.unavailable } : {}),
        // The same shape as the events preview, and `description` is not an inconsistency with
        // it: an event has a title AND a description and only the title comes back, while an
        // expense has no title — `description` IS its label, the "Cina restaurant" on the row.
        // Withholding it would return rows of bare numbers that could not be checked against
        // anything. `paidBy` stays out: it adds nothing to a scope check and it is the one field
        // that names a person.
        preview: expenses.items.slice(0, 200).map((e) => ({
          day: e.day, amount: e.amount, description: e.description,
          scopeLabel: e.groupId ? (scope.groupNames[e.groupId] || "group") : "personal",
        })),
      },
    };
  } catch (error: any) {
    void logServerError(error?.message || "aiPreviewScope failed", "ai:previewScope", { stack: error?.stack });
    throw new HttpsError("internal", "Could not read your data.");
  }
});

// ── AI spend, for the admin ─────────────────────────────────────────────────────────────
//
// Reads the rollups written beside every ledger row. Aggregates first, drill-down second:
// a per-row list is the thing you reach for once you already know WHICH day and WHICH
// feature is spending, and reading a month of rows to find that out is itself a cost.
export const adminGetAiSpend = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();

  // The window is CHOSEN from a fixed set, never taken from the wire. Each day costs one read per
  // subcollection, so an attacker-supplied 3650 would be seven thousand reads on one callable.
  const asked = Number((request.data || {}).days);
  const window = asked === 7 ? 7 : 30;

  const days: string[] = [];
  for (let i = 0; i < window; i++) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }

  const snaps = await Promise.all(days.map((d) => db.doc(`aiSpendDaily/${d}`).get()));
  // NEWEST first. `GrowthChart` in the admin draws left-to-right as given and labels the first
  // entry on the left, so the caller must reverse this or the axis lies about which end is today.
  const daily = snaps.map((s, i) => {
    const d = s.exists ? s.data() || {} : {};
    return {
      date: days[i],
      calls: d.calls || 0,
      failures: d.failures || 0,
      promptTokens: d.promptTokens || 0,
      completionTokens: d.completionTokens || 0,
      usd: (d.microUsd || 0) / 1_000_000,
    };
  });

  const sum = (n: number) => daily.slice(0, n).reduce((a, r) => a + r.usd, 0);

  // EVERY row for EVERY day in the window, with no per-day `orderBy`/`limit`.
  //
  // The cheap version — reuse the old per-day top ten and merge thirty of them — ranks the wrong
  // people: somebody eleventh every day for a month outspends somebody first once, and a
  // truncated merge never sees them. The cost is bounded by the WINDOW instead, which is why the
  // window is capped rather than offered as a year. See `aiSpendMerge.ts`.
  //
  // A day whose read fails becomes `null`, not an empty array — absent and zero are different
  // answers, and `complete` below is what lets the screen say which it is showing.
  const readDay = (path: string) => db.collection(path).get()
    .then((s) => s.docs.map((x) => ({ id: x.id, ...(x.data() as Record<string, unknown>) })))
    .catch((err) => { console.error("aiSpend day read failed", path, err?.message || err); return null; });

  const [featureDays, userDays] = await Promise.all([
    Promise.all(days.map((d) => readDay(`aiSpendDaily/${d}/features`))),
    Promise.all(days.map((d) => readDay(`aiSpendDaily/${d}/users`))),
  ]);
  const complete = !featureDays.includes(null) && !userDays.includes(null);

  // Today against the limit, read from the document the limit is actually enforced against —
  // NOT from the daily rollup. The two differ by whatever is in flight: `holdBudget` pre-charges
  // a ceiling before the call and reconciles downward after it, so this one is the number that
  // decides whether the next call is refused, which is the number worth showing.
  const eff = await effectiveLimits();
  const budgetSnap = await db.doc("ai_budget/_global").get().catch(() => null);
  const b = budgetSnap && budgetSnap.exists ? budgetSnap.data() || {} : {};
  const todayGlobalUsd = b.date === days[0] ? (b.microUsd || 0) / 1_000_000 : 0;

  return {
    days: window,
    daily,
    totals: { today: sum(1), week: sum(Math.min(7, window)), month: sum(window) },
    byFeature: mergeRollups(featureDays).map((r) => ({
      feature: r.id, calls: r.calls, failures: r.failures, usd: r.usd,
    })),
    topUsers: mergeRollups(userDays).slice(0, 20).map((r) => ({
      uid: r.id, calls: r.calls, failures: r.failures, usd: r.usd,
    })),
    // What is ACTUALLY enforced right now, read the same way `holdBudget` reads it. Reporting
    // the module constants would have shown the environment's values while a saved `aiConfig/live`
    // quietly overrode them — a screen and a bill telling two stories.
    limits: { ...eff.limits, source: eff.source },
    todayGlobalUsd,
    complete,
  };
});

/**
 * The live AI configuration, plus who changed it and when.
 *
 * `outsideAdmin` is the interesting field. The Firebase console writes with the Admin SDK, which
 * bypasses both the rules and this callable, so the log can NEVER be complete. Rather than
 * present an incomplete history as a full one, the document's own stamp is compared with the
 * newest log row and the disagreement is reported.
 */
export const adminGetAiConfig = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();

  const [snap, logSnap] = await Promise.all([
    db.doc(AI_CONFIG_PATH).get(),
    db.collection("aiConfigLog").orderBy("at", "desc").limit(20).get().catch(() => null),
  ]);

  const rows = (logSnap ? logSnap.docs : []).map((d) => {
    const r = d.data() || {};
    return {
      id: d.id,
      at: r.at && typeof r.at.toDate === "function" ? r.at.toDate().toISOString() : null,
      byEmail: r.by?.email || "",
      from: r.from || null,
      to: r.to || null,
      requested: r.requested || null,
    };
  });

  const stored = snap.exists ? snap.data() || {} : null;

  // Compare the VALUES, not the uids.
  //
  // The uid comparison could not detect the case it was written for: editing `globalDailyUsd` in
  // the Firebase console leaves `updatedBy` and `updatedAt` untouched, so the uids still match,
  // no warning appears — and the screen then states "Last changed <old date> by <old email>",
  // actively asserting a provenance that is false. The newest log row records what the callable
  // last wrote; if the document no longer says that, something else wrote it.
  const newestTo = rows.length > 0 ? (logSnap!.docs[0].data()?.to || null) : null;
  const outsideAdmin = changedOutsideAdmin(stored, newestTo);

  const eff = await effectiveLimits();
  return {
    exists: snap.exists,
    effective: { ...eff.limits, source: eff.source },
    // The RAW stored values, beside the clamped ones. Without this there is no field on the
    // screen through which a document disagreeing with what is enforced could ever be seen: a
    // console-written 500 displays as 50 and looks like somebody typed 50.
    stored: stored ? {
      globalDailyUsd: stored.globalDailyUsd ?? null,
      userDailyUsd: stored.userDailyUsd ?? null,
      killSwitch: stored.killSwitch ?? null,
    } : null,
    updatedAt: stored?.updatedAt && typeof stored.updatedAt.toDate === "function"
      ? stored.updatedAt.toDate().toISOString() : null,
    updatedByEmail: stored?.updatedByEmail || "",
    outsideAdmin,
    log: rows,
  };
});

/**
 * Change the live AI budget.
 *
 * Two guards, and they do different jobs. `clampAiLimits` decides what the NUMBERS may be — the
 * server owns those bounds, never the form, because an extra zero is a hundredfold bill.
 * `configChangeAllowed` decides who may move them in which DIRECTION: anyone with the admin may
 * make things safer, only the owner may make them riskier. That asymmetry exists because
 * `adminSetAdmin` is gated by `assertAdmin` alone, so any admin can mint another admin.
 *
 * The document and its log row go in ONE batch, and it is not best-effort: a configuration change
 * that cannot be recorded should not happen.
 */
export const adminSetAiConfig = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = await assertAdmin(request);
  const db = admin.firestore();

  const email = String(request.auth?.token?.email || "").toLowerCase();
  const emailVerified = request.auth?.token?.email_verified === true;
  const actor = emailVerified && BOOTSTRAP_ADMIN_EMAILS.includes(email) ? "owner" : "admin";

  const requested = (request.data || {}) as Record<string, unknown>;
  const clamped = clampAiLimits({
    globalDailyUsd: requested.globalDailyUsd,
    userDailyUsd: requested.userDailyUsd,
    killSwitch: requested.killSwitch,
  });
  const to: AiConfigFields = {
    globalDailyUsd: clamped.globalDailyUsd,
    userDailyUsd: clamped.userDailyUsd,
    killSwitch: clamped.killSwitch,
  };

  const configRef = db.doc(AI_CONFIG_PATH);
  const logRef = db.collection("aiConfigLog").doc();

  // ── Read the STORED value, in the transaction that writes ────────────────────────────────
  //
  // NOT `effectiveLimits()`. That function is built never to fail — on a read error it returns a
  // per-instance cache or the compiled defaults — which is right for the hot path, where a blip
  // must not stop the app, and wrong here, where `from` decides whether this change is a RAISE.
  //
  // Fed a fabricated baseline, the ratchet inverts: with `{global: 1, killSwitch: true}` stored
  // and the read failing, `from` becomes `{5, 0.25, false}`, and a non-owner submitting exactly
  // that reads as "no change" — allowed — which raises the cap AND clears a pressed kill switch.
  // Worse, the `aiConfigLog` row would record that invention as the previous value, and that row
  // is the only answer to "who raised the cap last Tuesday". An audit that can invent its own
  // baseline is not an audit.
  //
  // The transaction also closes the two-admins-at-once race: the old code read, then committed an
  // unconditional batch, so the later Save silently won with a stale `from`.
  //
  // `holdBudget` deliberately reads this document OUTSIDE its transaction — putting it in the read
  // set of every AI call would make one Save conflict with everything in flight. That argument
  // does not transfer to a callable that runs when somebody presses a button.
  let from: AiConfigFields;
  let fromSource: string;
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(configRef);
      const stored = snap.exists ? (snap.data() || {}) : null;
      // The RAW stored values, clamped only for comparison. A console-written 500 must not be
      // logged as a previous value of 50.
      const prev = stored
        ? clampAiLimits(stored as Record<string, unknown>)
        : clampAiLimits({
            globalDailyUsd: AI_LIMITS.globalDailyUsd,
            userDailyUsd: AI_LIMITS.userDailyUsd,
            killSwitch: AI_LIMITS.killSwitch,
          });
      const seenSource = stored ? "aiConfig/live" : LIMITS_SOURCE;
      const before: AiConfigFields = {
        globalDailyUsd: prev.globalDailyUsd,
        userDailyUsd: prev.userDailyUsd,
        killSwitch: prev.killSwitch,
      };

      const verdict = configChangeAllowed(actor, before, to);
      if (!verdict.allowed) throw new HttpsError("permission-denied", verdict.reason);

      tx.set(configRef, {
        ...to,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByEmail: email,
      }, { merge: true });
      // `create`, not `set`: append-only becomes a property of the OPERATION rather than a promise
      // about this one call site. A future `set` to an existing id would be a silent rewrite.
      tx.create(logRef, {
        schema: 1,
        at: admin.firestore.FieldValue.serverTimestamp(),
        by: { uid, email },
        actor,
        from: before,
        fromSource: seenSource,
        to,
        // What the form SENT, beside what the server stored. If somebody types 10000 and the
        // ceiling brings it to 50, the screen, the log and the bill must not tell three stories.
        requested: {
          globalDailyUsd: requested.globalDailyUsd ?? null,
          userDailyUsd: requested.userDailyUsd ?? null,
          killSwitch: requested.killSwitch ?? null,
        },
        clamped: clamped.clamped,
      });
      return { before, seenSource };
    });
    from = outcome.before;
    fromSource = outcome.seenSource;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // Refuse rather than guess. Nothing is written, and the operator is told to try again — which
    // is a far better outcome than a change recorded against a baseline nobody ever stored.
    console.error("adminSetAiConfig transaction failed", (err as { message?: string })?.message || err);
    throw new HttpsError("unavailable", "Could not read the current configuration. Nothing was changed.");
  }

  // Cloud Logging, so the money change is visible where the FALLBACK already is. Without it,
  // `aiLedger.ts` logs a failed config read while the change itself leaves no trace in the
  // function log at all — the wrong way round. Same JSON-line shape as ERROR_DIGEST.
  console.log(JSON.stringify({
    evt: "AI_CONFIG_CHANGE", by: email, actor, from, fromSource, to,
    requested: request.data, clamped: clamped.clamped,
  }));

  return { saved: to, previous: from, clamped: clamped.clamped, actor };
});

/** Row-level drill-down, filtered. Never returns prompt or response text — there is none. */
export const adminGetAiLedger = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const { date, uid } = (request.data || {}) as { date?: string; uid?: string };
  const day = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);

  let q: FirebaseFirestore.Query = admin.firestore().collection("aiLedger").where("date", "==", day);
  if (typeof uid === "string" && uid) q = q.where("uid", "==", uid);

  // ── `orderBy("at")`, and why it is not cosmetic ────────────────────────────────────────────
  //
  // There was no ordering at all. Firestore's implicit order is by document id, and these ids come
  // from `.doc()` — random. So on a day with more than two hundred calls the cap returned a
  // deterministic ARBITRARY two hundred: not the newest, not the costliest, not the failures, and
  // with no cursor the rest were unreachable through this callable at all. `truncated` said rows
  // were missing; it did not say the ones on screen were a random sample, which is the part that
  // makes a number on a cost screen untrustworthy.
  //
  // This costs two composite indexes — (date, at desc) and (date, uid, at desc), both in
  // `firestore.indexes.json`. A MISSING index here does not return less, it throws
  // FAILED_PRECONDITION and kills the call, so the indexes deploy BEFORE these functions.
  //
  // Filtering by feature or by outcome is deliberately NOT done here: each equality filter
  // alongside an `orderBy` on a different field needs its own composite index, and eight of them
  // to serve four chips is a bad trade. The admin filters the returned rows, which is honest now
  // that they are the newest two hundred rather than an arbitrary two hundred.
  const snap = await q.orderBy("at", "desc").limit(200).get();
  return {
    date: day,
    rows: snap.docs.map((d) => {
      const r = d.data() || {};
      return {
        id: d.id,
        uid: r.uid || "",
        feature: r.feature || "",
        model: r.model || "",
        ok: r.ok,
        errorCode: r.errorCode || null,
        promptTokens: r.promptTokens || 0,
        completionTokens: r.completionTokens || 0,
        costUsd: r.costUsd || 0,
        computeMs: r.computeMs || 0,
        // A Firestore Timestamp does not survive the callable wire as anything useful.
        at: r.at && typeof r.at.toDate === "function" ? r.at.toDate().toISOString() : null,
      };
    }),
    truncated: snap.size >= 200,
  };
});

/**
 * Backfill the scoping fields the `expenses` collection never had.
 *
 * Why it exists: `firestore.rules` had no `match /expenses` block until 2026-08-25, which in
 * Firestore means denied. The tab shipped 2026-05-07 while the project was still open, the rules
 * landed 2026-05-22 without it, and everything written in that window carries only
 * `{amount, description, paidBy, createdAt}` — no field the new rule can read, so those documents
 * are invisible to their own authors.
 *
 * DRY RUN BY DEFAULT. It reports what it would do and writes nothing unless `apply` is true, and
 * it never guesses a group: `ownerId` comes from `paidBy`, which is certain, while a document
 * whose author belongs to several groups is reported as AMBIGUOUS and left alone. Assigning it
 * would put someone's private spending into a group ledger on a coin toss.
 */
export const adminBackfillExpenses = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const apply = (request.data || {}).apply === true;
  const db = admin.firestore();

  const [expenses, groups] = await Promise.all([
    db.collection("expenses").limit(5000).get(),
    db.collection("groups").limit(2000).get(),
  ]);

  const groupsOf: Record<string, string[]> = {};
  groups.forEach((g) => {
    const members: string[] = Array.isArray(g.data()?.members) ? g.data().members : [];
    for (const uid of members) (groupsOf[uid] ||= []).push(g.id);
  });

  const report = {
    total: expenses.size,
    alreadyScoped: 0,
    noPaidBy: 0,
    wouldSetOwnerOnly: 0,   // author is in no group, or in several — personal is the safe landing
    wouldSetOwnerAndGroup: 0, // author is in exactly one group, so there is nothing to guess
    ambiguous: [] as { id: string; paidBy: string; groups: number }[],
    applied: 0,
  };

  const batch = db.batch();
  let queued = 0;

  for (const d of expenses.docs) {
    const data = d.data() || {};
    if (typeof data.ownerId === "string" && data.ownerId) { report.alreadyScoped++; continue; }
    const paidBy = typeof data.paidBy === "string" ? data.paidBy : "";
    if (!paidBy) { report.noPaidBy++; continue; }

    const mine = groupsOf[paidBy] || [];
    const patch: Record<string, unknown> = { ownerId: paidBy };
    if (mine.length === 1) {
      patch.groupId = mine[0];
      report.wouldSetOwnerAndGroup++;
    } else {
      // Personal. Recoverable by hand afterwards; the opposite is not.
      patch.groupId = null;
      report.wouldSetOwnerOnly++;
      if (mine.length > 1) report.ambiguous.push({ id: d.id, paidBy, groups: mine.length });
    }
    if (apply && queued < 450) { batch.update(d.ref, patch); queued++; }
  }

  if (apply && queued > 0) {
    await batch.commit();
    report.applied = queued;
  }
  return { dryRun: !apply, ...report };
});
