import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// Create in-app notifications for other users via the server-side `notifyUsers`
// Cloud Function. Clients can no longer write the `notifications` collection
// directly (Firestore denies create); the function validates that recipients
// share a group with the sender and rate-limits. Best-effort — never throws
// into the caller's flow.
export async function notifyUsers(params: {
  recipientIds: string[];
  type: string;
  title: string;
  body?: string;
}): Promise<void> {
  try {
    const fn = httpsCallable(getFunctions(app), "notifyUsers");
    await fn(params);
  } catch (e) {
    console.error("Failed to send notifications", e);
  }
}
