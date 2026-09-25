// functions/src/errorRetention.ts
//
// How long an error-log row lives. Pure — no imports — so the app suite can test it.
//
// Every `errorLogs` row carries a uid, and a client row also the reporter's email, user agent and
// url. Until 25.09.2026 none of them ever expired. They now carry `expireAt`, and a Firestore TTL
// policy on that field (firestore.indexes.json, deployed with `--only firestore:indexes`) deletes
// each row within about a day of it passing.
//
// 90 days, not 30: the admin panel and the digest group the newest 500 rows, and "not a defect"
// judgements ("four occurrences over twelve days, nothing in a month") need at least a month of
// history; the digest itself stays in Cloud Logging for about 30. The admin's decisions about a
// group of errors live in `errorGroups`, which has NO TTL — so a recurrence after the rows have
// expired still shows as "regressed". Measured on live 25.09: 110 rows, the oldest 61 days old.

/** The field the TTL policy watches. MUST equal the fieldOverride in firestore.indexes.json. */
export const ERROR_LOG_TTL_FIELD = "expireAt";

/** Owner-visible decision: how long an error row is kept. */
export const ERROR_LOG_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a row written at `writtenAtMs` becomes eligible for TTL deletion. Plain UTC arithmetic, so
 * no daylight-saving change can move it. Throws rather than return a date that would never expire.
 */
export function errorLogExpiryMs(writtenAtMs: number, days: number = ERROR_LOG_RETENTION_DAYS): number {
  if (!Number.isFinite(writtenAtMs) || !Number.isFinite(days) || days <= 0) {
    throw new RangeError("errorLogExpiryMs: a finite time and a positive retention are required");
  }
  return writtenAtMs + days * DAY_MS;
}
