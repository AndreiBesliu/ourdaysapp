"use strict";
// functions/src/aiResponse.ts
//
// Reading a Claude reply (the Anthropic Messages API `Message`), without trusting any of it.
//
// Separate from aiLedger for one concrete reason: aiLedger imports firebase-admin and
// firebase-functions, and CI installs only the repo root. A test in src/ that reached into a module
// with a bare package import would pass here and fail there. These functions are the part worth
// testing and they need nothing, so they live where a test can reach them — duck-typed, never
// `instanceof` an SDK class. See src/utils/functionsPurity.test.ts, which enforces exactly that.
//
// Until 26.09.2026 this read the Gemini shapes. Left as they were, every Claude reply would have
// read as zero tokens and empty text: the ledger pricing each call at $0 and refunding every hold,
// and every feature answering "nothing" while each call was still billed. So the reader returns
// `null` for a shape it does not recognise, and the ledger keeps the pessimistic hold instead of a
// zero (aiLedger.withLedger).
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageOf = usageOf;
exports.textOf = textOf;
exports.stopReasonOf = stopReasonOf;
exports.unfinishedReason = unfinishedReason;
exports.jsonOf = jsonOf;
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isObj = (v) => !!v && typeof v === "object";
/**
 * Tokens billed for a reply, or null when the reply is not a shape we can read.
 *
 * Input is everything the API counted as input: uncached, cache writes and cache reads. The app does
 * not cache (its prompts are below the minimum cacheable size), and counting both at the full input
 * rate errs expensive for reads and cheap by a quarter for writes — noted, and harmless while both
 * are zero. Output is `output_tokens`, which INCLUDES thinking: Opus 5.5 always thinks, and billing
 * only the visible text would be the mistake the Gemini reader once made with `thoughtsTokenCount`.
 */
function usageOf(result) {
    if (!isObj(result) || !isObj(result.usage))
        return null;
    const u = result.usage;
    if (typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number")
        return null;
    const inOf = (x) => num(x.input_tokens) + num(x.cache_creation_input_tokens) + num(x.cache_read_input_tokens);
    const usage = { promptTokens: inOf(u), completionTokens: num(u.output_tokens) };
    if (typeof result.model === "string" && result.model)
        usage.model = result.model;
    const attempts = (Array.isArray(u.iterations) ? u.iterations : [])
        .filter((it) => isObj(it) && (it.type === "message" || it.type === "fallback_message"))
        .map((it) => ({
        model: typeof it.model === "string" && it.model ? it.model : null,
        promptTokens: inOf(it),
        completionTokens: num(it.output_tokens),
    }));
    if (attempts.length > 0) {
        usage.attempts = attempts;
        usage.promptTokens = attempts.reduce((s, a) => s + a.promptTokens, 0);
        usage.completionTokens = attempts.reduce((s, a) => s + a.completionTokens, 0);
    }
    return usage;
}
/** The visible text of a reply: every `text` block, in order. Thinking blocks are not text. */
function textOf(result) {
    if (!isObj(result) || !Array.isArray(result.content))
        return "";
    return result.content
        .filter((b) => isObj(b) && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
}
/**
 * Why the model stopped. Only "end_turn" is a finished answer: "max_tokens" is cut off (a JSON reply
 * cut off does not parse), and "refusal" comes back as HTTP 200 with no answer at all.
 */
function stopReasonOf(result) {
    return isObj(result) && typeof result.stop_reason === "string" ? result.stop_reason : null;
}
/**
 * The ledger's word for a reply that was billed but is not an answer, or null for a finished one.
 * Stable text: it lands in `aiLedger.errorCode` next to the provider's HTTP codes.
 */
function unfinishedReason(result) {
    const stop = stopReasonOf(result);
    if (stop === "end_turn")
        return null;
    if (stop === "refusal")
        return "refusal";
    if (stop === "max_tokens")
        return "max-tokens";
    return stop ? `stop-${stop}`.slice(0, 60) : "stop-unknown";
}
/**
 * A structured-output reply, parsed. With `output_config.format` the text of a finished reply IS
 * valid JSON for the schema; anything else (unfinished, refused, unparseable) is `null`, and each
 * caller decides what "no answer" means for its feature.
 */
function jsonOf(result) {
    if (unfinishedReason(result) !== null)
        return null;
    try {
        return JSON.parse(textOf(result));
    }
    catch (_a) {
        return null;
    }
}
//# sourceMappingURL=aiResponse.js.map