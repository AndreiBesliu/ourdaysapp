// rules-tests/bulkReadTokensJoined.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M19 (f3706d2, `userReadFieldsOk`): the push tokens, joined, are at most 200,000
// characters. The suite refused 200,001 (bulk-read-fields.test.ts) and passed 500 real tokens (about
// 82,000), so the boundary itself was free: `<` in place of `<=` refused a list exactly at the cap and
// nothing noticed. Runs from rules-tests/ (emu-run --into=rules-tests).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { DAVE, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-mbulk-tokens'); });
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', DAVE), { name: 'Dave', email: 'dave@example.test', fcmTokens: ['t-1'] });
  });
});

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

// Two tokens and the comma `join` puts between them: 99,999 + 1 + 100,000 = 200,000.
const AT_CAP = ['x'.repeat(99_999), 'y'.repeat(100_000)];
const PAST_CAP = ['x'.repeat(100_000), 'y'.repeat(100_000)];

describe('the push tokens, joined, are at most 200,000 characters', () => {
  it('takes a list exactly at the cap, on an edit and at sign-up', async () => {
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmTokens: AT_CAP }));
    await assertSucceeds(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), { name: 'New', fcmTokens: AT_CAP }));
  });

  it('refuses one character past it', async () => {
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmTokens: PAST_CAP }));
    await fails(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), { name: 'New', fcmTokens: PAST_CAP }));
  });
});
