"use strict";
// functions/src/pushTokens.ts
//
// Which addresses one push call proved dead (notify.ts).
//
// FCM's v1 API answers INVALID_ARGUMENT both for a token that is not a token (or no longer is one)
// and for a MESSAGE it refuses: a field it does not accept, a value of the wrong type, a payload over
// its size. The Admin SDK maps both to `messaging/invalid-argument` (lib/utils/error.js,
// MESSAGING_SERVER_TO_CLIENT_CODE), and the legacy `invalid-registration-token` no longer comes back
// from a v1 send. So reading every `invalid-argument` as a dead token, as notify() did, meant that one
// malformed message, from any caller added later, would unsubscribe EVERY recipient of it at once,
// silently.
//
// One call sends one message to all its tokens. So when any of them was delivered, the message was
// fine, and an `invalid-argument` beside it is about its token. When none was, nothing in the call
// says which of the two it is: the answer has to come from elsewhere, and notify() asks FCM to
// validate the same message without delivering it (a dry run). Not from counting: two refused tokens
// are no evidence against the message when both are one person's, who stopped using two devices
// (the review, 01.11.2026).
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEND_THREW = exports.FCM_BATCH = void 0;
exports.deadTokens = deadTokens;
exports.unreachedCodes = unreachedCodes;
exports.codeWords = codeWords;
exports.dryRunVerdict = dryRunVerdict;
/** These name the address itself as gone, whatever happened to the message. */
const GONE = ["registration-token-not-registered", "invalid-registration-token"];
/** `messageValid`: a dry run of the same message passed, so an `invalid-argument` is its token's. */
function deadTokens(results, messageValid = false) {
    const proven = messageValid || results.some((r) => r.success);
    const dead = [];
    let refused = 0;
    results.forEach((r, i) => {
        if (r.success)
            return;
        const code = typeof r.code === "string" ? r.code : "";
        if (GONE.some((g) => code.includes(g))) {
            dead.push(i);
        }
        else if (code.includes("invalid-argument")) {
            refused++;
            if (proven)
                dead.push(i);
        }
    });
    return { dead, unproven: !proven && refused > 0 };
}
/** The most tokens one multicast takes (firebase-admin's FCM_MAX_BATCH_SIZE): past it, the call throws. */
exports.FCM_BATCH = 500;
/** Stands for each token of a slice whose call threw: it says nothing about the address or the message. */
exports.SEND_THREW = "notify/send-threw";
/**
 * A push that reached NOBODY for a reason other than dead addresses: the failure codes, sorted and
 * distinct. `null` when anything was delivered, or when every failure was an address proved dead.
 *
 * Before this, such a push left no trace but the function's log: FCM credentials gone wrong, a quota,
 * an outage, a field the SDK refuses before sending, a call that threw. Every push in the app could stop
 * and the Health panel would stay green (the review, 01.11.2026).
 */
function unreachedCodes(results, dead) {
    if (results.some((r) => r.success))
        return null;
    const proved = new Set(dead);
    const codes = new Set();
    results.forEach((r, i) => {
        if (!proved.has(i))
            codes.add(typeof r.code === "string" && r.code ? r.code : "unknown");
    });
    return codes.size > 0 ? [...codes].sort() : null;
}
/**
 * The codes as the error row writes them: hyphens become spaces. The Health panel's key (errorGrouping.ts,
 * `fingerprint`) reads any run of 20 or more letters, digits, `_` and `-` as an id, and FCM's longest codes
 * are that long (`mismatched-credential`, `message-rate-exceeded`, `third-party-auth-error`): written raw,
 * different failures would share one group and one daily cap (the review, 01.11.2026).
 */
function codeWords(codes) {
    return codes.map((c) => c.replace(/-/g, " ")).join(", ");
}
/** What a dry run of the message said, by the error it threw (none: `"valid"`). */
function dryRunVerdict(error) {
    if (error === undefined || error === null)
        return "valid";
    const code = typeof error.code === "string" ? error.code : "";
    // The message itself: refused by FCM, or by the SDK before it left. Anything else (a quota, an
    // outage, credentials) says nothing about the message, so it decides nothing.
    return code.includes("invalid-argument") || code.includes("invalid-payload") ? "refused" : "unknown";
}
//# sourceMappingURL=pushTokens.js.map