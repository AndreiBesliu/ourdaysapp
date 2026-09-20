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

/** The three refusals the server states explicitly, mapped to keys that exist in all six languages. */
const CODES: ReadonlyArray<readonly [string, string]> = [
  ['ai-budget/user-budget', 'aiBudgetUser'],
  ['ai-budget/global-budget', 'aiBudgetGlobal'],
  ['ai-budget/kill-switch', 'aiBudgetOff'],
];

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
