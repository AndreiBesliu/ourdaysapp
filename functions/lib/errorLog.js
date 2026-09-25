"use strict";
// functions/src/errorLog.ts
//
// The ONLY writer of `errorLogs`. It stamps `createdAt` and the TTL field LAST, so no caller can
// omit or override either — a row without `expireAt` is a row that lives for ever. See
// errorRetention.ts for why the rows now expire, and after how long.
//
// Like inviteLinks.ts, it calls `admin.firestore()` only inside its functions, so the
// `initializeApp()` in index.ts has always run by then.
Object.defineProperty(exports, "__esModule", { value: true });
exports.addErrorLog = addErrorLog;
exports.logServerError = logServerError;
const admin = require("firebase-admin");
const errorRetention_1 = require("./errorRetention");
async function addErrorLog(row, nowMs = Date.now()) {
    await admin.firestore().collection("errorLogs").add(Object.assign(Object.assign({}, row), { createdAt: admin.firestore.FieldValue.serverTimestamp(), 
        // A Timestamp, not a string or a number: the TTL policy silently ignores any other type.
        [errorRetention_1.ERROR_LOG_TTL_FIELD]: admin.firestore.Timestamp.fromMillis((0, errorRetention_1.errorLogExpiryMs)(nowMs)) }));
}
/** Record a server-side error so it surfaces in the admin Health panel. Never throws. */
async function logServerError(message, where, extra) {
    try {
        await addErrorLog({
            message: String(message || "server error").slice(0, 1000),
            stack: (extra === null || extra === void 0 ? void 0 : extra.stack) ? String(extra.stack).slice(0, 4000) : null,
            context: where.slice(0, 200),
            uid: (extra === null || extra === void 0 ? void 0 : extra.uid) || null,
            source: "server",
        });
    }
    catch ( /* never let logging break the caller */_a) { /* never let logging break the caller */ }
}
//# sourceMappingURL=errorLog.js.map