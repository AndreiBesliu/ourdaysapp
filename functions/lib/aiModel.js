"use strict";
// functions/src/aiModel.ts
//
// Which model the app pays for, and what it costs. ONE module for both, so the price the ledger
// charges can never be looked up under a name the calls do not use.
//
// Pure: no imports, so the app's own suite checks it (functionsPurity.test.ts). The ledger prices a
// row ONCE, when it is written, and never again — so a wrong or missing price here is not a display
// bug, it is history.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_MODEL_PRICING = exports.MODEL_PRICING = exports.AI_MODEL = void 0;
exports.priceUsd = priceUsd;
/**
 * The model every AI feature calls. Claude Opus 5.5, chosen by Andrei on 26.09.2026 ("Putem folosi
 * Opus 5.5, inteleg ca e mai ieftin ca 5") when the app moved from Gemini to Claude.
 */
exports.AI_MODEL = "claude-opus-5-5";
/**
 * USD per MILLION tokens, Anthropic first-party rates (the claude-api reference, 26.09.2026).
 *
 * Opus 5.5 is the model we ask for. The others are here because a server-side FALLBACK can serve a
 * request on another model when Opus 5.5's classifiers decline it (claude.ts), and that turn is
 * billed at the model that actually ran — the ledger prices by the response's `model` when it
 * knows it. The Gemini rows price nothing new; they name what the older rows were charged at.
 */
exports.MODEL_PRICING = {
    "claude-opus-5-5": { inPerM: 4, outPerM: 20 },
    "claude-opus-5": { inPerM: 5, outPerM: 25 },
    "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
    "claude-sonnet-5": { inPerM: 2, outPerM: 10 },
    "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
    "gemini-2.5-flash-lite": { inPerM: 0.10, outPerM: 0.40 },
    "gemini-2.5-flash": { inPerM: 0.30, outPerM: 2.50 },
    "gemini-3.8-flash": { inPerM: 0.75, outPerM: 3.75 },
};
/**
 * An UNKNOWN model is priced at the dearest rate in the table, not the cheapest. It used to fall
 * back to Gemini 2.5 Flash ($0.30 / $2.50): a Claude id missing from this table would have been
 * charged up to ten times too little, in the hold and in every row, with no error anywhere.
 * Over-charging is recoverable; the budget still bounds it. Under-charging is not.
 */
exports.UNKNOWN_MODEL_PRICING = Object.values(exports.MODEL_PRICING).reduce((worst, p) => ({ inPerM: Math.max(worst.inPerM, p.inPerM), outPerM: Math.max(worst.outPerM, p.outPerM) }), { inPerM: 0, outPerM: 0 });
function priceUsd(model, inTokens, outTokens) {
    const p = exports.MODEL_PRICING[model] || exports.UNKNOWN_MODEL_PRICING;
    return (inTokens / 1000000) * p.inPerM + (outTokens / 1000000) * p.outPerM;
}
//# sourceMappingURL=aiModel.js.map