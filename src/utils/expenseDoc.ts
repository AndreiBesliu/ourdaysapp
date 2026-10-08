// src/utils/expenseDoc.ts
//
// An expense as the Wallet may use it (08.10.2026). Every member of a group sees every expense of the
// group, and until that day the rules typed only the amount: an expense whose `description` was a map
// (any member could write one on their own row) put the whole app on the recovery screen for the whole
// group the moment anybody opened Wallet → Expenses, with no way back inside the app. The rules now take
// only text of at most EXPENSE_DESCRIPTION_MAX characters (`expenseDescriptionOk`), and the listeners
// pass every row through here, so a row stored before that reaches the screen as text.

import { isTimestamp } from './chatMessage';

/** The longest description: the rules' `expenseDescriptionOk` and the form's maxLength (expenseDoc.test.ts). */
export const EXPENSE_DESCRIPTION_MAX = 200;

/** The row with every field the screen reads of the kind the app writes. `amount` and `splitAmong` keep
 *  their own guards (formatAmount, ledger.recordedSplit), which already never throw. */
export function normaliseExpense<T extends Record<string, any>>(raw: T): T & { description: string } {
  return {
    ...raw,
    description: typeof raw.description === 'string' ? raw.description : '',
    paidBy: typeof raw.paidBy === 'string' ? raw.paidBy : '',
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : '',
    groupId: typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : null,
    createdAt: isTimestamp(raw.createdAt) ? raw.createdAt : null,
  };
}
