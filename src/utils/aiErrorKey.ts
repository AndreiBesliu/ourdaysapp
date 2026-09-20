// src/utils/aiErrorKey.ts
//
// Which refusal the server sent, as an i18n key — or null when we do not recognise it.
//
// ── Why it is here and not in `ai.ts` ─────────────────────────────────────────────────────
//
// `ai.ts` imports `firebase/functions` and the initialised app, so nothing in it can be reached by
// a test: importing it would boot Firebase. That is the same shape as `aiLedger`/`aiLimits` on the
// server, and the same consequence — the rule with no home for its test is the rule with no test.
//
// ── What it is for ────────────────────────────────────────────────────────────────────────
//
// The server refuses a paid AI call with a STABLE CODE and never with a sentence: the six
// languages are the client's job. `aiErrorMessage` used to fold the code straight into a
// translated string, which left callers unable to tell a recognised refusal from a raw provider
// error — both came back as `string`. So the chat widget discarded the whole thing and rendered
// "the summary could not be generated", and somebody who had simply spent their daily AI budget
// pressed the button again, and again, and was never told why.
//
// The codes come from `functions/src/aiLedger.ts`, where `refuse()` throws them.

/**
 * Every code the server states explicitly, mapped to a key that exists in all six languages.
 *
 * The `ai-budget/` three come back from a REFUSED CALL, thrown at the moment it happens. The
 * `ai-checklist/` five are read off a DOCUMENT: `autoSuggestChecklist` is an `onDocumentCreated`
 * trigger, it fires once, and when it ends badly it writes the reason onto the event rather than
 * leaving an empty checklist and no explanation. Different moment, same question — which of our
 * own decisions stopped this — so it is deliberately the same table. Two tables would be two
 * places to forget a language.
 *
 * `ai-budget/` codes appear in BOTH paths: a trigger refused by the budget stores the same code
 * the callable throws, and gets the same sentence.
 */
const CODES: ReadonlyArray<readonly [string, string]> = [
  ['ai-budget/user-budget', 'aiBudgetUser'],
  ['ai-budget/global-budget', 'aiBudgetGlobal'],
  ['ai-budget/kill-switch', 'aiBudgetOff'],
  ['ai-checklist/quota', 'aiChecklistQuota'],
  ['ai-checklist/unconfigured', 'aiChecklistUnavailable'],
  ['ai-checklist/bad-output', 'aiChecklistBadOutput'],
  ['ai-checklist/provider', 'aiChecklistBusy'],
  ['ai-checklist/error', 'aiChecklistFailed'],
];

/** A reason code stored on an event is always shown, so this one never returns null. */
export function checklistReasonKey(reason: unknown): string {
  return aiErrorKey(reason) || 'aiChecklistFailed';
}

/**
 * Whether to offer the Retry button.
 *
 * `unconfigured` means there is no API key on the service. A button that cannot work, and that
 * spends one of the person's fifty daily calls finding out, is worse than the plain sentence.
 * Mirrors `worthRetrying` in `functions/src/aiChecklistOutcome.ts`, which the trigger uses.
 */
export function checklistWorthRetrying(reason: unknown): boolean {
  return String(reason || '') !== 'ai-checklist/unconfigured';
}

/**
 * `null` for anything unrecognised, deliberately.
 *
 * The alternative — falling back to the provider's own message — puts a raw English string, often
 * a URL or an HTTP code, in front of somebody's family. The caller renders its own generic
 * sentence instead, and the real text goes to the error log where it is useful.
 */
export function aiErrorKey(error: unknown): string | null {
  const raw = typeof error === 'string'
    ? error
    : String((error as { message?: unknown } | null | undefined)?.message ?? '');
  if (!raw) return null;
  for (const [code, key] of CODES) if (raw.includes(code)) return key;
  return null;
}
