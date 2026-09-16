// src/utils/ledger.ts
//
// Who owes what, in a shared ledger.
//
// Pulled out of ExpensesTab so it can be RUN. It was eleven lines inside a component behind a
// login, and two defects survived in it for months precisely because nothing could execute it
// without a browser and an account.
//
// ── Defect one: the divisor and the total disagreed ──────────────────────────────────────────
//
// The divisor was the group's CURRENT member list while the total was every expense ever filed.
//
//   Ana, Bogdan and Cristina share a ledger. Cristina pays 300 for groceries. Cristina leaves.
//   Total is still 300, because her expense is untouched; the divisor is now 2.
//   Ana is shown -150, Bogdan -150, and NOBODY is in credit. The columns sum to -300.
//
// Cristina is owed 300 and does not appear at all. Silent, permanent, and it is the number people
// settle up on. Everyone who PAID into a ledger is part of it now, whether or not they are still
// in the group — that restores what the screen implicitly promises, without deleting anybody's
// record of having paid.
//
// ── Defect two: the past was re-split whenever the group changed ─────────────────────────────
//
// Splitting every expense by today's membership meant somebody who joined on Friday shared
// Tuesday's dinner, and somebody leaving made everyone else's debts grow. Andrei's call,
// 16.09.2026: "fiecare cheltuiala sa-si retina participantii" — each expense remembers who it was
// split among, in `splitAmong`, written when it is recorded.
//
// So the split is now PER EXPENSE. That also makes the zero-sum invariant structural rather than
// lucky: every expense distributes its whole amount among its own participants, so what is paid
// and what is owed are the same number by construction.
//
// Expenses written before that field existed have none, and fall back to the group-wide set —
// which is exactly the behaviour they have had all along, so nothing anybody has already looked at
// moves under them.

export interface LedgerExpense {
  groupId?: string | null;
  paidBy?: string;
  amount?: unknown;
  /** Who this expense was split among, as recorded when it was filed. Absent on older rows. */
  splitAmong?: unknown;
}

export interface Ledger {
  /** Everyone the balances are shown for: current members, anyone who paid, anyone named in a split. */
  participants: string[];
  /** What each person put in. */
  paid: Record<string, number>;
  /** What each person's share of everything comes to. */
  owed: Record<string, number>;
  total: number;
  /** How many expenses it was built from. */
  count: number;
  /** Participants who are no longer in the group. */
  departed: string[];
}

/** A number that is actually a number. `amount` is client-written and no rule type-checks it. */
function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The recorded participant list, or null when there is not a usable one. */
function recordedSplit(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const people = value.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return people.length ? [...new Set(people)] : null;
}

/**
 * Build one group's ledger.
 *
 * `members` is the group as it stands now; `expenses` is every expense filed against it.
 */
export function ledgerFor(members: readonly string[], expenses: readonly LedgerExpense[]): Ledger {
  const current = members.filter((m) => typeof m === 'string' && m);

  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};
  const seen = new Set<string>(current);

  // The set an expense falls back to when it recorded nothing: today's members plus anyone who
  // paid into this ledger. Computed once, over all the expenses, because it is a property of the
  // ledger rather than of any one row.
  const payers = expenses
    .map((e) => (typeof e.paidBy === 'string' ? e.paidBy : ''))
    .filter(Boolean);
  const fallback = [...new Set([...current, ...payers])];

  for (const e of expenses) {
    const who = typeof e.paidBy === 'string' ? e.paidBy : '';
    if (!who) continue; // an expense nobody paid belongs to nobody
    const amount = money(e.amount);
    paid[who] = (paid[who] || 0) + amount;
    seen.add(who);

    const among = recordedSplit(e.splitAmong) ?? fallback;
    if (among.length === 0) continue;
    const each = amount / among.length;
    for (const uid of among) {
      owed[uid] = (owed[uid] || 0) + each;
      seen.add(uid);
    }
  }

  // Current members first, in the group's own order, so the familiar names stay where they were;
  // then anyone who has left or who was only ever named in a split.
  const departed = [...seen].filter((uid) => !current.includes(uid));
  const participants = [...current, ...departed];
  const total = Object.values(paid).reduce((a, b) => a + b, 0);

  return { participants, paid, owed, total, count: expenses.length, departed };
}

/** What one person is owed (positive) or owes (negative). */
export function balanceOf(ledger: Ledger, uid: string): number {
  return (ledger.paid[uid] || 0) - (ledger.owed[uid] || 0);
}

/**
 * The balances of everyone in the ledger, as displayed.
 *
 * Rounded to the cent HERE rather than at each call site, because the thing worth checking is
 * that the ROUNDED figures still sum to zero — an invariant that holds for the true values by
 * construction and can be lost by rounding each one separately.
 */
export function displayedBalances(ledger: Ledger): { uid: string; balance: number }[] {
  const rounded = ledger.participants.map((uid) => ({
    uid,
    balance: Math.round(balanceOf(ledger, uid) * 100) / 100,
  }));

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
// ── Choosing who an expense falls on ─────────────────────────────────────────────────────────
//
// The picker in the form. Recording the whole group automatically was the first half; letting
// somebody say "this one was just me and Bogdan" is the second.

/**
 * The selection to actually use, given the group's members and whatever is ticked.
 *
 * Two things it guards, and both have bitten this app in other forms:
 *   * a name that is no longer in the group — the roster can change while the form is open, and
 *     the rules refuse a split naming somebody outside it, so the write would fail with a message
 *     about a field the person never saw;
 *   * an empty tick list — the rules refuse that too, and dividing a cost by nobody means nothing.
 *     It is reported rather than silently turned back into everyone, because quietly charging the
 *     whole group to a person who has just deselected them all is the opposite of what they asked.
 */
export function usableSplit(
  members: readonly string[],
  selected: readonly string[],
): { split: string[]; ok: boolean } {
  const inGroup = members.filter((m) => typeof m === 'string' && m);
  const split = [...new Set(selected.filter((uid) => inGroup.includes(uid)))];
  return { split, ok: split.length > 0 };
}

/**
 * What a change of group does to the selection: everyone in the new group, ticked.
 *
 * Carrying the old ticks across would either name people who are not in the new group (refused by
 * the rules) or silently narrow the split to whoever happens to be in both.
 */
export function splitForGroup(members: readonly string[]): string[] {
  return members.filter((m) => typeof m === 'string' && m);
}
