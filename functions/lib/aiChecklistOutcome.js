"use strict";
// functions/src/aiChecklistOutcome.ts
//
// Why an event that asked the AI for a checklist and got nothing must SAY so.
//
// ── The shape of the bug ──────────────────────────────────────────────────────────────────
//
// `autoSuggestChecklist` is an `onDocumentCreated` trigger, and that fires ONCE per document. So
// every way it can end badly is permanent: there is no second attempt, ever, for that event.
//
// It had two endings, and both lied.
//
//   STRIP — the catch path and the non-array path removed `ai_assistant` from the assignees. The
//     screen shows a "generating checklist…" skeleton exactly while that id is present, so the
//     skeleton vanished and an empty checklist was left behind. Indistinguishable from the AI
//     having looked and decided there was nothing to add.
//
//   STICK — the daily-quota path and the missing-key path returned without touching anything. The
//     id stayed, so the skeleton span FOREVER: every time anybody opened that event, for the rest
//     of the event's life, it claimed a checklist was being generated. Nothing was.
//
// Neither told the owner that their fifty daily calls were spent, or that the kill switch was
// down, or that the model answered with something unusable. And because the trigger cannot fire
// twice, "create the event again" was the only remedy — which nobody could have guessed.
//
// ── What replaces them ────────────────────────────────────────────────────────────────────
//
// One ending. Every failure throws, one place catches, and it writes a REASON onto the event:
// `aiChecklist: { status: "failed", reason, at }`. The screen reads that reason, says it in the
// reader's language, and offers Retry — which goes through `generateAIChecklist`, the callable
// that already exists, so the retry faces the same auth, quota and budget the trigger faced.
// That is the retry story: not the trigger running again (it cannot), but the person choosing to.
//
// `ai_assistant` is still removed in every case. Leaving it would be the STICK ending again, and
// an assignee advertising work that can never run is the thing this file exists to stop.
//
// Pure: no imports outside this folder's own pure module, so the app's suite tests it.
// See `functionsPurity.test.ts`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKLIST_REASONS = exports.CHECKLIST_ERROR = exports.CHECKLIST_BUSY = exports.CHECKLIST_BAD_OUTPUT = exports.CHECKLIST_UNCONFIGURED = exports.CHECKLIST_QUOTA = void 0;
exports.checklistFailure = checklistFailure;
exports.checklistReason = checklistReason;
exports.refundsQuota = refundsQuota;
exports.worthRetrying = worthRetrying;
const aiProviderError_1 = require("./aiProviderError");
/** The owner's shared daily AI allowance was already spent when the event was created. */
exports.CHECKLIST_QUOTA = "ai-checklist/quota";
/** No API key on the service: the feature is off, and no amount of retrying changes that. */
exports.CHECKLIST_UNCONFIGURED = "ai-checklist/unconfigured";
/** The model answered, but not with a list of items. Paid for, and unusable. */
exports.CHECKLIST_BAD_OUTPUT = "ai-checklist/bad-output";
/**
 * The provider rationed us.
 *
 * Its own code, NOT an alias of the callables' `AI_QUOTA_CODE`, though they come from the same
 * predicate. Aliasing them was my first attempt at fixing the contradiction below and it was
 * wrong: `AI_QUOTA_CODE` is an `ai-budget/` code, so `refundsQuota` would have started returning
 * true for it — a silent change to who gets charged, smuggled inside a wording fix. The ledger and
 * the health panel also want to know WHICH limit it was.
 *
 * What did need fixing is what the PERSON reads. The card used to say "the AI was busy, try again
 * in a minute" while pressing Retry — which runs the callable — said "the app has reached today's
 * AI limit, try again tomorrow". Same condition, same screen, one minute apart. The callables are
 * the ones telling the truth: the dominant cause of this predicate firing is the project's
 * free-tier allowance for the DAY being spent, which put 74 of 95 rows in the health panel. So the
 * sentence behind this code now says the same thing as theirs; only the code stays distinct.
 */
exports.CHECKLIST_BUSY = "ai-checklist/provider";
/** Anything else. Deliberately the fallback, never the guess. */
exports.CHECKLIST_ERROR = "ai-checklist/error";
/**
 * The budget refusals this app makes on purpose, as thrown by `aiLedger`'s `refuse()`.
 *
 * Listed EXPLICITLY rather than pattern-matched out of the message. A reason code travels to the
 * screen and is turned into a sentence in six languages; a code nobody has translated would be
 * shown to somebody's family as raw ASCII. So an `ai-budget/` code that is not one of these three
 * is reported as the generic failure — the loss is a less precise sentence, and the alternative
 * is a worse one.
 */
const BUDGET_CODES = [
    "ai-budget/kill-switch",
    "ai-budget/user-budget",
    "ai-budget/global-budget",
];
/** Every reason this module can produce, for the screen and for its test. */
exports.CHECKLIST_REASONS = [
    ...BUDGET_CODES,
    exports.CHECKLIST_QUOTA,
    exports.CHECKLIST_UNCONFIGURED,
    exports.CHECKLIST_BAD_OUTPUT,
    exports.CHECKLIST_BUSY,
    exports.CHECKLIST_ERROR,
];
/**
 * A stop WE decided on, carrying the reason the screen will show.
 *
 * A labelled field rather than a subclass: `instanceof` across a compiled `extends Error` is not
 * something to rely on, and the check here has to work on an error that crossed a module boundary.
 */
function checklistFailure(reason) {
    const err = new Error(reason);
    err.checklistReason = reason;
    return err;
}
/**
 * Which reason to record for a failure.
 *
 * Order matters: our own label wins over anything inferred, because it was stated rather than
 * guessed. A budget refusal is named exactly — "you have spent your daily budget" and "the AI is
 * switched off" are different facts and the person can act on only one of them.
 */
function checklistReason(err) {
    var _a;
    const labelled = err === null || err === void 0 ? void 0 : err.checklistReason;
    if (typeof labelled === "string" && exports.CHECKLIST_REASONS.includes(labelled))
        return labelled;
    if ((0, aiProviderError_1.isOwnBudgetRefusal)(err)) {
        const message = String((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : "");
        const hit = BUDGET_CODES.find((code) => message.includes(code));
        return hit || exports.CHECKLIST_ERROR;
    }
    if ((0, aiProviderError_1.isProviderQuotaError)(err))
        return exports.CHECKLIST_BUSY;
    return exports.CHECKLIST_ERROR;
}
/**
 * Does this reason mean the owner was charged one of their fifty for nothing?
 *
 * The trigger consumes a quota unit at the door, before anything else — the same order the
 * callables use, and the same consequence: a call that never reached the model must not cost
 * anything. Fixed at the four callable sites already; the trigger was the fifth, because it does
 * not throw to a caller and so had no refusal branch at all.
 *
 * `unconfigured` belongs here for exactly the same reason, and was missed because it is not an
 * `ai-budget/` code. There is no API key on the service, and the check is the FIRST statement of
 * the generation — strictly after the unit was taken. So every event created while the key is
 * missing quietly spent one of the owner's fifty on a call that provably never happened, and a
 * misconfiguration nobody can see from the app would eat the day's allowance for free.
 *
 * `quota` is deliberately absent: `tryConsumeQuota` returning false means nothing was consumed,
 * and refunding there would hand back an allowance nobody spent.
 */
function refundsQuota(reason) {
    return BUDGET_CODES.includes(reason)
        || reason === exports.CHECKLIST_UNCONFIGURED;
}
/**
 * Is retrying worth offering?
 *
 * `unconfigured` means there is no key on the service. Offering a button that cannot work — and
 * that spends one of the fifty finding out — is worse than saying so plainly.
 */
function worthRetrying(reason) {
    return reason !== exports.CHECKLIST_UNCONFIGURED;
}
//# sourceMappingURL=aiChecklistOutcome.js.map