// src/utils/expenseAmount.ts
//
// What an expense amount may be, stated once for the client and pinned to the rule.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────
//
// The rules checked who paid and who it was split among, and never the amount. The wallet renders
// `exp.amount.toFixed(2)`, so ONE expense whose amount was a string, null or missing — written from
// the console by any member of the group — threw inside everybody's Wallet and put it on the
// ErrorBoundary. For every member, until somebody deleted the row by hand. And the form itself
// wrote `parseFloat(amount)` unchecked: `-5` was accepted and ran every balance backwards, and
// "1e400" became Infinity.
//
// Now: the rule refuses anything but a finite number in (0, EXPENSE_AMOUNT_MAX); the form refuses
// the same thing BEFORE sending, with a message that says so; and every place that renders an
// amount goes through `formatAmount`, so a bad row that predates the rule shows a dash instead of
// taking the screen down.

/**
 * Exclusive ceiling. Generous on purpose — a family may well log a car or a flat — because its
 * job is to stop absurd values, not to judge large ones. `expenseAmount.test.ts` reads the literal
 * in `firestore.rules` and fails if the two drift.
 */
export const EXPENSE_AMOUNT_MAX = 10_000_000;

/** A valid amount, rounded to cents, or null when the input is not one. */
export function parseExpenseAmount(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim().replace(',', '.') : raw;
  const n = typeof text === 'number' ? text : typeof text === 'string' && text !== '' ? Number(text) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= EXPENSE_AMOUNT_MAX) return null;
  const cents = Math.round(n * 100) / 100;
  // A positive amount that rounds to nothing is not an expense. And the ceiling is checked AFTER
  // rounding too: 9999999.999 is under it, rounds to exactly 10000000, and the rule refuses that —
  // so the form sent a value it had approved and got a bare permission error back. Found by the
  // pre-deploy review of 24.09.2026.
  return cents > 0 && cents < EXPENSE_AMOUNT_MAX ? cents : null;
}

/** "12.50", or a dash for anything that is not a finite number. Never throws. */
export function formatAmount(v: unknown): string {
  // Numbers, and numeric strings a legacy row might carry. Not `Number(v)` on anything at all:
  // `Number(null)`, `Number('')` and `Number([])` are all 0, and a broken row would read as free.
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
