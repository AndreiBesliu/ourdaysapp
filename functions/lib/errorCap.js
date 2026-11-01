"use strict";
// functions/src/errorCap.ts
//
// How many rows ONE server error may write in a day (errorLog.ts).
//
// A client's rows have had a cap from the start: 200 per account per day (`logClientError`). The
// server's had none, and the TTL limits how long a row lives, not how many there are. That matters
// because Health reads the newest 500 rows and groups them: one error repeating fast enough pushes
// every other one out of that window, and the panel then shows a single problem, honestly counted,
// with the rest invisible. On live, `ai:suggestAsset` wrote 47 rows on 26.07.2026, from one cause.
//
// So each error, by its fingerprint (the same key the panel groups by), stores its first 20 rows of
// a UTC day. The first one over is replaced by ONE row saying the cap was reached, so the panel says
// the count stopped instead of letting it look like the whole story; every later one goes only to
// Cloud Logging (`console.error`, read with `firebase functions:log`). The day resets the count.
//
// ── The one row a claim needs ────────────────────────────────────────────────────────────
//
// Everything the panel concludes about an error, it concludes from ROWS: "regressed" is a row newer
// than the watermark a resolve stored (errorState.ts), a fix claim fails on a row newer than its
// `since` (errorFixes.ts), and the bulk resolve re-checks the claim against rows on the server. A cap
// that swallowed every row after the 20th would let a fix that does not work read "holding" until
// midnight, on exactly the day the error spiked (the review, 01.11.2026). So when a claim — the
// group's stored watermark, or a fix's `since` — was made after the newest stored row, one occurrence
// past the cap is stored anyway: the one that can refute it.
//
// "Made after the newest row" is not decided by comparing times: the claim is a Firestore time (a
// watermark is a row's createdAt) and this runs on a function's clock, which may be a little off. Each
// stored row records the claim that stood when it was written (`answered`). That row was committed
// after the claim existed, so Firestore stamped it later than the claim, and it refutes it if the error
// is back. A claim no row has recorded is one nothing has answered yet.
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAIM_SKEW_MS = exports.SERVER_ERROR_DAILY_CAP = void 0;
exports.newestClaim = newestClaim;
exports.capStep = capStep;
exports.capMarkerMessage = capMarkerMessage;
exports.SERVER_ERROR_DAILY_CAP = 20;
const ms = (v) => (typeof v === "string" ? Date.parse(v) : NaN);
/** How far ahead of this clock a claim may be and still stand (clocks differ a little; a hand-typed time more). */
exports.CLAIM_SKEW_MS = 10 * 60000;
/**
 * The newest of the claims standing about an error at `nowMs`: its stored watermark, and a fix's `since`.
 *
 * A claim dated after now is not standing yet. A `since` typed by hand in local time with a "Z" lies
 * hours ahead; standing at once, it would spend its one row before it could refute anything, and hide a
 * later resolve's watermark behind it until then (the re-verification, 01.11.2026).
 */
function newestClaim(state, fixSince, nowMs) {
    const watermark = state && typeof state === "object" ? state.watermark : undefined;
    const claims = [watermark, fixSince]
        .filter((v) => Number.isFinite(ms(v)) && ms(v) <= nowMs + exports.CLAIM_SKEW_MS);
    if (claims.length === 0)
        return null;
    return claims.reduce((a, b) => (ms(b) > ms(a) ? b : a));
}
/** The decision for one more occurrence on the UTC day `today`, and the document to store for it. */
function capStep(stored, today, claim = null, cap = exports.SERVER_ERROR_DAILY_CAP) {
    const s = stored && typeof stored === "object" ? stored : {};
    const sameDay = s.day === today;
    const seen = sameDay && typeof s.count === "number" && Number.isFinite(s.count) && s.count > 0
        ? Math.floor(s.count)
        : 0;
    const marked = sameDay && s.marked === true;
    const answered = typeof s.answered === "string" ? s.answered : null;
    const standing = Number.isFinite(ms(claim)) ? claim : null;
    const unanswered = standing !== null && standing !== answered;
    const action = seen < cap || unanswered ? "write" : marked ? "drop" : "marker";
    return {
        action,
        next: {
            day: today,
            count: seen + 1,
            marked: marked || action === "marker",
            // Every stored row answers the claim standing when it is written, under the cap or past it.
            answered: action === "write" && standing !== null ? standing : answered,
        },
    };
}
/**
 * The message of the row that replaces the first one over the cap. Short in front, because the panel's
 * key keeps 200 characters (errorGrouping.ts) and the error's own words must survive in it.
 */
function capMarkerMessage(message, cap = exports.SERVER_ERROR_DAILY_CAP) {
    return `Cap of ${cap}/day reached, the rest only in Cloud Logging: ${message}`.slice(0, 1000);
}
//# sourceMappingURL=errorCap.js.map