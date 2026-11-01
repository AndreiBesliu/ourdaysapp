"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CAPS = void 0;
exports.addErrorLog = addErrorLog;
exports.addServerError = addServerError;
exports.logServerError = logServerError;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
const errorRetention_1 = require("./errorRetention");
const errorGrouping_1 = require("./errorGrouping");
const errorState_1 = require("./errorState");
const errorFixes_1 = require("./errorFixes");
const errorCap_1 = require("./errorCap");
/**
 * One small document per server error (errorCap.ts, `CapCount`): a day, a count, the claim its newest
 * row answered. Under a hash of its fingerprint, so nothing of the message (which may hold a name or an
 * address) outlives the rows' TTL here. No rule matches the collection, so no client reads or writes it.
 */
exports.ERROR_CAPS = "errorCaps";
/** A lost race this many times stores the row (fail-open): about 2.5 s of backoff at most, not 8. */
const CAP_ATTEMPTS = 3;
/** The row as stored: the caller's fields, then `createdAt` and the TTL field LAST. */
function stamped(row, nowMs) {
    return Object.assign(Object.assign({}, row), { createdAt: firestore_1.FieldValue.serverTimestamp(), 
        // A Timestamp, not a string or a number: the TTL policy silently ignores any other type.
        [errorRetention_1.ERROR_LOG_TTL_FIELD]: firestore_1.Timestamp.fromMillis((0, errorRetention_1.errorLogExpiryMs)(nowMs)) });
}
async function addErrorLog(row, nowMs = Date.now()) {
    await admin.firestore().collection("errorLogs").add(stamped(row, nowMs));
}
/**
 * The errors this instance has seen past the cap today, by cap key, and only those take the fast path
 * below: for any other occurrence it would be one more round trip before the transaction that decides
 * anyway. Per instance and best effort; the transaction stays the judge.
 */
const pastCapToday = new Map();
/**
 * One occurrence of a server error under the day's cap (errorCap.ts): the decision, the count and the
 * row in ONE transaction. A count recording that a row answered a claim must never stand without the
 * row, or the claim's one row is spent on nothing (the re-verification, 01.11.2026). `"unknown"`: the
 * cap could not be decided, and the caller stores the row anyway, since a cap must not hide an error.
 */
async function storeUnderCap(row) {
    var _a, _b;
    const fp = (0, errorGrouping_1.fingerprint)(row.message, row.context);
    const key = (0, crypto_1.createHash)("sha256").update(fp).digest("hex").slice(0, 32);
    const nowMs = Date.now();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    try {
        const db = admin.firestore();
        const capRef = db.doc(`${exports.ERROR_CAPS}/${key}`);
        // Where Health keeps what was claimed about this error (adminSetErrorStatus): its watermark.
        const stateRef = db.doc(`errorGroups/${(0, errorState_1.groupDocId)(fp)}`);
        // Made once, outside the transaction: the library retries an attempt whose commit may have landed with
        // its answer lost, and the retry then writes the same row again, not a second one.
        const rowRef = db.collection("errorLogs").doc();
        const fixSince = (_b = (_a = (0, errorFixes_1.fixFor)(fp)) === null || _a === void 0 ? void 0 : _a.since) !== null && _b !== void 0 ? _b : null;
        if (pastCapToday.get(key) === today) {
            // No transaction for an error already past the cap, with no claim waiting for a row: a burst of it
            // queues on nothing. Not stale the dangerous way: within a day the count only grows, and a claim
            // made since is read in this same call.
            const [cap, state] = await db.getAll(capRef, stateRef);
            if ((0, errorCap_1.capStep)(cap.data(), today, (0, errorCap_1.newestClaim)(state.data(), fixSince, nowMs)).action === "drop") {
                await capRef.update({ count: firestore_1.FieldValue.increment(1) }).catch(() => undefined);
                return "drop";
            }
        }
        const step = await db.runTransaction(async (tx) => {
            const [c, s] = await tx.getAll(capRef, stateRef);
            const decided = (0, errorCap_1.capStep)(c.data(), today, (0, errorCap_1.newestClaim)(s.data(), fixSince, nowMs));
            tx.set(capRef, decided.next);
            if (decided.action === "write")
                tx.set(rowRef, stamped(row, nowMs));
            if (decided.action === "marker") {
                tx.set(rowRef, stamped(Object.assign(Object.assign({}, row), { message: (0, errorCap_1.capMarkerMessage)(row.message), stack: null }), nowMs));
            }
            return decided;
        }, { maxAttempts: CAP_ATTEMPTS });
        if (step.next.count > errorCap_1.SERVER_ERROR_DAILY_CAP) {
            if (pastCapToday.size > 1000)
                pastCapToday.clear();
            pastCapToday.set(key, today);
        }
        return step.action;
    }
    catch (_c) {
        return "unknown";
    }
}
/**
 * Record a server-side error so it surfaces in the admin Health panel, and THROW if the row could not
 * be written — for the caller that must not remember "reported" for a report that never landed (the
 * idle-game sweep, games.ts). Over the day's cap nothing is written and nothing is thrown: the same
 * error already holds its rows for today, and the occurrence is in Cloud Logging.
 */
async function addServerError(message, where, extra) {
    const row = {
        message: String(message || "server error").slice(0, 1000),
        stack: (extra === null || extra === void 0 ? void 0 : extra.stack) ? String(extra.stack).slice(0, 4000) : null,
        context: where.slice(0, 200),
        uid: (extra === null || extra === void 0 ? void 0 : extra.uid) || null,
        source: "server",
    };
    const stored = await storeUnderCap(row);
    if (stored === "unknown") {
        await addErrorLog(row);
        return;
    }
    if (stored !== "write")
        console.error(`SERVER_ERROR_OVER_CAP [${row.context}] ${row.message}`);
}
/** Record a server-side error so it surfaces in the admin Health panel. Never throws. */
async function logServerError(message, where, extra) {
    try {
        await addServerError(message, where, extra);
    }
    catch ( /* never let logging break the caller */_a) { /* never let logging break the caller */ }
}
//# sourceMappingURL=errorLog.js.map