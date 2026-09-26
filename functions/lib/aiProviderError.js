"use strict";
// functions/src/aiProviderError.ts
// Telling "the provider said not today" apart from "something is broken".
//
// ── Why this matters more than it looks ──────────────────────────────────────────────
//
// On 2026-09-14 the admin health log held about ninety-five rows, and seventy-four of them were one
// thing: Gemini refusing a call because the project's free-tier allowance (twenty generateContent
// requests per day) was spent. Every real defect in the application sat below it, because the panel
// sorts by how often something happened and nothing real happens seventy-four times.
//
// A quota refusal is not an application error. No input is wrong, no state is corrupt, there is no
// line of code to change. It is an operating condition, it recurs by construction, and it will
// always out-count genuine bugs — so writing it to the error log does not record a problem, it
// hides the others.
//
// It is not dropped, though: `withLedger` already writes a row per AI call with `ok: false` and an
// error code, carrying the uid, the feature, the model and the cost. That is the ledger designed to
// be counted per call, and it holds strictly more than the error log row did.
//
// ── The other half: what the person sees ─────────────────────────────────────────────
//
// Today, nothing. `src/ai.ts` catches the failure and returns null, so the suggestion chip simply
// never appears and the user concludes nothing matched. That is precisely why seventy-four of these
// accumulated over twelve days without anybody noticing. Where the user ASKED for something, they
// deserve the sentence the app already has in six languages: "The app has reached today's AI limit."
// The server says that by throwing the stable code the client already translates.
//
// Pure: no imports, so the app's own suite tests it. See `functionsPurity.test.ts`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_BUSY_CODE = exports.AI_QUOTA_CODE = void 0;
exports.isProviderQuotaError = isProviderQuotaError;
exports.isProviderBusy = isProviderBusy;
exports.isProviderOutOfCredit = isProviderOutOfCredit;
exports.isOwnBudgetRefusal = isOwnBudgetRefusal;
exports.providerErrorCode = providerErrorCode;
/** The code the client turns into a translated sentence. Must match `aiErrorMessage` in src/ai.ts. */
exports.AI_QUOTA_CODE = "ai-budget/global-budget";
/**
 * The provider is busy for a MINUTE, not out for the day (26.09.2026). Under Gemini the dominant
 * provider refusal was the free tier's daily allowance, so it was told as "try again tomorrow";
 * Claude's 429 is a per-minute limit and its 529 a momentary overload. Its own sentence in six
 * languages (`aiBusy`), and the person's daily unit is given back — nothing was generated.
 */
exports.AI_BUSY_CODE = "ai-budget/provider-busy";
/**
 * Did the AI provider refuse this call for capacity, rate or billing reasons?
 *
 * Deliberately narrow: these are OPERATING CONDITIONS — nobody's input is wrong and there is no line
 * of code to change — and each one recurs by construction, so writing them to the error log hides
 * every real defect under them. The ledger still records each one (`http-429`, `http-529`, ...).
 *
 * Since 26.09.2026 the provider is Anthropic (Claude), whose SDK errors carry a numeric `status` and
 * an error `type`:
 *   * 429 `rate_limit_error` — a per-minute limit, not a daily one;
 *   * 529 `overloaded_error` — the API is briefly overloaded (the Gemini-era rule kept a 503 out of
 *     here as "somebody should look"; a 529 is Anthropic's documented capacity signal, and there is
 *     nothing for anybody to fix);
 *   * 402 `billing_error`, and a 400 whose message says the credit balance is too low — the account
 *     is out of credit. That one IS for somebody: the owner. The ledger row and the admin AI panel
 *     are where he looks; a row per failed call in the health log would bury everything else.
 * A 400 for any other reason, a 401/403 (authentication — the federation setup), a 404 (a wrong
 * model id) and our own bugs all stay OUT, so they reach the error log.
 */
function isProviderQuotaError(err) {
    return isProviderBusy(err) || isProviderOutOfCredit(err);
}
/** 429 `rate_limit_error` or 529 `overloaded_error`: capacity, for a minute. */
function isProviderBusy(err) {
    if (!err || typeof err !== "object")
        return false;
    const e = err;
    return e.status === 429 || e.status === 529
        || e.type === "rate_limit_error" || e.type === "overloaded_error";
}
/** 402 `billing_error`, or a 400 saying the credit balance is too low: the account needs topping up. */
function isProviderOutOfCredit(err) {
    if (!err || typeof err !== "object")
        return false;
    const e = err;
    if (e.status === 402 || e.type === "billing_error")
        return true;
    const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
    return !!message && message.includes("credit balance is too low");
}
/**
 * OUR OWN refusal, not the provider's.
 *
 * `holdBudget` throws `HttpsError("resource-exhausted", "ai-budget/...")`. That is a decision this
 * app made on purpose, and it must never reach `errorLogs`.
 *
 * `isProviderQuotaError` does not catch it and should not be widened to: the code lives on
 * `.code` as the STRING "resource-exhausted", while that predicate reads `.message` and looks for
 * "resource_exhausted" with an underscore. Two different spellings of two different things.
 *
 * Why it matters more now: the kill switch used to need a redeploy, so refusals were rare. Making
 * it pressable makes them common — and they arrive in BURSTS, because whatever causes one causes
 * it for everybody at once. The comment above each call site records that provider-quota rows were
 * removed from the health panel because seventy-four of ninety-five rows were one thing and every
 * real bug sat underneath it. Pressing the emergency brake must not blind the panel during the
 * incident you pressed it for.
 */
function isOwnBudgetRefusal(err) {
    const message = typeof (err === null || err === void 0 ? void 0 : err.message) === "string"
        ? (err.message)
        : "";
    return message.startsWith("ai-budget/") || message.includes(" ai-budget/");
}
/**
 * A short, stable label for the ledger's `errorCode`.
 *
 * The old expression read `err.code`, then fell back to `err.name` — and since the Gemini SDK sets
 * neither, every HTTP failure it ever raised was recorded as the single string
 * "GoogleGenerativeAIFetchError". A ledger that cannot tell a quota refusal from a bad request
 * cannot answer the one question it exists for.
 */
function providerErrorCode(err) {
    var _a;
    if (!err || typeof err !== "object")
        return "error";
    const e = err;
    if (typeof e.status === "number")
        return `http-${e.status}`;
    // The federation token exchange fails with a `statusCode`, not a `status` (the SDK's
    // WorkloadIdentityError): a rule or account that does not match reads `federation-http-401`.
    if (typeof e.statusCode === "number")
        return `federation-http-${e.statusCode}`;
    if (typeof e.code === "string" && e.code)
        return e.code;
    if (typeof e.code === "number")
        return `http-${e.code}`;
    // The SDK's errors never set `name`, so every connection, timeout, abort and metadata failure
    // read as the one word "Error". The class says which.
    const ctor = (_a = err.constructor) === null || _a === void 0 ? void 0 : _a.name;
    if (e.name === "Error" && typeof ctor === "string" && ctor && ctor !== "Error" && ctor !== "Object")
        return ctor;
    if (typeof e.name === "string" && e.name)
        return e.name;
    return "error";
}
//# sourceMappingURL=aiProviderError.js.map