// src/utils/ledger.test.ts
//
// The arithmetic people settle up on.
//
// The scenario in the first block is not invented: a reviewer ran the shipped component with
// react-dom/server and got -150.00 and -150.00 on screen, summing to -300 instead of 0, with
// nobody in credit. This file is that scenario, as something that runs in a second.

import { describe, it, expect } from 'vitest';
import { ledgerFor, balanceOf, displayedBalances, isSettled } from './ledger';

const ANA = 'ana', BOGDAN = 'bogdan', CRISTINA = 'cristina';
const sum = (rows: { balance: number }[]) => Math.round(rows.reduce((a, r) => a + r.balance, 0) * 100) / 100;

describe('the defect: somebody leaves and their money is counted but they are not', () => {
  const groceries = [{ groupId: 'fam', paidBy: CRISTINA, amount: 300 }];

  it('kept everyone whole while all three were in the group', () => {
    const l = ledgerFor([ANA, BOGDAN, CRISTINA], groceries);
    expect(balanceOf(l, ANA)).toBe(-100);
    expect(balanceOf(l, BOGDAN)).toBe(-100);
    expect(balanceOf(l, CRISTINA)).toBe(200);
    expect(sum(displayedBalances(l))).toBe(0);
  });

  it('still keeps them whole after Cristina leaves', () => {
    // Before: the divisor dropped to 2 while her 300 stayed in the total, so Ana and Bogdan were
    // each told they owed 150 and the columns summed to -300. She is owed 200 and was not on the
    // screen at all.
    const l = ledgerFor([ANA, BOGDAN], groceries);
    expect(l.participants).toContain(CRISTINA);
    expect(l.departed).toEqual([CRISTINA]);
    expect(balanceOf(l, ANA)).toBe(-100);
    expect(balanceOf(l, BOGDAN)).toBe(-100);
    expect(balanceOf(l, CRISTINA)).toBe(200);
  });

  it('and the columns sum to zero, which is the whole promise of the screen', () => {
    expect(sum(displayedBalances(ledgerFor([ANA, BOGDAN], groceries)))).toBe(0);
    expect(sum(displayedBalances(ledgerFor([], groceries)))).toBe(0);
  });

  it('does not resurrect somebody who left without ever paying', () => {
    // Only money puts you in the ledger. Somebody who left having paid nothing is owed nothing and
    // owes nothing, and adding them would change everybody else's share for no reason.
    const l = ledgerFor([ANA, BOGDAN], [{ groupId: 'fam', paidBy: ANA, amount: 60 }]);
    expect(l.participants).toEqual([ANA, BOGDAN]);
    expect(l.departed).toEqual([]);
  });
});

describe('the columns add up, even when the money does not divide', () => {
  it('gives the rounding residue to whoever owes most, instead of losing it', () => {
    // 10 between three: the true shares are 3.333…, and three separately rounded balances sum to
    // a cent that is not there. A person reading the screen is entitled to ask where it went.
    const l = ledgerFor([ANA, BOGDAN, CRISTINA], [{ groupId: 'f', paidBy: ANA, amount: 10 }]);
    const rows = displayedBalances(l);
    expect(sum(rows)).toBe(0);
    // Ana laid the money out, so she is made whole to the nearest cent...
    expect(rows.find((r) => r.uid === ANA)!.balance).toBe(6.67);
    // ...and the odd penny falls on one of the two who owe.
    // Numeric sort: the default one compares as TEXT, and "-3.33" sorts before "-3.34".
    const debts = rows.filter((r) => r.uid !== ANA).map((r) => r.balance).sort((a, b) => a - b);
    expect(debts).toEqual([-3.34, -3.33]);
  });

  it('holds for a pile of awkward amounts', () => {
    for (const amounts of [[0.01], [10, 0.03], [33.33, 66.67], [1, 1, 1], [0.1, 0.2]]) {
      const l = ledgerFor([ANA, BOGDAN, CRISTINA], amounts.map((a) => ({ groupId: 'f', paidBy: ANA, amount: a })));
      expect(sum(displayedBalances(l)), amounts.join('+')).toBe(0);
    }
  });
});

describe('an amount that is not a number', () => {
  it('counts as nothing rather than poisoning the whole ledger', () => {
    // `amount` is client-written and no rule type-checks it. One bad document used to make the
    // total NaN, which spreads to every balance on the screen.
    const l = ledgerFor([ANA, BOGDAN], [
      { groupId: 'f', paidBy: ANA, amount: 50 },
      { groupId: 'f', paidBy: BOGDAN, amount: 'oops' as unknown },
      { groupId: 'f', paidBy: BOGDAN, amount: null },
      { groupId: 'f', paidBy: BOGDAN, amount: undefined },
    ]);
    expect(l.total).toBe(50);
    expect(Number.isFinite(balanceOf(l, ANA))).toBe(true);
    expect(sum(displayedBalances(l))).toBe(0);
  });

  it('ignores an expense with no payer instead of crediting an empty name', () => {
    const l = ledgerFor([ANA], [{ groupId: 'f', amount: 20 }]);
    expect(l.total).toBe(0);
    expect(Object.keys(l.paid)).toEqual([]);
  });
});

describe('an empty or one-person ledger', () => {
  it('divides by nobody without producing Infinity', () => {
    const l = ledgerFor([], []);
    expect(l.share).toBe(0);
    expect(displayedBalances(l)).toEqual([]);
  });

  it('leaves one person owing themselves nothing', () => {
    const l = ledgerFor([ANA], [{ groupId: 'f', paidBy: ANA, amount: 40 }]);
    expect(balanceOf(l, ANA)).toBe(0);
  });
});

describe('settled means settled', () => {
  it('does not print a minus sign in front of nothing', () => {
    // The screen coloured on 0.005 but printed with toFixed(2), so -0.004 was painted as settled
    // and written as "-0.00".
    expect(isSettled(-0.004)).toBe(true);
    expect(isSettled(0)).toBe(true);
    expect(isSettled(0.01)).toBe(false);
  });
});
