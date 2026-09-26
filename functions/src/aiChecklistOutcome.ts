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

import { isOwnBudgetRefusal, isProviderBusy, isProviderOutOfCredit } from "./aiProviderError";

/** The owner's shared daily AI allowance was already spent when the event was created. */
export const CHECKLIST_QUOTA = "ai-checklist/quota";
/** No API key on the service: the feature is off, and no amount of retrying changes that. */
export const CHECKLIST_UNCONFIGURED = "ai-checklist/unconfigured";
/** The model answered, but not with a list of items. Paid for, and unusable. */
export const CHECKLIST_BAD_OUTPUT = "ai-checklist/bad-output";
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
 * AI limit, try again tomorrow". Same condition, same screen, one minute apart. Under Gemini the
 * callables were the ones telling the truth: the dominant cause was the free tier's allowance for
 * the DAY being spent (74 of 95 rows in the health panel), so this code was given their sentence.
 *
 * Under Claude (26.09.2026) it is the other way round. A 429 is a per-minute limit and a 529 a
 * momentary overload, so "busy, try again in a minute" is the truth again, and the callables now
 * say it too (`ai-budget/provider-busy` → `aiBusy`). The same sentence on the card and on Retry is
 * kept; only which sentence changed. An account out of CREDIT is not "busy": the trigger records
 * the callables' "today's AI limit" code for it (`checklistReason`).
 */
export const CHECKLIST_BUSY = "ai-checklist/provider";
/** Anything else. Deliberately the fallback, never the guess. */
export const CHECKLIST_ERROR = "ai-checklist/error";

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
] as const;

/** Every reason this module can produce, for the screen and for its test. */
export const CHECKLIST_REASONS: readonly string[] = [
  ...BUDGET_CODES,
  CHECKLIST_QUOTA,
  CHECKLIST_UNCONFIGURED,
  CHECKLIST_BAD_OUTPUT,
  CHECKLIST_BUSY,
  CHECKLIST_ERROR,
];

type Labelled = Error & { checklistReason: string };

/**
 * A stop WE decided on, carrying the reason the screen will show.
 *
 * A labelled field rather than a subclass: `instanceof` across a compiled `extends Error` is not
 * something to rely on, and the check here has to work on an error that crossed a module boundary.
 */
export function checklistFailure(reason: string): Error {
  const err = new Error(reason) as Labelled;
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
export function checklistReason(err: unknown): string {
  const labelled = (err as Partial<Labelled> | null | undefined)?.checklistReason;
  if (typeof labelled === "string" && CHECKLIST_REASONS.includes(labelled)) return labelled;

  if (isOwnBudgetRefusal(err)) {
    const message = String((err as { message?: unknown } | null | undefined)?.message ?? "");
    const hit = BUDGET_CODES.find((code) => message.includes(code));
    return hit || CHECKLIST_ERROR;
  }

  // Busy is a minute; out of credit is the app's limit, told with the callables' own sentence.
  if (isProviderBusy(err)) return CHECKLIST_BUSY;
  if (isProviderOutOfCredit(err)) return "ai-budget/global-budget";
  return CHECKLIST_ERROR;
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
export function refundsQuota(reason: string): boolean {
  return (BUDGET_CODES as readonly string[]).includes(reason)
    || reason === CHECKLIST_UNCONFIGURED
    // A busy provider generated nothing: the callables give the unit back too (26.09.2026).
    || reason === CHECKLIST_BUSY;
}

/**
 * Is retrying worth offering?
 *
 * `unconfigured` means there is no key on the service. Offering a button that cannot work — and
 * that spends one of the fifty finding out — is worse than saying so plainly.
 */
export function worthRetrying(reason: string): boolean {
  return reason !== CHECKLIST_UNCONFIGURED;
}
