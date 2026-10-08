// src/utils/expenseDoc.test.ts
//
// An expense as the Wallet may use it, the number the rules hold its description to, and the
// listeners that read through it (08.10.2026).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { EXPENSE_DESCRIPTION_MAX, normaliseExpense } from './expenseDoc';

const MAP = { a: 1 };
const ts = { seconds: 5, toMillis: () => 5000, toDate: () => new Date(5000) };

describe('an expense as the Wallet may use it', () => {
  it('one the app wrote comes through as it was', () => {
    const x = { id: 'x', amount: 25, description: 'Groceries', paidBy: 'a', ownerId: 'a', groupId: 'g', splitAmong: ['a', 'b'], createdAt: ts };
    expect(normaliseExpense(x)).toEqual(x);
    expect(normaliseExpense({ ...x, groupId: null }).groupId).toBeNull();
  });

  it('what a member could plant comes through as harmless kinds', () => {
    expect(normaliseExpense({ id: 'x', description: MAP, paidBy: 5, ownerId: MAP, groupId: MAP, createdAt: 'x' })).toMatchObject({
      description: '', paidBy: '', ownerId: '', groupId: null, createdAt: null,
    });
    // The amount and the split keep their own guards (formatAmount, ledger), which never throw.
    expect(normaliseExpense({ id: 'x', amount: 'x', splitAmong: 'y' })).toMatchObject({ amount: 'x', splitAmong: 'y' });
  });
});

describe('the rule and the form say the same', () => {
  it('at most EXPENSE_DESCRIPTION_MAX characters of text, on create and on a change', () => {
    const rules = readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n');
    const block = rules.slice(rules.indexOf('match /expenses/{expenseId}'), rules.indexOf('match /assets/{assetId}'));
    expect(block).toContain(`request.resource.data.get('description', '').size() <= ${EXPENSE_DESCRIPTION_MAX}`);
    const create = block.slice(block.indexOf('allow create:'), block.indexOf('allow update:'));
    const update = block.slice(block.indexOf('allow update:'), block.indexOf('allow delete:'));
    expect(create).toContain('&& expenseDescriptionOk();');
    expect(update).toContain("affectedKeys().hasAny(['description'])\n            || expenseDescriptionOk());");
  });

  it('the tab reads through it, and its input stops at the rule', () => {
    const tab = readFileSync('src/components/ExpensesTab.tsx', 'utf8');
    expect(tab).toContain('mine.set(d.id, normaliseExpense({ ...d.data(), id: d.id }))');
    expect(tab).toContain('theirs.set(d.id, normaliseExpense({ ...d.data(), id: d.id }))');
    expect(tab).toContain('maxLength={EXPENSE_DESCRIPTION_MAX}');
    expect(tab).toContain("{exp.description || t('logUntitled', language)}");
  });
});
