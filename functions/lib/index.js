"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onGameCreated = exports.onMessageCreated = exports.autoSuggestChecklist = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const generative_ai_1 = require("@google/generative-ai");
admin.initializeApp();
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
//# sourceMappingURL=index.js.map