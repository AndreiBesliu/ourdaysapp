import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import { reportError } from "./reportError";

// Create in-app notifications for other users via the server-side `notifyUsers`
// Cloud Function. Clients can no longer write the `notifications` collection
// directly (Firestore denies create); the function validates that recipients
// share a group with the sender and rate-limits. Best-effort — never throws
// into the caller's flow.
export async function notifyUsers(params: {
  recipientIds: string[];
  type: string;
  /** Rendered in the SENDER's language. Kept only as the fallback for a reader who cannot
   *  translate the key — never the thing a reader is meant to see. */
  title: string;
  body?: string;
  /** What a reader actually renders, in their OWN language. Without these, a notification is
   *  frozen in whatever language the sender happened to have set. */
  titleKey?: string;
  bodyKey?: string;
  param?: string;
}): Promise<void> {
  try {
    const fn = httpsCallable(getFunctions(app), "notifyUsers");
    await fn(params);
  } catch (e) {
    // Best-effort by design — a failed notification must not break the save that triggered it —
    // but "best effort" is not "unobserved": console.error alone means nobody ever learns that
    // notifications stopped going out.
    reportError(e instanceof Error ? e.message : String(e), { context: 'notifyUsers' });
  }
}
