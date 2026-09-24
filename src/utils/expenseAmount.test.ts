// src/utils/expenseAmount.test.ts
//
// One expense with a bad amount put every member's Wallet on the ErrorBoundary. See the header of
// expenseAmount.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPENSE_AMOUNT_MAX, parseExpenseAmount, formatAmount } from './expenseAmount';

describe('what the form accepts', () => {
  it('an ordinary amount, rounded to cents, with a decimal comma too', () => {
    expect(parseExpenseAmount('12.5')).toBe(12.5);
    expect(parseExpenseAmount(' 12,50 ')).toBe(12.5);
    expect(parseExpenseAmount('12.345')).toBe(12.35);
    expect(parseExpenseAmount(EXPENSE_AMOUNT_MAX - 0.01)).toBe(EXPENSE_AMOUNT_MAX - 0.01);
  });

  it('nothing that parseFloat used to let through', () => {
    for (const raw of ['', '   ', 'abc', '-5', '0', '0.001', '1e400', 'Infinity', 'NaN', null, undefined, true]) {
      expect(parseExpenseAmount(raw), JSON.stringify(raw)).toBeNull();
    }
    // The ceiling is exclusive, exactly as the rule says `<`.
    expect(parseExpenseAmount(EXPENSE_AMOUNT_MAX)).toBeNull();
  });
});

describe('what the wallet renders', () => {
  it('an amount as money', () => {
    expect(formatAmount(12.5)).toBe('12.50');
    expect(formatAmount('3')).toBe('3.00');
  });

  it('a dash — never a crash, and never a fake zero — for a row that predates the rule', () => {
    for (const v of ['twelve', '', null, undefined, NaN, Infinity, [], [12], {}, true]) {
      expect(formatAmount(v), String(v)).toBe('—');
    }
  });
});

describe('the ceiling is the rule’s ceiling', () => {
  // A copy of a number in another file stops being true quietly. Read the rule and compare.
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const block = rules.slice(rules.indexOf('match /expenses/{expenseId}'), rules.indexOf('match /assets/{assetId}'));

  it('has the same literal', () => {
    const m = /function amountOk\(\)\s*\{[^}]*amount\s*<\s*(\d+)/.exec(block);
    expect(m, 'amountOk() not found in the expenses block').not.toBeNull();
    expect(Number(m![1])).toBe(EXPENSE_AMOUNT_MAX);
  });

  it('and applies it on create AND update', () => {
    const create = block.slice(block.indexOf('allow create:'), block.indexOf('allow update:'));
    const update = block.slice(block.indexOf('allow update:'), block.indexOf('allow delete:'));
    expect(create).toMatch(/amountOk\(\)/);
    expect(update).toMatch(/amountOk\(\)/);
  });
});
