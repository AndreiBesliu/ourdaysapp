// src/utils/ledger.ts
//
// Who owes what, in a shared ledger.
//
// Pulled out of ExpensesTab so it can be RUN. It was eleven lines inside a component behind a
// login, and the defect below survived in it for months precisely because nothing could execute
// it without a browser and an account.
//
// ── The defect ───────────────────────────────────────────────────────────────────────────────
//
// The divisor was the group's CURRENT member list, while the total was every expense ever filed
// in that ledger. Those two disagree the moment somebody leaves:
//
//   Ana, Bogdan and Cristina share a ledger. Cristina pays 300 for groceries. Cristina leaves.
//   Total is still 300, because her expense is untouched; the divisor is now 2.
//   Ana is shown -150, Bogdan -150, and NOBODY is in credit. The columns sum to -300.
//
// Cristina is owed 300 and does not appear at all. The number is wrong, silently, permanently, and
// it is the number people settle up on.
//
// This codebase already knew: `functions/src/index.ts` deletes a departing user's expenses on
// ACCOUNT DELETION, and the comment there spells out this exact arithmetic. The other two ways to
// leave a group — leaving, and being removed — never got the same treatment.
//
// ── The fix, and what it deliberately does NOT do ────────────────────────────────────────────
//
// Everyone who PAID into a ledger is part of that ledger, whether or not they are still in the
// group. That restores the invariant the screen implicitly promises — the balances sum to zero —
// without deleting anybody's record of having paid.
//
// It does NOT decide who a cost should have been split among. A member who joins today still
// shares expenses from before they arrived, because nothing on the document records who was
// present when it was recorded. That needs a field (`splitAmong`) and a decision about what it
// should mean, and it is flagged rather than guessed at.

export interface LedgerExpense {
  groupId?: string | null;
  paidBy?: string;
  amount?: unknown;
}

export interface Ledger {
  /** Everyone the balances are computed over: current members plus anyone who paid. */
  participants: string[];
  /** What each person put in. */
  paid: Record<string, number>;
  /** The total, divided by the number of participants. */
  share: number;
  total: number;
  /** How many expenses it was built from. */
  count: number;
  /** Participants who paid in but are no longer in the group. */
  departed: string[];
}

/** A number that is actually a number. Amount is a client-written field no rule type-checks. */
function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build one group's ledger.
 *
 * `members` is the group as it stands now; `expenses` is every expense filed against it.
 */
export function ledgerFor(members: readonly string[], expenses: readonly LedgerExpense[]): Ledger {
  const paid: Record<string, number> = {};
  for (const e of expenses) {
    const who = typeof e.paidBy === 'string' ? e.paidBy : '';
    if (!who) continue;
    paid[who] = (paid[who] || 0) + money(e.amount);
  }

  const current = members.filter((m) => typeof m === 'string' && m);
  // Order matters only for the screen: current members first, in the group's own order, then
  // anyone who has left, so the familiar names stay where they were.
  const departed = Object.keys(paid).filter((uid) => !current.includes(uid));
  const participants = [...current, ...departed];

  const total = Object.values(paid).reduce((a, b) => a + b, 0);
  const share = participants.length > 0 ? total / participants.length : 0;

  return { participants, paid, share, total, count: expenses.length, departed };
}

/** What one person is owed (positive) or owes (negative). */
export function balanceOf(ledger: Ledger, uid: string): number {
  return (ledger.paid[uid] || 0) - ledger.share;
}

/**
 * The balances of everyone in the ledger, as displayed.
 *
 * Rounded to the cent HERE rather than at each call site, because the thing worth checking is
 * that the ROUNDED figures still sum to zero — an invariant that holds for the true values by
 * construction and can be lost by rounding each one separately.
 */
export function displayedBalances(ledger: Ledger): { uid: string; balance: number }[] {
  const raw = ledger.participants.map((uid) => ({ uid, balance: balanceOf(ledger, uid) }));
  const rounded = raw.map((r) => ({ uid: r.uid, balance: Math.round(r.balance * 100) / 100 }));

  // The residue from rounding goes to whoever owes the MOST, so the column adds up on screen.
  // With three people and 10.00 the true shares are 3.333…, and three separately rounded balances
  // sum to a cent that is not there; the person reading it is entitled to ask where it went.
  //
  // On the debtor rather than the creditor, deliberately: the person who laid the money out is
  // made whole to the nearest cent and somebody who owes pays the odd one. Putting it on the
  // creditor instead would show them a penny less than they are owed, which is the one direction
  // that feels like a mistake rather than a rounding.
  const sum = rounded.reduce((a, r) => a + r.balance, 0);
  const residue = Math.round(-sum * 100) / 100;
  if (residue !== 0 && rounded.length > 0) {
    let at = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i].balance < rounded[at].balance) at = i;
    rounded[at] = { uid: rounded[at].uid, balance: Math.round((rounded[at].balance + residue) * 100) / 100 };
  }
  return rounded;
}

/**
 * Whether a balance should read as settled.
 *
 * The old screen coloured on `> 0.005` but printed with toFixed(2), so a balance of -0.004 was
 * painted as settled and printed as "-0.00" — a minus sign in front of nothing.
 */
export function isSettled(balance: number): boolean {
  return Math.abs(balance) < 0.005;
}
