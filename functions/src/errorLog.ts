// functions/src/errorLog.ts
//
// The ONLY writer of `errorLogs`. It stamps `createdAt` and the TTL field LAST, so no caller can
// omit or override either — a row without `expireAt` is a row that lives for ever. See
// errorRetention.ts for why the rows now expire, and after how long.
//
// Like inviteLinks.ts, it calls `admin.firestore()` only inside its functions, so the
// `initializeApp()` in index.ts has always run by then.

import * as admin from "firebase-admin";
import { ERROR_LOG_TTL_FIELD, errorLogExpiryMs } from "./errorRetention";

export async function addErrorLog(row: Record<string, unknown>, nowMs: number = Date.now()): Promise<void> {
  await admin.firestore().collection("errorLogs").add({
    ...row,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // A Timestamp, not a string or a number: the TTL policy silently ignores any other type.
    [ERROR_LOG_TTL_FIELD]: admin.firestore.Timestamp.fromMillis(errorLogExpiryMs(nowMs)),
  });
}

/** Record a server-side error so it surfaces in the admin Health panel. Never throws. */
export async function logServerError(message: string, where: string, extra?: any): Promise<void> {
  try {
    await addErrorLog({
      message: String(message || "server error").slice(0, 1000),
      stack: extra?.stack ? String(extra.stack).slice(0, 4000) : null,
      context: where.slice(0, 200),
      uid: extra?.uid || null,
      source: "server",
    });
  } catch { /* never let logging break the caller */ }
}
