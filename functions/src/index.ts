import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { applyCommand } from "./warlordCombat/combat/engine";
import { sanitizeDeploy, createPvpBattle } from "./warlordCombat/combat/pvp";
import type { BattleState, Command } from "./warlordCombat/combat/types";
import { deriveScope } from "./aiScope";
import { fetchAssets, fetchChat, fetchEvents, fetchExpenses } from "./aiSources";
import { dayRangePeriod, monthPeriod, periodDays, isRealDay } from "./period";
import { charsPerToken, estimateUsdFor, usageOf, withLedger } from "./aiLedger";

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
const AI_MODEL = "gemini-2.5-flash-lite";
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



// Stop an event advertising AI work that will never run.
//
// `onDocumentCreated` fires once per document, so if the trigger ends without clearing this the
// event keeps `ai_assistant` in its assignees forever and there is no retry path short of creating
// a new event. Best effort by design: it runs on failure paths, where another write may also fail.
async function clearAiAssignee(
  snapshot: { ref: FirebaseFirestore.DocumentReference },
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  try {
    const ids: string[] = Array.isArray(data?.assigneeIds) ? data.assigneeIds : [];
    if (!ids.includes("ai_assistant")) return;
    await snapshot.ref.update({ assigneeIds: ids.filter((id) => id !== "ai_assistant") });
  } catch (err) {
    console.error("could not clear ai_assistant", (err as any)?.message || err);
  }
}

export const autoSuggestChecklist = onDocumentCreated({
  document: "events/{eventId}"
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  
  // We only intercept if assigned to "ai_assistant"
  if (!data.assigneeIds || !data.assigneeIds.includes("ai_assistant")) {
    return;
  }

  // Rate-limit the trigger by the event owner, sharing the same daily AI quota
  // as the callables — otherwise this is a free path to spam Gemini by creating
  // events with the ai_assistant assignee.
  const ownerId = data.ownerId;
  if (ownerId && !(await tryConsumeQuota(ownerId, "ai_usage", AI_DAILY_LIMIT))) {
    console.log(`AI daily quota exceeded for ${ownerId}; skipping auto-checklist.`);
    return;
  }

  // If there's already a non-empty checklist, we might skip to not overwrite.
  // But maybe the user assigned it just to get suggestions added!

  const title = data.title;
  const description = data.description || "";

  try {
    const key = process.env.GEMINI_API_KEY_LOCAL;
    if (!key) {
      console.error("GEMINI_API_KEY_LOCAL missing from environment.");
      return;
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

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
      () => model.generateContent(prompt),
      usageOf,
      prompt.length,
    );
    const text = result.response.text();
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const list = JSON.parse(cleanText);

    if (Array.isArray(list)) {
      const newItems = list.map((itemText) => ({
        id: Date.now().toString() + Math.random().toString().slice(2, 6),
        text: String(itemText),
        isCompleted: false,
        assetUrl: null,
        assetId: null
      }));

      const existingItems = data.checklistItems || [];
      const combinedItems = [...existingItems, ...newItems];

      // Remove the ai_assistant from assigneeIds since the task is "processed",
      // so it doesn't get infinitely processed.
      const newAssignees = data.assigneeIds.filter((id: string) => id !== "ai_assistant");

      await snapshot.ref.update({
        checklistItems: combinedItems,
        assigneeIds: newAssignees
      });
      console.log(`Successfully generated checklist for: ${title}`);
    } else {
      // `JSON.parse` succeeds for `{"items":[...]}`, so the catch below never sees this — the
      // function simply fell off the end. The call was already PAID FOR: the ledger row closed
      // ok, the hold settled, and one of the owner's fifty daily calls was spent. Meanwhile the
      // event kept advertising `ai_assistant`, and onDocumentCreated cannot fire twice for the
      // same document, so there was no retry short of creating a new event.
      void logServerError("model returned a non-array checklist", "ai:generateChecklist", { uid: ownerId });
      await clearAiAssignee(snapshot, data);
    }
  } catch (error) {
    console.error("AI Generation Error", error);
    void logServerError((error as any)?.message || "AI generation error", "ai:generateChecklist", { stack: (error as any)?.stack });
    // Every terminal path has to stop the event advertising work that can never run.
    await clearAiAssignee(snapshot, data);
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

    const groupName = groupData.name || "A group";
    const members = groupData.members || [];
    const targetUserIds = members.filter((id: string) => id !== senderId);
    
    if (targetUserIds.length === 0) return;

    const senderDoc = await admin.firestore().doc(`users/${senderId}`).get();
    const senderName = senderDoc.data()?.name || senderDoc.data()?.email?.split('@')[0] || "Someone";

    const tokens: string[] = [];
    for (const uid of targetUserIds) {
      const userDoc = await admin.firestore().doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData?.fcmTokens && Array.isArray(userData.fcmTokens)) {
          tokens.push(...userData.fcmTokens);
        }
      }
    }

    const uniqueTokens = [...new Set(tokens)];
    if (uniqueTokens.length === 0) return;

    const payload = {
      notification: {
        title: `${senderName} in ${groupName}`,
        body: msgData.text || (msgData.imageUrl ? "Sent an image" : "Sent a message"),
      },
      tokens: uniqueTokens
    };

    const response = await admin.messaging().sendEachForMulticast(payload);
    console.log(`Successfully sent ${response.successCount} messages; failed ${response.failureCount}`);
  } catch (error) {
    console.error("Error sending FCM payload:", error);
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

    const groupName = groupData.name || "A group";
    const members = groupData.members || [];
    const targetUserIds = members.filter((id: string) => id !== creatorId);
    
    if (targetUserIds.length === 0) return;

    const creatorDoc = await admin.firestore().doc(`users/${creatorId}`).get();
    const creatorName = creatorDoc.data()?.name || creatorDoc.data()?.email?.split('@')[0] || "Someone";

    const tokens: string[] = [];
    for (const uid of targetUserIds) {
      const userDoc = await admin.firestore().doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData?.fcmTokens && Array.isArray(userData.fcmTokens)) {
          tokens.push(...userData.fcmTokens);
        }
      }
    }

    const uniqueTokens = [...new Set(tokens)];
    if (uniqueTokens.length === 0) return;

    const readableGameType = gameType.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const payload = {
      notification: {
        title: `🎮 New Game in ${groupName}!`,
        body: `${creatorName} wants to play ${readableGameType}. Tap to join!`,
      },
      tokens: uniqueTokens
    };

    const response = await admin.messaging().sendEachForMulticast(payload);
    console.log(`Successfully sent ${response.successCount} game invites; failed ${response.failureCount}`);
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
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

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
      () => model.generateContent(prompt),
      usageOf,
      prompt.length,
    );
    const text = result.response.text();
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const list = JSON.parse(cleanText);

    if (Array.isArray(list)) {
      return { suggestions: list.map(String) };
    }
    return { suggestions: [] };
  } catch (error: any) {
    console.error("AI Generation Error", error);
    void logServerError((error as any)?.message || "AI generation error", "ai:generateChecklist", { stack: (error as any)?.stack });
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
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

    const prompt = `You are a helpful AI Assistant. Given an event title and optional description, categorize it into exactly one of the following category IDs: "work", "family_time", "chores", "health", "other".
Title: "${title}"
${description ? `Description: "${description}"` : ""}

Return ONLY the category ID string, nothing else. No markdown formatting.`;

    const result = await withLedger(
      { feature: 'category', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      () => model.generateContent(prompt),
      usageOf,
      prompt.length,
    );
    const text = result.response.text().trim().toLowerCase();
    
    const validCategories = ["work", "family_time", "chores", "health", "other"];
    const matchedCategory = validCategories.find(c => text.includes(c)) || "other";

    return { categoryId: matchedCategory };
  } catch (error: any) {
    console.error("AI Category Suggestion Error", error);
    void logServerError((error as any)?.message || "AI category error", "ai:suggestCategory", { stack: (error as any)?.stack });
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

    // Get upcoming events
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    const eventsSnapshot = await db.collection('events')
      .where('groupId', '==', groupId)
      .where('date', '>=', now.toISOString())
      .where('date', '<=', nextWeek.toISOString())
      .orderBy('date', 'asc')
      .limit(10)
      .get();
      
    let upcomingEvents = "Upcoming Events (Next 7 days):\n";
    if (eventsSnapshot.empty) {
      upcomingEvents += "(No upcoming events)\n";
    } else {
      eventsSnapshot.docs.forEach(docSnap => {
        const d = docSnap.data();
        upcomingEvents += `- ${d.title} on ${d.date.split('T')[0]}\n`;
      });
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

    const prompt = `You are a helpful AI Assistant for a family/group organization app.
Summarize the recent activity and upcoming events for the group "${groupName}".
Translate your summary to this exact locale language: "${language}".

${chatHistory}

${upcomingEvents}

Provide a brief, friendly, conversational digest (1-2 paragraphs max) that highlights what happened recently and what is coming up. Keep it concise. No markdown headers.`;

    const result = await withLedger(
      { feature: 'group-digest', model: AI_MODEL, uid: callerUid },
      estimateUsdFor(AI_MODEL, prompt.length, await charsPerToken(callerUid)),
      () => model.generateContent(prompt),
      usageOf,
      prompt.length,
    );
    const text = result.response.text().trim();
    
    // The caller is told when the window was cut, so a partial digest can say so instead of
    // reading as the whole story.
    return { digest: text, truncated: digestTruncated };
  } catch (error: any) {
    console.error("AI Group Digest Error", error);
    void logServerError((error as any)?.message || "AI digest error", "ai:groupDigest", { stack: (error as any)?.stack });
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
      throw new HttpsError('failed-precondition', 'AI is not configured on the server.');
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

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
      () => model.generateContent(prompt),
      usageOf,
      prompt.length,
    );
    const resultText = result.response.text().trim();
    
    // Validate that the returned ID is actually in the list, unless it's "none"
    const matchedAsset = availableAssets.find((a: any) => a.id === resultText);
    
    return { assetId: matchedAsset ? matchedAsset.id : null };
  } catch (error: any) {
    console.error("AI Asset Suggestion Error", error);
    void logServerError((error as any)?.message || "AI asset error", "ai:suggestAsset", { stack: (error as any)?.stack });
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
  "location", "reminderMinutes", "assetId",
  "rsvpEnabled", "visibleTo",
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

  const overrideRef = db.collection("events").doc();
  const batch = db.batch();
  batch.set(overrideRef, {
    ...safe,
    ownerId: p.ownerId, // server-authoritative (keep original owner)
    groupId: p.groupId ?? null, // keep within the parent's group
    // Legacy and inert, but carried from the PARENT rather than from the caller: it is not the
    // client's to state on a document it does not own.
    sharedWithFamily: p.sharedWithFamily ?? false,
    updatedAt: new Date().toISOString(),
    overrideOfParent: parentId,
    createdAt: new Date().toISOString(),
  });
  batch.update(parentRef, {
    recurrenceExceptions: admin.firestore.FieldValue.arrayUnion(overrideDate),
  });
  await batch.commit();
  return { id: overrideRef.id };
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

  // Drop the source owner/timestamp; copy everything else to the recipient.
  const { ownerId, createdAt, ...rest } = a;
  void ownerId; void createdAt;
  const copyRef = db.collection("assets").doc();
  const batch = db.batch();
  batch.set(copyRef, {
    ...rest,
    ownerId: recipientId,
    createdAt: new Date().toISOString(),
    transferredFrom: uid,
  });
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

  // One transaction: re-check status, read both users, and write atomically.
  // A request addressed by email can only be accepted by a caller whose email is
  // VERIFIED (prevents claiming a request sent to an address you don't own).
  // Requests addressed by uid (toId) are always safe (uid can't be spoofed).
  return db.runTransaction(async (tx) => {
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

    const senderRef = db.doc(`users/${senderUid}`);
    const accepterRef = db.doc(`users/${uid}`);
    const [senderUser, accepterUser, senderProfile, accepterProfile] = await Promise.all([
      tx.get(senderRef), tx.get(accepterRef),
      tx.get(db.doc(`profiles/${senderUid}`)), tx.get(db.doc(`profiles/${uid}`)),
    ]);

    const senderName = cap(senderProfile.data()?.name || senderUser.data()?.name ||
      fr.fromName || (fr.fromEmail || "").split("@")[0] || "Friend");
    const senderEmail = (senderUser.data()?.email || fr.fromEmail || "").toLowerCase() || null;
    const accepterName = cap(accepterProfile.data()?.name || accepterUser.data()?.name ||
      (email || "").split("@")[0] || "Friend");
    const accepterEmail = (accepterUser.data()?.email || email || "").toLowerCase() || null;

    // Read-filter-write so each side has exactly ONE entry per friend uid (and a
    // re-accept refreshes name/email instead of accumulating stale duplicates).
    const senderFriends = (senderUser.data()?.friends || []).filter((f: any) => f && f.uid !== uid);
    senderFriends.push({ uid, name: accepterName, email: accepterEmail });
    const accepterFriends = (accepterUser.data()?.friends || []).filter((f: any) => f && f.uid !== senderUid);
    accepterFriends.push({ uid: senderUid, name: senderName, email: senderEmail });

    tx.set(senderRef, { friends: senderFriends }, { merge: true });
    tx.set(accepterRef, { friends: accepterFriends }, { merge: true });
    tx.update(reqRef, { status: "accepted", toId: uid });

    // Notify the sender (Admin SDK write bypasses the notifications create rule).
    const notifRef = db.collection("notifications").doc();
    tx.set(notifRef, {
      userId: senderUid,
      createdBy: uid,
      type: "friend",
      // titleKey/bodyKey are what the reader's client translates; title/body stay only as the
      // fallback for rows written before keys existed. Without them this row rendered in the
      // ACCEPTER's English no matter what language the reader had chosen.
      //
      // The renderer concatenates as `${t(bodyKey)}${param}`, so the name goes on the END —
      // a body phrased "{name} accepted…" cannot be expressed through it.
      titleKey: "friendRequestAccepted",
      bodyKey: "friendRequestAcceptedBody",
      param: accepterName,
      title: "Friend request accepted",
      body: `${accepterName} accepted your friend request.`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { status: "accepted" };
  });
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
    const myFriends = meSnap.data()?.friends || [];
    if (!myFriends.some((f: any) => f && f.uid === friendUid)) {
      throw new HttpsError("failed-precondition", "You aren't friends with this user.");
    }
    tx.set(meRef, { friends: myFriends.filter((f: any) => f && f.uid !== friendUid) }, { merge: true });
    if (themSnap.exists) {
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
      const groupRef = db.doc(`groups/${inv.groupId}`);
      const groupSnap = await tx.get(groupRef);
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

      tx.update(groupRef, { members: admin.firestore.FieldValue.arrayUnion(uid) });
    }
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
    if (e.sharedWithFamily) sharedFam++;
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
    if (a.sharedWithFamily) assetsShared++;
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

// Health / observability: recent errors + AI & notification usage.
export const adminGetHealth = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  await assertAdmin(request);
  const db = admin.firestore();
  const today = new Date().toISOString().slice(0, 10);
  const [errSnap, errCount, aiSnap, notifSnap] = await Promise.all([
    db.collection("errorLogs").orderBy("createdAt", "desc").limit(50).get(),
    db.collection("errorLogs").count().get().then((s) => s.data().count).catch(() => 0),
    db.collection("ai_usage").limit(3000).get(),
    db.collection("notif_usage").limit(3000).get(),
  ]);
  const errors = errSnap.docs.map((d) => {
    const e = d.data();
    return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.()?.toISOString?.() || null };
  });
  let aiToday = 0; const aiTop: { uid: string; count: number }[] = [];
  aiSnap.forEach((d) => { const u = d.data(); if (u.date === today && u.count) { aiToday += u.count; aiTop.push({ uid: d.id, count: u.count }); } });
  aiTop.sort((a, b) => b.count - a.count);
  let notifToday = 0;
  notifSnap.forEach((d) => { const u = d.data(); if (u.date === today) notifToday += u.count || 0; });
  return {
    errors, errorTotal: errCount,
    truncated: aiSnap.size >= 3000 || notifSnap.size >= 3000,
    ai: { today: aiToday, dailyLimitPerUser: AI_DAILY_LIMIT, activeUsers: aiTop.length, top: aiTop.slice(0, 10) },
    notifications: { today: notifToday, dailyLimitPerUser: NOTIF_DAILY_LIMIT },
  };
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
  let targetEmail = "";
  try { targetEmail = ((await admin.auth().getUser(uid)).email || "").toLowerCase(); } catch { /* gone */ }
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
      counts: { groups: groupsSnap.size, events, assets, games, friendRequests: frFrom + frTo, friendsUnlinked: myFriends.length },
      note: "Group chat messages authored by the user are retained as group history.",
    };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});

// ── Broadcast a notification to all users or one group (admin-only) ──
export const adminBroadcast = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const callerUid = await assertAdmin(request);
  const { target, title, body } = request.data || {};
  if (!title || !target) throw new HttpsError("invalid-argument", "target and title are required.");
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

  const now = admin.firestore.FieldValue.serverTimestamp();
  let created = 0;
  for (const group of chunk(recipients, 400)) {
    const batch = db.batch();
    group.forEach((uid) => {
      const ref = db.collection("notifications").doc();
      batch.set(ref, {
        userId: uid, createdBy: callerUid, type: "broadcast",
        title: String(title).slice(0, 200), body: typeof body === "string" ? body.slice(0, 500) : "",
        read: false, createdAt: now,
      });
      created++;
    });
    await batch.commit();
  }
  return { ok: true, created };
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
  const challengerName =
    (await db.doc(`profiles/${uid}`).get()).data()?.name || "A challenger";
  batch.set(db.collection("notifications").doc(), {
    userId: opponentUid,
    createdBy: uid,
    type: "warlord_challenge",
    title: "⚔️ Warlord challenge",
    body: `${challengerName} has challenged you to battle.`,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  // Push (best-effort, never fails the challenge).
  try {
    const oppDoc = await db.doc(`users/${opponentUid}`).get();
    const tokens: string[] = [...new Set<string>(oppDoc.data()?.fcmTokens || [])];
    if (tokens.length > 0) {
      await admin.messaging().sendEachForMulticast({
        notification: { title: "⚔️ Warlord challenge", body: `${challengerName} has challenged you to battle.` },
        tokens,
      });
    }
  } catch (e) {
    console.error("Warlord challenge push failed:", e);
  }
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
      throw new HttpsError("failed-precondition", "The timeout clock has just started for this battle.");
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
  let targets: { uid: string; title: string; body: string }[] = [];

  if (before.status === "waiting" && after.status === "playing") {
    targets = [{
      uid: players[0], // initial side = PLAYER = seat 0 (the challenger moves first)
      title: "⚔️ Warlord: battle joined!",
      body: "Your challenge was accepted — it's your move.",
    }];
  } else if (before.status !== "finished" && after.status === "finished") {
    const w = after.winner;
    const suffix = after.forfeitedBy ? " (by retreat)" : "";
    targets = players.map((uid) => ({
      uid,
      title: "⚔️ Warlord: battle over",
      body: w == null ? "The battle ended in a draw." : uid === w ? `Victory!${suffix}` : `Defeat.${suffix}`,
    }));
  } else if (after.status === "playing" && before.state?.side !== after.state?.side) {
    const seatUid = players[after.state.side === "PLAYER" ? 0 : 1];
    targets = [{ uid: seatUid, title: "⚔️ Warlord: your turn", body: "The enemy has ended their turn." }];
  }
  if (targets.length === 0) return;

  try {
    for (const t of targets) {
      const userDoc = await admin.firestore().doc(`users/${t.uid}`).get();
      const tokens: string[] = userDoc.data()?.fcmTokens || [];
      const unique = [...new Set(tokens)];
      if (unique.length === 0) continue;
      const res = await admin.messaging().sendEachForMulticast({
        notification: { title: t.title, body: t.body },
        tokens: unique,
      });
      console.log(`Warlord push to ${t.uid}: sent ${res.successCount}, failed ${res.failureCount}`);
    }
  } catch (error) {
    console.error("Error sending Warlord FCM:", error);
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
  const days: string[] = [];
  for (let i = 0; i < 30; i++) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }

  const snaps = await Promise.all(days.map((d) => db.doc(`aiSpendDaily/${d}`).get()));
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
  const today = days[0];
  const [featureSnap, userSnap] = await Promise.all([
    db.collection(`aiSpendDaily/${today}/features`).get(),
    db.collection(`aiSpendDaily/${today}/users`).orderBy("microUsd", "desc").limit(10).get(),
  ]);

  return {
    daily,
    totals: { today: sum(1), week: sum(7), month: sum(30) },
    byFeature: featureSnap.docs.map((d) => ({
      feature: d.id,
      calls: d.data().calls || 0,
      failures: d.data().failures || 0,
      usd: (d.data().microUsd || 0) / 1_000_000,
    })).sort((a, b) => b.usd - a.usd),
    topUsers: userSnap.docs.map((d) => ({
      uid: d.id,
      calls: d.data().calls || 0,
      usd: (d.data().microUsd || 0) / 1_000_000,
    })),
  };
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

  const snap = await q.limit(200).get();
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
