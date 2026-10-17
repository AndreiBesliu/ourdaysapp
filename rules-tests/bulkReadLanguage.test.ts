// rules-tests/bulkReadLanguage.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M18 (f3706d2, `userReadFieldsOk`): every notification reads up to fifty recipients'
// `language`, so the rules bound it to a short code (16). The suite refused a list or a map there
// (bulk-read-fields.test.ts) but no length, so widening the cap, or dropping it, went unnoticed.
// Runs from rules-tests/ (emu-run --into=rules-tests).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { DAVE, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-mbulk-language'); });
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', DAVE), { name: 'Dave', email: 'dave@example.test', language: 'en-US' });
  });
});

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

describe('a user’s language is a short code, on an edit and at sign-up', () => {
  it('refuses a language longer than 16 characters', async () => {
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { language: 'x'.repeat(17) }));
    await fails(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), { name: 'New', language: 'x'.repeat(17) }));
  });

  it('takes the codes the app writes, and one of exactly 16', async () => {
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { language: 'ro-RO' }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { language: 'x'.repeat(16) }));
    await assertSucceeds(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), { name: 'New', language: 'en-US' }));
  });
});
