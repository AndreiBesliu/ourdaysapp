import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

export const autoSuggestChecklist = onDocumentCreated({
  document: "events/{eventId}",
  secrets: [geminiApiKey]
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

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
    const key = geminiApiKey.value();
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const prompt = `You are a helpful AI Assistant for a family organization app. 
The user created a task/event titled "${title}".
${description ? `The description is: "${description}".` : ""}
Generate a checklist of 3 to 7 actionable, brief steps or items needed to complete this task.
Return ONLY a valid JSON array of strings, nothing else. No markdown formatting.
Example output: ["Buy milk", "Get eggs", "Pay the cashier"]`;

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
      const newAssignees = data.assigneeIds.filter((id: string) => id !== "ai_assistant");

      await snapshot.ref.update({
        checklistItems: combinedItems,
        assigneeIds: newAssignees
      });
      console.log(`Successfully generated checklist for: ${title}`);
    }
  } catch (error) {
    console.error("AI Generation Error", error);
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
