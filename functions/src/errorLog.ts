// functions/src/errorLog.ts
//
// The ONLY writer of `errorLogs`. It stamps `createdAt` and the TTL field LAST, so no caller can
// omit or override either — a row without `expireAt` is a row that lives for ever. See
// errorRetention.ts for why the rows now expire, and after how long.
//
// A server error stores at most SERVER_ERROR_DAILY_CAP rows a day, by fingerprint (errorCap.ts, the
// why). Client rows keep their own cap, per account, in `logClientError`.
//
// Like inviteLinks.ts, it calls `admin.firestore()` only inside its functions, so the
// `initializeApp()` in index.ts has always run by then.

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { ERROR_LOG_TTL_FIELD, errorLogExpiryMs } from "./errorRetention";
import { fingerprint } from "./errorGrouping";
import { groupDocId } from "./errorState";
import { fixFor } from "./errorFixes";
import { SERVER_ERROR_DAILY_CAP, capMarkerMessage, capStep, newestClaim, type CapAction } from "./errorCap";

/**
 * One small document per server error (errorCap.ts, `CapCount`): a day, a count, the claim its newest
 * row answered. Under a hash of its fingerprint, so nothing of the message (which may hold a name or an
 * address) outlives the rows' TTL here. No rule matches the collection, so no client reads or writes it.
 */
export const ERROR_CAPS = "errorCaps";

/** A lost race this many times stores the row (fail-open): about 2.5 s of backoff at most, not 8. */
const CAP_ATTEMPTS = 3;

/** The row as stored: the caller's fields, then `createdAt` and the TTL field LAST. */
function stamped(row: Record<string, unknown>, nowMs: number): Record<string, unknown> {
  return {
    ...row,
    createdAt: FieldValue.serverTimestamp(),
    // A Timestamp, not a string or a number: the TTL policy silently ignores any other type.
    [ERROR_LOG_TTL_FIELD]: Timestamp.fromMillis(errorLogExpiryMs(nowMs)),
  };
}

export async function addErrorLog(row: Record<string, unknown>, nowMs: number = Date.now()): Promise<void> {
  await admin.firestore().collection("errorLogs").add(stamped(row, nowMs));
}

/**
 * The errors this instance has seen past the cap today, by cap key, and only those take the fast path
 * below: for any other occurrence it would be one more round trip before the transaction that decides
 * anyway. Per instance and best effort; the transaction stays the judge.
 */
const pastCapToday = new Map<string, string>();

interface ServerRow extends Record<string, unknown> { message: string; context: string }

/**
 * One occurrence of a server error under the day's cap (errorCap.ts): the decision, the count and the
 * row in ONE transaction. A count recording that a row answered a claim must never stand without the
 * row, or the claim's one row is spent on nothing (the re-verification, 01.11.2026). `"unknown"`: the
 * cap could not be decided, and the caller stores the row anyway, since a cap must not hide an error.
 */
async function storeUnderCap(row: ServerRow): Promise<CapAction | "unknown"> {
  const fp = fingerprint(row.message, row.context);
  const key = createHash("sha256").update(fp).digest("hex").slice(0, 32);
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  try {
    const db = admin.firestore();
    const capRef = db.doc(`${ERROR_CAPS}/${key}`);
    // Where Health keeps what was claimed about this error (adminSetErrorStatus): its watermark.
    const stateRef = db.doc(`errorGroups/${groupDocId(fp)}`);
    // Made once, outside the transaction: the library retries an attempt whose commit may have landed with
    // its answer lost, and the retry then writes the same row again, not a second one.
    const rowRef = db.collection("errorLogs").doc();
    const fixSince = fixFor(fp)?.since ?? null;
    if (pastCapToday.get(key) === today) {
      // No transaction for an error already past the cap, with no claim waiting for a row: a burst of it
      // queues on nothing. Not stale the dangerous way: within a day the count only grows, and a claim
      // made since is read in this same call.
      const [cap, state] = await db.getAll(capRef, stateRef);
      if (capStep(cap.data(), today, newestClaim(state.data(), fixSince, nowMs)).action === "drop") {
        await capRef.update({ count: FieldValue.increment(1) }).catch(() => undefined);
        return "drop";
      }
    }
    const step = await db.runTransaction(async (tx) => {
      const [c, s] = await tx.getAll(capRef, stateRef);
      const decided = capStep(c.data(), today, newestClaim(s.data(), fixSince, nowMs));
      tx.set(capRef, decided.next);
      if (decided.action === "write") tx.set(rowRef, stamped(row, nowMs));
      if (decided.action === "marker") {
        tx.set(rowRef, stamped({ ...row, message: capMarkerMessage(row.message), stack: null }, nowMs));
      }
      return decided;
    }, { maxAttempts: CAP_ATTEMPTS });
    if (step.next.count > SERVER_ERROR_DAILY_CAP) {
      if (pastCapToday.size > 1000) pastCapToday.clear();
      pastCapToday.set(key, today);
    }
    return step.action;
  } catch {
    return "unknown";
  }
}

/**
 * Record a server-side error so it surfaces in the admin Health panel, and THROW if the row could not
 * be written — for the caller that must not remember "reported" for a report that never landed (the
 * idle-game sweep, games.ts). Over the day's cap nothing is written and nothing is thrown: the same
 * error already holds its rows for today, and the occurrence is in Cloud Logging.
 */
export async function addServerError(message: string, where: string, extra?: any): Promise<void> {
  const row: ServerRow = {
    message: String(message || "server error").slice(0, 1000),
    stack: extra?.stack ? String(extra.stack).slice(0, 4000) : null,
    context: where.slice(0, 200),
    uid: extra?.uid || null,
    source: "server",
  };
  const stored = await storeUnderCap(row);
  if (stored === "unknown") {
    await addErrorLog(row);
    return;
  }
  if (stored !== "write") console.error(`SERVER_ERROR_OVER_CAP [${row.context}] ${row.message}`);
}

/** Record a server-side error so it surfaces in the admin Health panel. Never throws. */
export async function logServerError(message: string, where: string, extra?: any): Promise<void> {
  try {
    await addServerError(message, where, extra);
  } catch { /* never let logging break the caller */ }
}
