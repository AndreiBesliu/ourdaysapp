"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeFriend = exports.respondToFriendRequest = exports.transferAssetCopy = exports.createEventOverride = exports.notifyUsers = exports.suggestAssetForText = exports.generateGroupDigest = exports.suggestEventCategory = exports.generateAIChecklist = exports.onGameCreated = exports.onMessageCreated = exports.autoSuggestChecklist = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
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
// Per-user, per-day quota counter (admin-only `*_usage` collections — clients
// have no matching rule → denied). Returns true if within today's limit (and
// records the use), false if over. Shared by the AI callables, the AI trigger,
// and notification fan-out.
async function tryConsumeQuota(uid, collection, limit) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const ref = admin.firestore().doc(`${collection}/${uid}`);
    return admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : undefined;
        const count = data && data.date === today ? (data.count || 0) : 0;
        if (count >= limit)
            return false;
        tx.set(ref, { date: today, count: count + 1 }, { merge: true });
        return true;
    });
}
// AI callables: require auth + enforce the shared daily AI quota.
async function assertAiCallerAllowed(request) {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to use AI features.");
    }
    if (!(await tryConsumeQuota(uid, "ai_usage", AI_DAILY_LIMIT))) {
        throw new https_1.HttpsError("resource-exhausted", "Daily AI limit reached. Please try again tomorrow.");
    }
    return uid;
}
// Whether `uid` is a member of the given group.
async function userInGroup(uid, groupId) {
    var _a;
    if (!groupId)
        return false;
    const snap = await admin.firestore().doc(`groups/${groupId}`).get();
    const members = snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.members : undefined;
    return Array.isArray(members) && members.includes(uid);
}
// Whether `a` and `b` share at least one group.
async function usersShareGroup(a, b) {
    if (a === b)
        return false;
    const snap = await admin.firestore().collection("groups").where("members", "array-contains", a).get();
    return snap.docs.some((d) => (d.data().members || []).includes(b));
}
exports.autoSuggestChecklist = (0, firestore_1.onDocumentCreated)({
    document: "events/{eventId}"
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
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
        const genAI = new generative_ai_1.GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const prompt = `You are a helpful AI Assistant for a family organization app. 
The user created a task/event titled "${title}".
${description ? `The description is: "${description}".` : ""}

IMPORTANT: Analyze the language used in the title and description above. You MUST write the entire checklist translated into that exact same language.

If this looks like a Grocery or Shopping list, generate a checklist grouped by supermarket aisles (e.g., "Dairy: Milk", "Produce: Apples").
Otherwise, generate a checklist of 3 to 7 actionable, brief steps or items needed to complete this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Dairy: Milk", "Produce: Apples", "Bakery: Bread"] or ["Step 1", "Step 2"]`;
        const result = await model.generateContent(prompt);
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
            const newAssignees = data.assigneeIds.filter((id) => id !== "ai_assistant");
            await snapshot.ref.update({
                checklistItems: combinedItems,
                assigneeIds: newAssignees
            });
            console.log(`Successfully generated checklist for: ${title}`);
        }
    }
    catch (error) {
        console.error("AI Generation Error", error);
    }
});
exports.onMessageCreated = (0, firestore_1.onDocumentCreated)("groups/{groupId}/messages/{messageId}", async (event) => {
    var _a, _b, _c;
    const snapshot = event.data;
    if (!snapshot)
        return;
    const msgData = snapshot.data();
    const senderId = msgData.senderId;
    const groupId = event.params.groupId;
    try {
        const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
        if (!groupDoc.exists)
            return;
        const groupData = groupDoc.data();
        if (!groupData)
            return;
        const groupName = groupData.name || "A group";
        const members = groupData.members || [];
        const targetUserIds = members.filter((id) => id !== senderId);
        if (targetUserIds.length === 0)
            return;
        const senderDoc = await admin.firestore().doc(`users/${senderId}`).get();
        const senderName = ((_a = senderDoc.data()) === null || _a === void 0 ? void 0 : _a.name) || ((_c = (_b = senderDoc.data()) === null || _b === void 0 ? void 0 : _b.email) === null || _c === void 0 ? void 0 : _c.split('@')[0]) || "Someone";
        const tokens = [];
        for (const uid of targetUserIds) {
            const userDoc = await admin.firestore().doc(`users/${uid}`).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if ((userData === null || userData === void 0 ? void 0 : userData.fcmTokens) && Array.isArray(userData.fcmTokens)) {
                    tokens.push(...userData.fcmTokens);
                }
            }
        }
        const uniqueTokens = [...new Set(tokens)];
        if (uniqueTokens.length === 0)
            return;
        const payload = {
            notification: {
                title: `${senderName} in ${groupName}`,
                body: msgData.text || (msgData.imageUrl ? "Sent an image" : "Sent a message"),
            },
            tokens: uniqueTokens
        };
        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(`Successfully sent ${response.successCount} messages; failed ${response.failureCount}`);
    }
    catch (error) {
        console.error("Error sending FCM payload:", error);
    }
});
exports.onGameCreated = (0, firestore_1.onDocumentCreated)("games/{gameId}", async (event) => {
    var _a, _b, _c;
    const snapshot = event.data;
    if (!snapshot)
        return;
    const gameData = snapshot.data();
    const creatorId = gameData.createdBy;
    const groupId = gameData.groupId;
    const gameType = gameData.gameType || "a game";
    if (!groupId || !creatorId)
        return;
    try {
        const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
        if (!groupDoc.exists)
            return;
        const groupData = groupDoc.data();
        if (!groupData)
            return;
        const groupName = groupData.name || "A group";
        const members = groupData.members || [];
        const targetUserIds = members.filter((id) => id !== creatorId);
        if (targetUserIds.length === 0)
            return;
        const creatorDoc = await admin.firestore().doc(`users/${creatorId}`).get();
        const creatorName = ((_a = creatorDoc.data()) === null || _a === void 0 ? void 0 : _a.name) || ((_c = (_b = creatorDoc.data()) === null || _b === void 0 ? void 0 : _b.email) === null || _c === void 0 ? void 0 : _c.split('@')[0]) || "Someone";
        const tokens = [];
        for (const uid of targetUserIds) {
            const userDoc = await admin.firestore().doc(`users/${uid}`).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if ((userData === null || userData === void 0 ? void 0 : userData.fcmTokens) && Array.isArray(userData.fcmTokens)) {
                    tokens.push(...userData.fcmTokens);
                }
            }
        }
        const uniqueTokens = [...new Set(tokens)];
        if (uniqueTokens.length === 0)
            return;
        const readableGameType = gameType.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const payload = {
            notification: {
                title: `🎮 New Game in ${groupName}!`,
                body: `${creatorName} wants to play ${readableGameType}. Tap to join!`,
            },
            tokens: uniqueTokens
        };
        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(`Successfully sent ${response.successCount} game invites; failed ${response.failureCount}`);
    }
    catch (error) {
        console.error("Error sending Game Invite FCM:", error);
    }
});
exports.generateAIChecklist = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { title, description, language = 'en-US' } = request.data;
    if (!title) {
        throw new https_1.HttpsError('invalid-argument', 'Title is required.');
    }
    await assertAiCallerAllowed(request);
    try {
        const key = process.env.GEMINI_API_KEY_LOCAL;
        if (!key) {
            throw new https_1.HttpsError('failed-precondition', 'AI is not configured on the server.');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const prompt = `You are a helpful AI Assistant for a family organization app. 
The user is creating a task/event titled "${title}".
${description ? `The description is: "${description}".` : ""}

IMPORTANT: You MUST write the entire checklist translated into this exact language locale: "${language}".

If this looks like a Grocery or Shopping list, generate a checklist grouped by supermarket aisles (e.g., "Dairy: Milk", "Produce: Apples").
Otherwise, generate a checklist of 3 to 7 actionable, brief steps or items needed to complete this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Dairy: Milk", "Produce: Apples", "Bakery: Bread"] or ["Step 1", "Step 2"]`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const list = JSON.parse(cleanText);
        if (Array.isArray(list)) {
            return { suggestions: list.map(String) };
        }
        return { suggestions: [] };
    }
    catch (error) {
        console.error("AI Generation Error", error);
        throw new https_1.HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
    }
});
exports.suggestEventCategory = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { title, description } = request.data;
    if (!title) {
        throw new https_1.HttpsError('invalid-argument', 'Title is required.');
    }
    await assertAiCallerAllowed(request);
    try {
        const key = process.env.GEMINI_API_KEY_LOCAL;
        if (!key) {
            throw new https_1.HttpsError('failed-precondition', 'AI is not configured on the server.');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const prompt = `You are a helpful AI Assistant. Given an event title and optional description, categorize it into exactly one of the following category IDs: "work", "family_time", "chores", "health", "other".
Title: "${title}"
${description ? `Description: "${description}"` : ""}

Return ONLY the category ID string, nothing else. No markdown formatting.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim().toLowerCase();
        const validCategories = ["work", "family_time", "chores", "health", "other"];
        const matchedCategory = validCategories.find(c => text.includes(c)) || "other";
        return { categoryId: matchedCategory };
    }
    catch (error) {
        console.error("AI Category Suggestion Error", error);
        throw new https_1.HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
    }
});
exports.generateGroupDigest = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d;
    const { groupId, language = 'en-US' } = request.data;
    if (!groupId) {
        throw new https_1.HttpsError('invalid-argument', 'groupId is required.');
    }
    await assertAiCallerAllowed(request);
    try {
        const key = process.env.GEMINI_API_KEY_LOCAL;
        if (!key) {
            throw new https_1.HttpsError('failed-precondition', 'AI is not configured on the server.');
        }
        const db = admin.firestore();
        const groupDoc = await db.collection('groups').doc(groupId).get();
        const groupName = groupDoc.exists ? (((_a = groupDoc.data()) === null || _a === void 0 ? void 0 : _a.name) || "The Group") : "The Group";
        // Get messages from last 48 hours
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 2);
        const messagesSnapshot = await db.collection(`groups/${groupId}/messages`)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(pastDate))
            .orderBy('createdAt', 'asc')
            .limit(50)
            .get();
        let chatHistory = "Recent Chat Messages:\n";
        if (messagesSnapshot.empty) {
            chatHistory += "(No recent messages)\n";
        }
        else {
            for (const docSnap of messagesSnapshot.docs) {
                const d = docSnap.data();
                let senderName = "Someone";
                if (d.senderId) {
                    const userDoc = await db.collection('users').doc(d.senderId).get();
                    senderName = ((_b = userDoc.data()) === null || _b === void 0 ? void 0 : _b.name) || ((_d = (_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.email) === null || _d === void 0 ? void 0 : _d.split('@')[0]) || "Someone";
                }
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
        }
        else {
            eventsSnapshot.docs.forEach(docSnap => {
                const d = docSnap.data();
                upcomingEvents += `- ${d.title} on ${d.date.split('T')[0]}\n`;
            });
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const prompt = `You are a helpful AI Assistant for a family/group organization app.
Summarize the recent activity and upcoming events for the group "${groupName}".
Translate your summary to this exact locale language: "${language}".

${chatHistory}

${upcomingEvents}

Provide a brief, friendly, conversational digest (1-2 paragraphs max) that highlights what happened recently and what is coming up. Keep it concise. No markdown headers.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        return { digest: text };
    }
    catch (error) {
        console.error("AI Group Digest Error", error);
        throw new https_1.HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
    }
});
exports.suggestAssetForText = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { text, availableAssets } = request.data;
    if (!text || !availableAssets || !Array.isArray(availableAssets)) {
        throw new https_1.HttpsError('invalid-argument', 'text and availableAssets are required.');
    }
    await assertAiCallerAllowed(request);
    try {
        const key = process.env.GEMINI_API_KEY_LOCAL;
        if (!key) {
            throw new https_1.HttpsError('failed-precondition', 'AI is not configured on the server.');
        }
        const genAI = new generative_ai_1.GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const prompt = `You are an AI that maps text to the most relevant asset card.
Text: "${text}"

Available Assets:
${availableAssets.map((a) => `- ID: ${a.id}, Name: ${a.name}`).join('\n')}

Rules:
1. If the text clearly implies groceries, supermarkets, or food shopping, match a supermarket/loyalty card if one exists (e.g. Kaufland, Mega Image, Lidl, Carrefour, Profi, Auchan, Penny).
2. If the text implies health, doctor, or medical, match a health card (e.g. SanoPass, Medicover, Regina Maria).
3. If it implies gym or fitness, match a gym card (e.g. 7Card, WorldClass).
4. Return ONLY the exact string ID of the best matching asset.
5. If no asset matches reasonably well, return the exact string "none".
Do not include any other text or markdown formatting.`;
        const result = await model.generateContent(prompt);
        const resultText = result.response.text().trim();
        // Validate that the returned ID is actually in the list, unless it's "none"
        const matchedAsset = availableAssets.find((a) => a.id === resultText);
        return { assetId: matchedAsset ? matchedAsset.id : null };
    }
    catch (error) {
        console.error("AI Asset Suggestion Error", error);
        throw new https_1.HttpsError('internal', `AI Error: ${error.message || 'Unknown error'}`);
    }
});
// ── Notifications fan-out (anti-spam) ──
// Clients can no longer write to `notifications` directly (Firestore rule denies
// create). They call this instead: it requires auth, only lets you notify users
// you SHARE A GROUP with, rate-limits per sender, and writes via the Admin SDK
// with a server-set `createdBy`/`createdAt`.
exports.notifyUsers = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { recipientIds, type, title, body } = request.data || {};
    if (!Array.isArray(recipientIds) || recipientIds.length === 0 || !title) {
        throw new https_1.HttpsError("invalid-argument", "recipientIds and title are required.");
    }
    // De-dupe, drop self, cap fan-out per call.
    const recipients = [...new Set(recipientIds)]
        .filter((r) => typeof r === "string" && r !== uid)
        .slice(0, 20);
    if (recipients.length === 0) {
        return { created: 0 };
    }
    if (!(await tryConsumeQuota(uid, "notif_usage", NOTIF_DAILY_LIMIT))) {
        throw new https_1.HttpsError("resource-exhausted", "Notification limit reached. Please try again later.");
    }
    const db = admin.firestore();
    // Build the set of users the sender shares a group with.
    const groupsSnap = await db.collection("groups").where("members", "array-contains", uid).get();
    const sharedMembers = new Set();
    groupsSnap.docs.forEach((d) => {
        (d.data().members || []).forEach((m) => sharedMembers.add(m));
    });
    const batch = db.batch();
    let created = 0;
    for (const rid of recipients) {
        if (!sharedMembers.has(rid))
            continue; // only notify users you share a group with
        const ref = db.collection("notifications").doc();
        batch.set(ref, {
            userId: rid,
            createdBy: uid,
            type: typeof type === "string" ? type : "info",
            title: String(title).slice(0, 200),
            body: typeof body === "string" ? body.slice(0, 500) : "",
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
exports.createEventOverride = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { parentId, overrideDate, data } = request.data || {};
    if (!parentId || !overrideDate || !data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "parentId, overrideDate and data are required.");
    }
    const db = admin.firestore();
    const parentRef = db.doc(`events/${parentId}`);
    const parentSnap = await parentRef.get();
    if (!parentSnap.exists) {
        throw new https_1.HttpsError("not-found", "Parent event not found.");
    }
    const p = parentSnap.data() || {};
    const canEdit = p.ownerId === uid ||
        (!!p.groupId && (await userInGroup(uid, p.groupId))) ||
        (Array.isArray(p.assigneeIds) && p.assigneeIds.includes(uid));
    if (!canEdit) {
        throw new https_1.HttpsError("permission-denied", "You can't edit this event.");
    }
    const overrideRef = db.collection("events").doc();
    const batch = db.batch();
    batch.set(overrideRef, Object.assign(Object.assign({}, data), { ownerId: p.ownerId, groupId: (_b = p.groupId) !== null && _b !== void 0 ? _b : null, overrideOfParent: parentId, createdAt: new Date().toISOString() }));
    batch.update(parentRef, {
        recurrenceExceptions: admin.firestore.FieldValue.arrayUnion(overrideDate),
    });
    await batch.commit();
    return { id: overrideRef.id };
});
// ── Asset transfer "keep copy" ──
// Creating an asset owned by ANOTHER user can't be a client write (create
// requires ownerId == auth.uid). The caller must own the source asset and share
// a group with the recipient; the copy is duplicated server-side from the
// (already-updated) original so its data is authoritative.
exports.transferAssetCopy = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { assetId, recipientId } = request.data || {};
    if (!assetId || !recipientId) {
        throw new https_1.HttpsError("invalid-argument", "assetId and recipientId are required.");
    }
    if (recipientId === uid) {
        throw new https_1.HttpsError("invalid-argument", "Cannot transfer to yourself.");
    }
    const db = admin.firestore();
    const assetSnap = await db.doc(`assets/${assetId}`).get();
    if (!assetSnap.exists) {
        throw new https_1.HttpsError("not-found", "Asset not found.");
    }
    const a = assetSnap.data() || {};
    if (a.ownerId !== uid) {
        throw new https_1.HttpsError("permission-denied", "You don't own this asset.");
    }
    if (!(await usersShareGroup(uid, recipientId))) {
        throw new https_1.HttpsError("permission-denied", "You can only transfer to members of your groups.");
    }
    // Drop the source owner/timestamp; copy everything else to the recipient.
    const { ownerId, createdAt } = a, rest = __rest(a, ["ownerId", "createdAt"]);
    void ownerId;
    void createdAt;
    const copyRef = db.collection("assets").doc();
    await copyRef.set(Object.assign(Object.assign({}, rest), { ownerId: recipientId, createdAt: new Date().toISOString(), transferredFrom: uid }));
    return { id: copyRef.id };
});
// ── Friends: respond to a friend request ──
// Accepting must add each user to the OTHER's `friends` list, but the `users`
// collection is owner-only write — clients can't touch each other's docs. So
// responding goes through this callable (Admin SDK). The caller must be the
// request's recipient (matched by uid or email). On accept, both users get a
// `{uid,name,email}` entry for the other (email lives on the owner-only user
// doc, not the public profile, so we resolve it here) and the sender is notified.
exports.respondToFriendRequest = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    const email = (((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) || "").toLowerCase();
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { requestId, accept } = request.data || {};
    if (!requestId || typeof accept !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "requestId and accept are required.");
    }
    const cap = (s) => String(s || "").slice(0, 80);
    const db = admin.firestore();
    const reqRef = db.doc(`friend_requests/${requestId}`);
    // One transaction: re-check status, read both users, and write atomically.
    // NOTE: recipient is matched by token email when toId is absent. This trusts
    // the token email (same model as group_invites). Email-squatting via
    // unverified accounts is a known app-wide risk tracked on the roadmap
    // (email verification) — not introduced here.
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const snap = await tx.get(reqRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Friend request not found.");
        }
        const fr = snap.data() || {};
        const isRecipient = fr.toId === uid || (!!fr.toEmail && fr.toEmail === email);
        if (!isRecipient) {
            throw new https_1.HttpsError("permission-denied", "This request isn't addressed to you.");
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
            throw new https_1.HttpsError("failed-precondition", "Invalid friend request.");
        }
        const senderRef = db.doc(`users/${senderUid}`);
        const accepterRef = db.doc(`users/${uid}`);
        const [senderUser, accepterUser, senderProfile, accepterProfile] = await Promise.all([
            tx.get(senderRef), tx.get(accepterRef),
            tx.get(db.doc(`profiles/${senderUid}`)), tx.get(db.doc(`profiles/${uid}`)),
        ]);
        const senderName = cap(((_a = senderProfile.data()) === null || _a === void 0 ? void 0 : _a.name) || ((_b = senderUser.data()) === null || _b === void 0 ? void 0 : _b.name) ||
            fr.fromName || (fr.fromEmail || "").split("@")[0] || "Friend");
        const senderEmail = (((_c = senderUser.data()) === null || _c === void 0 ? void 0 : _c.email) || fr.fromEmail || "").toLowerCase() || null;
        const accepterName = cap(((_d = accepterProfile.data()) === null || _d === void 0 ? void 0 : _d.name) || ((_e = accepterUser.data()) === null || _e === void 0 ? void 0 : _e.name) ||
            (email || "").split("@")[0] || "Friend");
        const accepterEmail = (((_f = accepterUser.data()) === null || _f === void 0 ? void 0 : _f.email) || email || "").toLowerCase() || null;
        // Read-filter-write so each side has exactly ONE entry per friend uid (and a
        // re-accept refreshes name/email instead of accumulating stale duplicates).
        const senderFriends = (((_g = senderUser.data()) === null || _g === void 0 ? void 0 : _g.friends) || []).filter((f) => f && f.uid !== uid);
        senderFriends.push({ uid, name: accepterName, email: accepterEmail });
        const accepterFriends = (((_h = accepterUser.data()) === null || _h === void 0 ? void 0 : _h.friends) || []).filter((f) => f && f.uid !== senderUid);
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
exports.removeFriend = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { friendUid } = request.data || {};
    if (!friendUid || friendUid === uid) {
        throw new https_1.HttpsError("invalid-argument", "A valid friendUid is required.");
    }
    const db = admin.firestore();
    const meRef = db.doc(`users/${uid}`);
    const themRef = db.doc(`users/${friendUid}`);
    return db.runTransaction(async (tx) => {
        var _a, _b;
        const [meSnap, themSnap] = await Promise.all([tx.get(meRef), tx.get(themRef)]);
        const myFriends = ((_a = meSnap.data()) === null || _a === void 0 ? void 0 : _a.friends) || [];
        if (!myFriends.some((f) => f && f.uid === friendUid)) {
            throw new https_1.HttpsError("failed-precondition", "You aren't friends with this user.");
        }
        tx.set(meRef, { friends: myFriends.filter((f) => f && f.uid !== friendUid) }, { merge: true });
        if (themSnap.exists) {
            const theirFriends = (((_b = themSnap.data()) === null || _b === void 0 ? void 0 : _b.friends) || []).filter((f) => f && f.uid !== uid);
            tx.set(themRef, { friends: theirFriends }, { merge: true });
        }
        return { ok: true };
    });
});
//# sourceMappingURL=index.js.map