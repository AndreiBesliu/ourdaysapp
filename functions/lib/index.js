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
exports.onWarlordBattleUpdated = exports.forfeitWarlordBattle = exports.submitWarlordCommand = exports.createWarlordChallenge = exports.acceptWarlordChallenge = exports.adminGetGrowth = exports.adminListGroups = exports.adminBroadcast = exports.adminModerateUser = exports.adminGetUser = exports.adminGetHealth = exports.logClientError = exports.adminSetAdmin = exports.adminListAdmins = exports.adminListProfiles = exports.adminGetStats = exports.adminCheck = exports.acceptGroupInvite = exports.removeFriend = exports.respondToFriendRequest = exports.transferAssetCopy = exports.createEventOverride = exports.notifyUsers = exports.suggestAssetForText = exports.generateGroupDigest = exports.suggestEventCategory = exports.generateAIChecklist = exports.onGameCreated = exports.onMessageCreated = exports.autoSuggestChecklist = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const generative_ai_1 = require("@google/generative-ai");
const engine_1 = require("./warlordCombat/combat/engine");
const pvp_1 = require("./warlordCombat/combat/pvp");
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
const WARLORD_CHALLENGE_DAILY_LIMIT = Number(process.env.WARLORD_CHALLENGE_DAILY_LIMIT || 30);
// Admin backend access. Source of truth = the `admins/{uid}` collection (locked
// to clients; only the Admin SDK writes it). A VERIFIED email in this bootstrap
// list is auto-granted admin on first admin call (so the owner works out of the
// box, no script) — verification required to block email-squatting.
const BOOTSTRAP_ADMIN_EMAILS = ["besliandrei@gmail.com"];
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
// Admin gate for the admin-backend callables. Admin if `admins/{uid}` exists, or
// the caller's VERIFIED email is in BOOTSTRAP_ADMIN_EMAILS (auto-provisioned into
// `admins/{uid}` on first use so they appear in the admins list). Returns the uid.
async function assertAdmin(request) {
    var _a, _b, _c, _d, _e, _f, _g;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const db = admin.firestore();
    const adminRef = db.doc(`admins/${uid}`);
    const snap = await adminRef.get();
    if (snap.exists)
        return uid;
    const email = (((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) || "").toLowerCase();
    const emailVerified = ((_e = (_d = request.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email_verified) === true;
    if (emailVerified && BOOTSTRAP_ADMIN_EMAILS.includes(email)) {
        // Auto-provision the bootstrap owner so they show up in the admins list.
        await adminRef.set({
            email,
            name: ((_g = (_f = request.auth) === null || _f === void 0 ? void 0 : _f.token) === null || _g === void 0 ? void 0 : _g.name) || email.split("@")[0],
            addedBy: "bootstrap",
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return uid;
    }
    throw new https_1.HttpsError("permission-denied", "Admin access required.");
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
        void logServerError((error === null || error === void 0 ? void 0 : error.message) || "AI generation error", "ai:generateChecklist", { stack: error === null || error === void 0 ? void 0 : error.stack });
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
        void logServerError((error === null || error === void 0 ? void 0 : error.message) || "AI generation error", "ai:generateChecklist", { stack: error === null || error === void 0 ? void 0 : error.stack });
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
        void logServerError((error === null || error === void 0 ? void 0 : error.message) || "AI category error", "ai:suggestCategory", { stack: error === null || error === void 0 ? void 0 : error.stack });
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
        void logServerError((error === null || error === void 0 ? void 0 : error.message) || "AI digest error", "ai:groupDigest", { stack: error === null || error === void 0 ? void 0 : error.stack });
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
        void logServerError((error === null || error === void 0 ? void 0 : error.message) || "AI asset error", "ai:suggestAsset", { stack: error === null || error === void 0 ? void 0 : error.stack });
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
    var _a, _b, _c, _d, _e;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    const email = (((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) || "").toLowerCase();
    const emailVerified = ((_e = (_d = request.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email_verified) === true;
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
    // A request addressed by email can only be accepted by a caller whose email is
    // VERIFIED (prevents claiming a request sent to an address you don't own).
    // Requests addressed by uid (toId) are always safe (uid can't be spoofed).
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const snap = await tx.get(reqRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Friend request not found.");
        }
        const fr = snap.data() || {};
        const isRecipient = fr.toId === uid || (emailVerified && !!fr.toEmail && fr.toEmail === email);
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
// ── Accept a group invite ──
// Joining a group means adding yourself to its `members`, but the groups update
// rule requires you to ALREADY be a member — so a non-member's self-add is
// denied. Acceptance therefore goes through this callable (Admin SDK): it
// validates the caller is the invite's recipient (by uid or email) and that the
// invite is pending, then adds them to the group and marks the invite accepted.
exports.acceptGroupInvite = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d, _e;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    const email = (((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) || "").toLowerCase();
    const emailVerified = ((_e = (_d = request.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email_verified) === true;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const { inviteId } = request.data || {};
    if (!inviteId) {
        throw new https_1.HttpsError("invalid-argument", "inviteId is required.");
    }
    const db = admin.firestore();
    const inviteRef = db.doc(`group_invites/${inviteId}`);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(inviteRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Invite not found.");
        }
        const inv = snap.data() || {};
        // Email-addressed invites require a VERIFIED email to accept (no claiming an
        // invite to an address you don't own); uid-addressed invites are always safe.
        const isRecipient = inv.toId === uid || (emailVerified && !!inv.toEmail && inv.toEmail.toLowerCase() === email);
        if (!isRecipient) {
            throw new https_1.HttpsError("permission-denied", "This invite isn't addressed to you.");
        }
        if (inv.status && inv.status !== "pending") {
            return { status: inv.status, groupId: inv.groupId || null };
        }
        if (inv.groupId) {
            const groupRef = db.doc(`groups/${inv.groupId}`);
            const groupSnap = await tx.get(groupRef);
            if (!groupSnap.exists) {
                throw new https_1.HttpsError("not-found", "That group no longer exists.");
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
async function listAllAuthUsers(max = 5000) {
    const out = [];
    let token = undefined;
    let truncated = false;
    do {
        const pageSize = Math.min(1000, max - out.length);
        const res = await admin.auth().listUsers(pageSize, token);
        out.push(...res.users);
        token = res.pageToken;
        if (token && out.length >= max) {
            truncated = true;
            break;
        }
    } while (token);
    return { users: out.slice(0, max), truncated };
}
const inc = (obj, key, by = 1) => {
    if (!key)
        return;
    obj[key] = (obj[key] || 0) + by;
};
const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
};
// Delete every doc matching a query, in batches, until exhausted (or a cap).
async function deleteQueryInBatches(query, max = 3000) {
    let deleted = 0;
    while (deleted < max) {
        const snap = await query.limit(400).get();
        if (snap.empty)
            break;
        const batch = admin.firestore().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400)
            break;
    }
    return deleted;
}
// Delete all Storage objects under the given prefixes (best-effort).
async function deleteStoragePrefixes(prefixes) {
    try {
        const bucket = admin.storage().bucket();
        await Promise.all(prefixes.map((p) => bucket.deleteFiles({ prefix: p }).catch(() => { })));
        return true;
    }
    catch (_a) {
        return false;
    }
}
// Record a server-side error so it surfaces in the admin Health panel.
async function logServerError(message, where, extra) {
    try {
        await admin.firestore().collection("errorLogs").add({
            message: String(message || "server error").slice(0, 1000),
            stack: (extra === null || extra === void 0 ? void 0 : extra.stack) ? String(extra.stack).slice(0, 4000) : null,
            context: where.slice(0, 200),
            uid: (extra === null || extra === void 0 ? void 0 : extra.uid) || null,
            source: "server",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch ( /* never let logging break the caller */_a) { /* never let logging break the caller */ }
}
// Is the current caller an admin? (Non-throwing for non-admins.)
exports.adminCheck = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    try {
        await assertAdmin(request);
        return { isAdmin: true };
    }
    catch (_b) {
        return { isAdmin: false };
    }
});
// Detailed platform statistics across every collection + Firebase Auth.
exports.adminGetStats = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    await assertAdmin(request);
    const db = admin.firestore();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Accurate totals come from count() aggregation (never truncated); the capped
    // doc reads below feed the breakdowns and flag `truncated` if they hit a cap.
    const ct = (c) => db.collection(c).count().get().then((s) => s.data().count).catch(() => 0);
    const [authResult, usersSnap, groupsSnap, eventsSnap, gamesSnap, assetsSnap, friendReqSnap, invitesSnap, notifsSnap, adminsSnap, messagesCount, groupsTotal, eventsTotal, gamesTotal, assetsTotal, notifTotal] = await Promise.all([
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
    const byProvider = {};
    let verified = 0;
    let signups7d = 0;
    let signups30d = 0;
    authUsers.forEach((u) => {
        var _a, _b, _c;
        if (u.emailVerified)
            verified++;
        const created = ((_a = u.metadata) === null || _a === void 0 ? void 0 : _a.creationTime) ? new Date(u.metadata.creationTime).getTime() : 0;
        if (created && now - created < 7 * day)
            signups7d++;
        if (created && now - created < 30 * day)
            signups30d++;
        inc(byProvider, ((_c = (_b = u.providerData) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.providerId) || "password");
    });
    let withBirthday = 0;
    let withPhoto = 0;
    let pushEnabled = 0;
    let withFriends = 0;
    let totalFriendEntries = 0;
    usersSnap.forEach((d) => {
        const u = d.data();
        if (u.birthday)
            withBirthday++;
        if (u.photoURL)
            withPhoto++;
        if (Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0)
            pushEnabled++;
        if (Array.isArray(u.friends) && u.friends.length > 0) {
            withFriends++;
            totalFriendEntries += u.friends.length;
        }
    });
    // ── Groups ──
    let memberships = 0;
    let largest = 0;
    let shared = 0;
    groupsSnap.forEach((d) => {
        const m = (d.data().members || []).length;
        memberships += m;
        if (m > largest)
            largest = m;
        if (m > 1)
            shared++;
    });
    // ── Events ──
    const evByCategory = {};
    let tasks = 0;
    let completedTasks = 0;
    let recurring = 0;
    let withReminder = 0;
    let sharedFam = 0;
    let withRsvp = 0;
    eventsSnap.forEach((d) => {
        const e = d.data();
        if (e.isTask) {
            tasks++;
            if (e.taskStatus === "completed")
                completedTasks++;
        }
        if (e.recurrenceRule)
            recurring++;
        if (e.reminderMinutes !== null && e.reminderMinutes !== undefined)
            withReminder++;
        if (e.sharedWithFamily)
            sharedFam++;
        if (e.rsvpEnabled)
            withRsvp++;
        inc(evByCategory, e.categoryId || "other");
    });
    // ── Games ──
    const gByType = {};
    const gByStatus = {};
    let finalized = 0;
    gamesSnap.forEach((d) => {
        const g = d.data();
        inc(gByType, g.gameType || "unknown");
        inc(gByStatus, g.status || "unknown");
        if (g.finalized)
            finalized++;
    });
    // ── Assets ──
    const aByCategory = {};
    let assetsShared = 0;
    assetsSnap.forEach((d) => {
        const a = d.data();
        if (a.sharedWithFamily)
            assetsShared++;
        inc(aByCategory, a.category || "Uncategorized");
    });
    // ── Social ──
    const frByStatus = {};
    const invByStatus = {};
    friendReqSnap.forEach((d) => inc(frByStatus, d.data().status || "pending"));
    invitesSnap.forEach((d) => inc(invByStatus, d.data().status || "pending"));
    // ── Notifications ──
    const nByType = {};
    let unread = 0;
    notifsSnap.forEach((d) => {
        const n = d.data();
        if (!n.read)
            unread++;
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
exports.adminListProfiles = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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
    const userDocs = {};
    usersSnap.forEach((d) => { userDocs[d.id] = d.data(); });
    const profileDocs = {};
    profilesSnap.forEach((d) => { profileDocs[d.id] = d.data(); });
    const groupCount = {};
    groupsSnap.forEach((d) => (d.data().members || []).forEach((uid) => inc(groupCount, uid)));
    const eventCount = {};
    eventsSnap.forEach((d) => { const o = d.data().ownerId; if (o)
        inc(eventCount, o); });
    const adminUids = new Set(adminsSnap.docs.map((d) => d.id));
    const profiles = authUsers.map((u) => {
        var _a, _b, _c, _d;
        const fs = userDocs[u.uid] || {};
        const pr = profileDocs[u.uid] || {};
        return {
            uid: u.uid,
            email: u.email || fs.email || null,
            emailVerified: u.emailVerified,
            disabled: u.disabled,
            name: fs.name || pr.name || u.displayName || null,
            photoURL: fs.photoURL || pr.photoURL || u.photoURL || null,
            provider: ((_b = (_a = u.providerData) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.providerId) || "password",
            createdAt: ((_c = u.metadata) === null || _c === void 0 ? void 0 : _c.creationTime) || null,
            lastSignInAt: ((_d = u.metadata) === null || _d === void 0 ? void 0 : _d.lastSignInTime) || null,
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
exports.adminListAdmins = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    await assertAdmin(request);
    const db = admin.firestore();
    const snap = await db.collection("admins").get();
    const admins = await Promise.all(snap.docs.map(async (d) => {
        var _a, _b, _c, _d;
        const data = d.data();
        let email = data.email || null;
        let name = data.name || null;
        let emailVerified = null;
        try {
            const u = await admin.auth().getUser(d.id);
            email = email || u.email || null;
            name = name || u.displayName || null;
            emailVerified = u.emailVerified;
        }
        catch ( /* auth user may be gone */_e) { /* auth user may be gone */ }
        return {
            uid: d.id, email, name, emailVerified,
            addedBy: data.addedBy || null,
            addedAt: ((_d = (_c = (_b = (_a = data.addedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString) === null || _d === void 0 ? void 0 : _d.call(_c)) || null,
            bootstrap: BOOTSTRAP_ADMIN_EMAILS.includes((email || "").toLowerCase()),
        };
    }));
    return { admins };
});
// Grant or revoke admin (admin-only). Accepts a uid or an email. Last-admin
// protected; the bootstrap owner re-provisions on next call so can't be locked out.
exports.adminSetAdmin = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const callerUid = await assertAdmin(request);
    const { uid, email, makeAdmin } = request.data || {};
    if (typeof makeAdmin !== "boolean" || (!uid && !email)) {
        throw new https_1.HttpsError("invalid-argument", "makeAdmin and a uid or email are required.");
    }
    let targetUid = uid;
    let targetEmail = (email || "").toLowerCase();
    let targetName;
    try {
        const rec = targetUid
            ? await admin.auth().getUser(targetUid)
            : await admin.auth().getUserByEmail(targetEmail);
        targetUid = rec.uid;
        targetEmail = (rec.email || targetEmail).toLowerCase();
        targetName = rec.displayName || undefined;
    }
    catch (_a) {
        throw new https_1.HttpsError("not-found", "No user found for that uid/email.");
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
        if (!targetSnap.exists)
            return; // already not an admin → no-op
        if (all.size <= 1) {
            throw new https_1.HttpsError("failed-precondition", "Can't remove the last admin.");
        }
        tx.delete(ref);
    });
    return { ok: true, uid: targetUid, makeAdmin: false };
});
// ── Error monitoring ──
// Clients report captured errors here (rate-limited); the Admin SDK writes the
// `errorLogs` collection so clients can't write it directly.
exports.logClientError = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d, _e;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    const { message, stack, url, context } = request.data || {};
    if (!message)
        return { ok: false };
    // Require auth so every report is rate-limited (no unauthenticated spam path).
    if (!uid)
        return { ok: false };
    if (!(await tryConsumeQuota(uid, "error_usage", 200)))
        return { ok: false, throttled: true };
    const ua = (_c = (_b = request.rawRequest) === null || _b === void 0 ? void 0 : _b.headers) === null || _c === void 0 ? void 0 : _c["user-agent"];
    await admin.firestore().collection("errorLogs").add({
        message: String(message).slice(0, 1000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        url: url ? String(url).slice(0, 500) : null,
        context: context ? String(context).slice(0, 200) : null,
        uid,
        email: ((_e = (_d = request.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email) || null,
        userAgent: ua ? String(ua).slice(0, 300) : null,
        source: "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});
// Health / observability: recent errors + AI & notification usage.
exports.adminGetHealth = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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
        var _a, _b, _c, _d;
        const e = d.data();
        return Object.assign(Object.assign({ id: d.id }, e), { createdAt: ((_d = (_c = (_b = (_a = e.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString) === null || _d === void 0 ? void 0 : _d.call(_c)) || null });
    });
    let aiToday = 0;
    const aiTop = [];
    aiSnap.forEach((d) => { const u = d.data(); if (u.date === today && u.count) {
        aiToday += u.count;
        aiTop.push({ uid: d.id, count: u.count });
    } });
    aiTop.sort((a, b) => b.count - a.count);
    let notifToday = 0;
    notifSnap.forEach((d) => { const u = d.data(); if (u.date === today)
        notifToday += u.count || 0; });
    return {
        errors, errorTotal: errCount,
        truncated: aiSnap.size >= 3000 || notifSnap.size >= 3000,
        ai: { today: aiToday, dailyLimitPerUser: AI_DAILY_LIMIT, activeUsers: aiTop.length, top: aiTop.slice(0, 10) },
        notifications: { today: notifToday, dailyLimitPerUser: NOTIF_DAILY_LIMIT },
    };
});
// Full detail for one user (drill-down).
exports.adminGetUser = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d, _e;
    await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid || typeof uid !== "string" || uid.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "A valid uid is required.");
    const db = admin.firestore();
    let authRec = null;
    try {
        const u = await admin.auth().getUser(uid);
        authRec = {
            email: u.email || null, emailVerified: u.emailVerified, disabled: u.disabled,
            displayName: u.displayName || null, photoURL: u.photoURL || null,
            provider: ((_b = (_a = u.providerData) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.providerId) || "password",
            createdAt: ((_c = u.metadata) === null || _c === void 0 ? void 0 : _c.creationTime) || null, lastSignInAt: ((_d = u.metadata) === null || _d === void 0 ? void 0 : _d.lastSignInTime) || null,
        };
    }
    catch ( /* auth user may be gone */_f) { /* auth user may be gone */ }
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
        isProtected: adminSnap.exists || BOOTSTRAP_ADMIN_EMAILS.includes(((authRec === null || authRec === void 0 ? void 0 : authRec.email) || "").toLowerCase()),
        name: ud.name || ((_e = profileDoc.data()) === null || _e === void 0 ? void 0 : _e.name) || (authRec === null || authRec === void 0 ? void 0 : authRec.displayName) || null,
        birthday: ud.birthday || null,
        pushEnabled: Array.isArray(ud.fcmTokens) && ud.fcmTokens.length > 0,
        friends: Array.isArray(ud.friends) ? ud.friends.map((f) => ({ uid: f === null || f === void 0 ? void 0 : f.uid, name: f === null || f === void 0 ? void 0 : f.name, email: f === null || f === void 0 ? void 0 : f.email })) : [],
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
exports.adminModerateUser = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const callerUid = await assertAdmin(request);
    const { uid, action } = request.data || {};
    if (!uid || typeof uid !== "string" || uid.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "A valid uid is required.");
    if (!action)
        throw new https_1.HttpsError("invalid-argument", "action is required.");
    if (uid === callerUid)
        throw new https_1.HttpsError("failed-precondition", "You can't moderate your own account.");
    const db = admin.firestore();
    const adminSnap = await db.doc(`admins/${uid}`).get();
    let targetEmail = "";
    try {
        targetEmail = ((await admin.auth().getUser(uid)).email || "").toLowerCase();
    }
    catch ( /* gone */_b) { /* gone */ }
    const isTargetAdmin = adminSnap.exists || BOOTSTRAP_ADMIN_EMAILS.includes(targetEmail);
    // Protect admins/owner from disable, delete, AND forceVerify (force-verifying a
    // bootstrap-email account would let it auto-escalate to admin).
    if (isTargetAdmin && (action === "disable" || action === "delete" || action === "forceVerify")) {
        throw new https_1.HttpsError("failed-precondition", "You can't disable, delete, or force-verify another admin.");
    }
    if (action === "enable") {
        await admin.auth().updateUser(uid, { disabled: false });
        return { ok: true };
    }
    if (action === "disable") {
        await admin.auth().updateUser(uid, { disabled: true });
        return { ok: true };
    }
    if (action === "forceVerify") {
        await admin.auth().updateUser(uid, { emailVerified: true });
        return { ok: true };
    }
    if (action === "delete") {
        // Read the user's own friends first (peers) so we can unlink both sides.
        const meDoc = await db.doc(`users/${uid}`).get();
        const myFriends = Array.isArray((_a = meDoc.data()) === null || _a === void 0 ? void 0 : _a.friends) ? meDoc.data().friends : [];
        // Unlink the deleted uid from every peer's mutual friends array.
        await Promise.all(myFriends.map(async (f) => {
            var _a;
            if (!(f === null || f === void 0 ? void 0 : f.uid))
                return;
            try {
                const peerRef = db.doc(`users/${f.uid}`);
                const peer = await peerRef.get();
                if (!peer.exists)
                    return;
                const pf = (((_a = peer.data()) === null || _a === void 0 ? void 0 : _a.friends) || []).filter((x) => x && x.uid !== uid);
                await peerRef.set({ friends: pf }, { merge: true });
            }
            catch ( /* ignore a bad peer */_b) { /* ignore a bad peer */ }
        }));
        // Remove from every group's members.
        const groupsSnap = await db.collection("groups").where("members", "array-contains", uid).limit(400).get();
        await Promise.all(groupsSnap.docs.map((g) => g.ref.update({ members: admin.firestore.FieldValue.arrayRemove(uid) }).catch(() => { })));
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
            db.doc(`users/${uid}`).delete().catch(() => { }),
            db.doc(`profiles/${uid}`).delete().catch(() => { }),
            db.doc(`admins/${uid}`).delete().catch(() => { }),
            db.doc(`ai_usage/${uid}`).delete().catch(() => { }),
            db.doc(`notif_usage/${uid}`).delete().catch(() => { }),
            db.doc(`error_usage/${uid}`).delete().catch(() => { }),
            db.doc(`warlord_challenge_usage/${uid}`).delete().catch(() => { }),
            // Warlord: the world-roster entry and the cloud-synced kingdom. Both are
            // otherwise undeletable (clients cannot delete them) and the roster is
            // world-readable, so a deleted account would linger in the player directory.
            db.doc(`warlordPlayers/${uid}`).delete().catch(() => { }),
            db.doc(`warlordDomains/${uid}`).delete().catch(() => { }),
        ]);
        // Finally the Auth account.
        let authDeleted = false;
        try {
            await admin.auth().deleteUser(uid);
            authDeleted = true;
        }
        catch ( /* already gone */_c) { /* already gone */ }
        return {
            ok: true, deleted: true, authDeleted, storageDeleted,
            counts: { groups: groupsSnap.size, events, assets, games, friendRequests: frFrom + frTo, friendsUnlinked: myFriends.length },
            note: "Group chat messages authored by the user are retained as group history.",
        };
    }
    throw new https_1.HttpsError("invalid-argument", "Unknown action.");
});
// ── Broadcast a notification to all users or one group (admin-only) ──
exports.adminBroadcast = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const callerUid = await assertAdmin(request);
    const { target, title, body } = request.data || {};
    if (!title || !target)
        throw new https_1.HttpsError("invalid-argument", "target and title are required.");
    const db = admin.firestore();
    let recipients = [];
    if (target === "all") {
        const res = await listAllAuthUsers();
        recipients = res.users.map((u) => u.uid);
    }
    else {
        const g = await db.doc(`groups/${target}`).get();
        if (!g.exists)
            throw new https_1.HttpsError("not-found", "Group not found.");
        recipients = (((_a = g.data()) === null || _a === void 0 ? void 0 : _a.members) || []).filter((x) => typeof x === "string");
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
exports.adminListGroups = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    await assertAdmin(request);
    const db = admin.firestore();
    const [groupsSnap, eventsSnap, gamesSnap] = await Promise.all([
        db.collection("groups").limit(2000).get(),
        db.collection("events").limit(8000).get(),
        db.collection("games").limit(5000).get(),
    ]);
    const evByGroup = {};
    eventsSnap.forEach((d) => { const g = d.data().groupId; if (g)
        inc(evByGroup, g); });
    const gaByGroup = {};
    gamesSnap.forEach((d) => { const g = d.data().groupId; if (g)
        inc(gaByGroup, g); });
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
exports.adminGetGrowth = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    await assertAdmin(request);
    const db = admin.firestore();
    const days = 30;
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
    const mkBuckets = () => {
        const m = {};
        for (let i = days - 1; i >= 0; i--)
            m[dayKey(now - i * dayMs)] = 0;
        return m;
    };
    const cutoff = now - (days - 1) * dayMs - (now % dayMs); // start-of-day, days-1 ago (UTC-ish)
    const signups = mkBuckets();
    const events = mkBuckets();
    const games = mkBuckets();
    const tsOf = (c) => { var _a, _b, _c; return typeof c === "string" ? new Date(c).getTime() : (((_c = (_b = (_a = c === null || c === void 0 ? void 0 : c.toDate) === null || _a === void 0 ? void 0 : _a.call(c)) === null || _b === void 0 ? void 0 : _b.getTime) === null || _c === void 0 ? void 0 : _c.call(_b)) || 0); };
    const [authRes, eventsSnap, gamesSnap] = await Promise.all([
        listAllAuthUsers(),
        db.collection("events").limit(8000).get(),
        db.collection("games").limit(5000).get(),
    ]);
    authRes.users.forEach((u) => {
        var _a;
        const t = ((_a = u.metadata) === null || _a === void 0 ? void 0 : _a.creationTime) ? new Date(u.metadata.creationTime).getTime() : 0;
        if (t >= cutoff) {
            const k = dayKey(t);
            if (k in signups)
                signups[k]++;
        }
    });
    eventsSnap.forEach((d) => { const t = tsOf(d.data().createdAt); if (t >= cutoff) {
        const k = dayKey(t);
        if (k in events)
            events[k]++;
    } });
    gamesSnap.forEach((d) => { const t = tsOf(d.data().createdAt); if (t >= cutoff) {
        const k = dayKey(t);
        if (k in games)
            games[k]++;
    } });
    const toSeries = (m) => Object.entries(m).map(([date, count]) => ({ date, count }));
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
function parseWarlordCommand(raw) {
    var _a, _b;
    if (!raw || typeof raw !== "object")
        return null;
    if (raw.kind === "END_TURN")
        return { kind: "END_TURN" };
    if (raw.kind === "MOVE") {
        if (typeof raw.id !== "string" || !WARLORD_CID.test(raw.id))
            return null;
        const x = (_a = raw.to) === null || _a === void 0 ? void 0 : _a.x;
        const y = (_b = raw.to) === null || _b === void 0 ? void 0 : _b.y;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 63 || y > 63)
            return null;
        return { kind: "MOVE", id: raw.id, to: { x, y } };
    }
    if (raw.kind === "ATTACK") {
        if (typeof raw.id !== "string" || !WARLORD_CID.test(raw.id))
            return null;
        if (typeof raw.targetId !== "string" || !WARLORD_CID.test(raw.targetId))
            return null;
        return { kind: "ATTACK", id: raw.id, targetId: raw.targetId };
    }
    return null;
}
function requireGameId(data) {
    const gameId = data === null || data === void 0 ? void 0 : data.gameId;
    if (typeof gameId !== "string" || !gameId || gameId.includes("/")) {
        throw new https_1.HttpsError("invalid-argument", "A valid gameId is required.");
    }
    return gameId;
}
// Defender locks in their deployment; the server validates BOTH payloads, generates
// the seed (unknowable before both armies are committed), builds the authoritative
// initial BattleState and flips the doc to 'playing'.
exports.acceptWarlordChallenge = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const gameId = requireGameId(request.data);
    const { unitIds, combatants } = request.data || {};
    // Defender payload is pure input — validate before the transaction.
    const defender = (0, pvp_1.sanitizeDeploy)({ unitIds, combatants }, "ENEMY");
    if (!defender.ok)
        throw new https_1.HttpsError("invalid-argument", `Invalid deployment: ${defender.error}`);
    const db = admin.firestore();
    const ref = db.doc(`games/${gameId}`);
    const deployRef = db.doc(`warlordDeploys/${gameId}`); // challenger army, Admin-SDK-only
    return db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "Challenge not found.");
        const g = snap.data();
        if (g.gameType !== WARLORD_GAME_TYPE)
            throw new https_1.HttpsError("failed-precondition", "Not a Warlord battle.");
        if (g.status !== "waiting")
            throw new https_1.HttpsError("failed-precondition", "Challenge already accepted or resolved.");
        // Belt & suspenders vs a forged create that slipped past the rules fence.
        if (g.state != null || g.seed != null)
            throw new https_1.HttpsError("failed-precondition", "Malformed challenge.");
        const players = g.players;
        if (!Array.isArray(players) || players.length !== 2 ||
            typeof players[0] !== "string" || typeof players[1] !== "string" ||
            players[0] === players[1] || players[0] !== g.createdBy || players[1] !== g.opponentUid) {
            throw new https_1.HttpsError("failed-precondition", "Malformed challenge.");
        }
        if (uid !== g.opponentUid)
            throw new https_1.HttpsError("permission-denied", "This challenge isn't addressed to you.");
        // A GROUP TAG is optional (Warlord is one world: any user may challenge any
        // other). When a battle carries one, it must still be honest — both players
        // members — so re-check it inside the tx. A global battle has groupId === null;
        // note `groups/${null}` is a VALID path string, so this must be guarded or every
        // global challenge would fail the membership check.
        const battleGroupId = typeof g.groupId === "string" && g.groupId ? g.groupId : null;
        if (battleGroupId) {
            const groupSnap = await tx.get(db.doc(`groups/${battleGroupId}`));
            const members = groupSnap.exists ? (_a = groupSnap.data()) === null || _a === void 0 ? void 0 : _a.members : undefined;
            if (!Array.isArray(members) || !members.includes(players[0]) || !members.includes(players[1])) {
                throw new https_1.HttpsError("permission-denied", "Both players must be members of the group.");
            }
        }
        // The challenger's army lives in the Admin-only warlordDeploys doc (never readable
        // by the opponent while waiting → no pre-commit counter-picking). Re-sanitize it.
        const deploySnap = await tx.get(deployRef);
        const challenger = (0, pvp_1.sanitizeDeploy)(deploySnap.exists ? deploySnap.data() : undefined, "PLAYER");
        if (!challenger.ok) {
            throw new https_1.HttpsError("failed-precondition", `Challenger deployment invalid: ${challenger.error}`);
        }
        // Server-owned seed, generated only after BOTH deploys are locked in.
        const seed = crypto.randomInt(0, 0x100000000); // CSPRNG uint32 (engine applies seed >>> 0)
        const state = (0, pvp_1.createPvpBattle)(challenger.combatants, defender.combatants, seed);
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
        });
        tx.delete(deployRef); // private staging no longer needed
        return { ok: true };
    });
});
// Create a PvP challenge (server-authoritative). The challenger's army is validated
// here and stored in the Admin-only `warlordDeploys/{gameId}` doc so the opponent
// cannot read it before committing their own; the public game doc stays army-free
// while 'waiting'. (Client cannot create warlord docs directly — rules deny it.)
exports.createWarlordChallenge = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const { groupId, opponentUid, unitIds, combatants } = request.data || {};
    // groupId is OPTIONAL: Warlord is one shared world, so any app user may challenge
    // any other. A groupId (when supplied) only tags the battle to that group so it
    // also shows up in the group's arcade list — it is never a permission requirement.
    const groupIdOrNull = typeof groupId === "string" && groupId ? groupId : null;
    if (typeof opponentUid !== "string" || !opponentUid || opponentUid === uid) {
        throw new https_1.HttpsError("invalid-argument", "A valid, distinct opponent is required.");
    }
    if (opponentUid.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "Invalid opponent id.");
    const deploy = (0, pvp_1.sanitizeDeploy)({ unitIds, combatants }, "PLAYER");
    if (!deploy.ok)
        throw new https_1.HttpsError("invalid-argument", `Invalid deployment: ${deploy.error}`);
    // Anyone may challenge anyone (one world), so the abuse control is a per-sender daily
    // cap rather than a relationship gate — each challenge costs the target a push + docs.
    if (!(await tryConsumeQuota(uid, "warlord_challenge_usage", WARLORD_CHALLENGE_DAILY_LIMIT))) {
        throw new https_1.HttpsError("resource-exhausted", "Daily challenge limit reached. Please try again tomorrow.");
    }
    const db = admin.firestore();
    // The opponent must be a real app user (a profile doc is created on every login).
    const oppProfile = await db.doc(`profiles/${opponentUid}`).get();
    if (!oppProfile.exists)
        throw new https_1.HttpsError("not-found", "That player doesn't exist.");
    // When a group is supplied, both players must actually be in it (it becomes a
    // visibility tag on the doc, so it must be honest).
    if (groupIdOrNull) {
        const groupSnap = await db.doc(`groups/${groupIdOrNull}`).get();
        const members = groupSnap.exists ? (_b = groupSnap.data()) === null || _b === void 0 ? void 0 : _b.members : undefined;
        if (!Array.isArray(members) || !members.includes(uid) || !members.includes(opponentUid)) {
            throw new https_1.HttpsError("permission-denied", "Both players must be members of that group.");
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
    const challengerName = ((_c = (await db.doc(`profiles/${uid}`).get()).data()) === null || _c === void 0 ? void 0 : _c.name) || "A challenger";
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
        const tokens = [...new Set(((_d = oppDoc.data()) === null || _d === void 0 ? void 0 : _d.fcmTokens) || [])];
        if (tokens.length > 0) {
            await admin.messaging().sendEachForMulticast({
                notification: { title: "⚔️ Warlord challenge", body: `${challengerName} has challenged you to battle.` },
                tokens,
            });
        }
    }
    catch (e) {
        console.error("Warlord challenge push failed:", e);
    }
    return { gameId: gameRef.id };
});
// Record a finished battle in the public world roster (server-only fields).
// Best-effort: a ladder-stat hiccup must never fail the battle itself.
async function recordWarlordResult(winnerUid, loserUid) {
    try {
        const db = admin.firestore();
        const inc = admin.firestore.FieldValue.increment(1);
        const writes = [];
        if (winnerUid)
            writes.push(db.doc(`warlordPlayers/${winnerUid}`).set({ wins: inc }, { merge: true }));
        if (loserUid)
            writes.push(db.doc(`warlordPlayers/${loserUid}`).set({ losses: inc }, { merge: true }));
        await Promise.all(writes);
    }
    catch (e) {
        console.error("Warlord ladder update failed:", e);
    }
}
// Apply one battle command. The seat check + the pure engine are the entire
// authority: an illegal command is rejected (applied:false, nothing persisted —
// the engine's skip path consumes no rng, so dropping it is determinism-safe).
exports.submitWarlordCommand = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const gameId = requireGameId(request.data);
    const cmd = parseWarlordCommand((_b = request.data) === null || _b === void 0 ? void 0 : _b.command);
    if (!cmd)
        throw new https_1.HttpsError("invalid-argument", "Malformed command.");
    const db = admin.firestore();
    const ref = db.doc(`games/${gameId}`);
    let ladder = null;
    const result = await db.runTransaction(async (tx) => {
        var _a;
        ladder = null; // transaction callbacks re-run on contention — never reuse an aborted attempt's value
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "Game not found.");
        const g = snap.data();
        if (g.gameType !== WARLORD_GAME_TYPE || g.status !== "playing") {
            throw new https_1.HttpsError("failed-precondition", "Not an active Warlord battle.");
        }
        const battle = g.state;
        if (!battle || battle.status !== "ONGOING") {
            throw new https_1.HttpsError("failed-precondition", "Battle already resolved.");
        }
        if (!Array.isArray(g.players) || !g.players.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "You aren't a participant in this battle.");
        }
        const seatUid = g.players[battle.side === "PLAYER" ? 0 : 1];
        if (seatUid !== uid)
            throw new https_1.HttpsError("permission-denied", "Not your turn.");
        const next = (0, engine_1.applyCommand)(battle, cmd);
        // The engine's reject path appends a 'skipped' entry; a legal command never does.
        const last = next.log.length > 0 ? next.log[next.log.length - 1] : null;
        if (last && last.kind === "skipped") {
            return { applied: false, finished: false };
        }
        const patch = { state: next };
        const finished = next.status !== "ONGOING";
        if (finished) {
            const winnerUid = next.status === "PLAYER_WON" ? g.players[0] :
                next.status === "ENEMY_WON" ? g.players[1] : null; // DRAW → null (arcade convention)
            patch.status = "finished";
            patch.winner = winnerUid;
            patch.finalized = true; // server-side session lock; leaderboard needs no client write
            patch.endedAt = admin.firestore.FieldValue.serverTimestamp();
            ladder = winnerUid
                ? { winner: winnerUid, loser: (_a = g.players.find((p) => p !== winnerUid)) !== null && _a !== void 0 ? _a : null }
                : null; // draws don't move the ladder
        }
        tx.update(ref, patch);
        return { applied: true, finished };
    });
    const done = ladder;
    if (done)
        await recordWarlordResult(done.winner, done.loser);
    return result;
});
// Retreat (= concede) an active battle, or decline/cancel a waiting challenge.
exports.forfeitWarlordBattle = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const gameId = requireGameId(request.data);
    const db = admin.firestore();
    const ref = db.doc(`games/${gameId}`);
    let ladder = null;
    const result = await db.runTransaction(async (tx) => {
        ladder = null; // see above: reset per attempt so retries/early returns can't replay it
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "Game not found.");
        const g = snap.data();
        if (g.gameType !== WARLORD_GAME_TYPE)
            throw new https_1.HttpsError("failed-precondition", "Not a Warlord battle.");
        if (!Array.isArray(g.players) || !g.players.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "You aren't a participant in this battle.");
        }
        if (g.status === "finished")
            return { ok: true, already: true }; // idempotent
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
        const s = structuredClone(g.state);
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
    const done = ladder;
    if (done)
        await recordWarlordResult(done.winner, done.loser);
    return result;
});
// Turn/lifecycle push notifications. Fires on EVERY games/{id} update (Firestore
// triggers can't filter on field values) — exits before any reads for other types.
// Performs zero Firestore writes → cannot retrigger itself.
exports.onWarlordBattleUpdated = (0, firestore_1.onDocumentUpdated)("games/{gameId}", async (event) => {
    var _a, _b, _c;
    const change = event.data;
    if (!change)
        return;
    const after = change.after.data();
    if (!after || after.gameType !== WARLORD_GAME_TYPE)
        return;
    const before = change.before.data() || {};
    const players = Array.isArray(after.players) ? after.players : [];
    if (players.length !== 2)
        return;
    // One push target set per branch (else-if: the accept write flips status AND
    // creates state — it must not also fire the turn branch).
    let targets = [];
    if (before.status === "waiting" && after.status === "playing") {
        targets = [{
                uid: players[0], // initial side = PLAYER = seat 0 (the challenger moves first)
                title: "⚔️ Warlord: battle joined!",
                body: "Your challenge was accepted — it's your move.",
            }];
    }
    else if (before.status !== "finished" && after.status === "finished") {
        const w = after.winner;
        const suffix = after.forfeitedBy ? " (by retreat)" : "";
        targets = players.map((uid) => ({
            uid,
            title: "⚔️ Warlord: battle over",
            body: w == null ? "The battle ended in a draw." : uid === w ? `Victory!${suffix}` : `Defeat.${suffix}`,
        }));
    }
    else if (after.status === "playing" && ((_a = before.state) === null || _a === void 0 ? void 0 : _a.side) !== ((_b = after.state) === null || _b === void 0 ? void 0 : _b.side)) {
        const seatUid = players[after.state.side === "PLAYER" ? 0 : 1];
        targets = [{ uid: seatUid, title: "⚔️ Warlord: your turn", body: "The enemy has ended their turn." }];
    }
    if (targets.length === 0)
        return;
    try {
        for (const t of targets) {
            const userDoc = await admin.firestore().doc(`users/${t.uid}`).get();
            const tokens = ((_c = userDoc.data()) === null || _c === void 0 ? void 0 : _c.fcmTokens) || [];
            const unique = [...new Set(tokens)];
            if (unique.length === 0)
                continue;
            const res = await admin.messaging().sendEachForMulticast({
                notification: { title: t.title, body: t.body },
                tokens: unique,
            });
            console.log(`Warlord push to ${t.uid}: sent ${res.successCount}, failed ${res.failureCount}`);
        }
    }
    catch (error) {
        console.error("Error sending Warlord FCM:", error);
    }
});
//# sourceMappingURL=index.js.map