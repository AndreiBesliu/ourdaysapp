"use strict";
// functions/src/aiResponse.ts
//
// Reading a model reply, in whichever SDK produced it.
//
// Separate from aiLedger for one concrete reason: aiLedger imports firebase-admin and
// firebase-functions, and CI installs only the repo root. A test in src/ that reached into a module
// with a bare package import would pass here and fail there. These two functions are the part worth
// testing and they need nothing, so they live where a test can reach them.
//
// See src/utils/functionsPurity.test.ts, which enforces exactly that.
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageOf = usageOf;
exports.textOf = textOf;
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
/**
 * Where the usage numbers sit, in either SDK.
 *
 * The retired `@google/generative-ai` put them under `result.response.usageMetadata`; the current
 * `@google/genai` puts them on the result itself. Both are accepted rather than one being chosen,
 * because the failure here is silent: a shape that does not match yields zeros, and zeros are a
 * perfectly plausible-looking ledger row. Nothing would ever say the cost column had stopped
 * meaning anything.
 */
function usageMeta(result) {
    var _a;
    const r = result;
    return (r === null || r === void 0 ? void 0 : r.usageMetadata) || ((_a = r === null || r === void 0 ? void 0 : r.response) === null || _a === void 0 ? void 0 : _a.usageMetadata);
}
/** Pull usage out of whatever shape the SDK returned, without trusting any of it. */
function usageOf(result) {
    const meta = usageMeta(result);
    return {
        promptTokens: num(meta === null || meta === void 0 ? void 0 : meta.promptTokenCount),
        // Thinking tokens are OUTPUT tokens and are charged as such. Gemini 3 models reason before
        // answering and report that separately, so counting only `candidatesTokenCount` would have
        // billed a fraction of the real output and reported a cost that was simply wrong — quietly,
        // and in the direction nobody checks.
        completionTokens: num(meta === null || meta === void 0 ? void 0 : meta.candidatesTokenCount) + num(meta === null || meta === void 0 ? void 0 : meta.thoughtsTokenCount),
    };
}
/**
 * The text of a reply, in either SDK.
 *
 * The old one exposed `result.response.text()` — a method. The new one exposes `result.text`, a
 * getter that can be `undefined` when the model returns no text part at all (a refusal, a stop on
 * safety). Callers used to do `.text().trim()` straight away, which on the new shape throws
 * "text is not a function", and on an empty reply would throw on undefined.
 */
function textOf(result) {
    var _a;
    const r = result;
    if (typeof (r === null || r === void 0 ? void 0 : r.text) === "string")
        return r.text;
    const legacy = (_a = r === null || r === void 0 ? void 0 : r.response) === null || _a === void 0 ? void 0 : _a.text;
    if (typeof legacy === "function") {
        try {
            const out = legacy.call(r.response);
            return typeof out === "string" ? out : "";
        }
        catch (_b) {
            return "";
        }
    }
    return typeof legacy === "string" ? legacy : "";
}
//# sourceMappingURL=aiResponse.js.map