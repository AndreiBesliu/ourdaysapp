// rules-tests/bulkReadOverrideKeys.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M17 (f3706d2, `overrideKeysOk`): a GROUP event is born with an override's two keys only
// as the server writes them, a document id (at most 1500) and a day (at most 64). The suite refused
// a list or a map there (bulk-read-fields.test.ts) but pinned neither length, so widening either cap,
// or dropping it, went unnoticed. Runs from rules-tests/ (emu-run --into=rules-tests).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection } from 'firebase/firestore';
import { BOB, G1, as, resetWorld, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-mbulk-override-keys'); });
afterAll(stopEnv);
beforeEach(async () => { await resetWorld(); });

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

const DAY = '2026-10-08T00:00:00.000Z';
const groupEvent = (extra: Record<string, unknown>) => ({
  title: 'Walk', ownerId: BOB, groupId: G1, date: DAY, assigneeIds: [BOB], assigneeId: BOB, ...extra,
});

describe('a group event is born with an override’s keys only of the length the server writes', () => {
  it('passes the server’s own shape, and each key at its cap', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), groupEvent({ overrideOfParent: 'parentEventId0000001', overrideDate: '2026-10-08' })));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), groupEvent({ overrideOfParent: 'p'.repeat(1500), overrideDate: 'd'.repeat(64) })));
  });

  it('refuses a day longer than 64 characters', async () => {
    await fails(addDoc(collection(as(BOB), 'events'), groupEvent({ overrideOfParent: 'parentEventId0000001', overrideDate: 'd'.repeat(65) })));
  });

  it('refuses a parent id longer than 1500 characters', async () => {
    await fails(addDoc(collection(as(BOB), 'events'), groupEvent({ overrideOfParent: 'p'.repeat(1501), overrideDate: '2026-10-08' })));
  });
});
