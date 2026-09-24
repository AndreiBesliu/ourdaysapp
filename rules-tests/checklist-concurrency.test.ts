// rules-tests/checklist-concurrency.test.ts
//
// Two people tick two different checklist items AT THE SAME TIME, on the emulator, through the
// real rules and real transactions.
//
// The first test is the CONTROL: the old way (each screen writes the whole array from its own
// copy). It must lose a tick — if it did not, this file would be demonstrating nothing about the
// new way. The second is the new way, and both ticks must survive.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';
import { writeChecklistOp } from '../src/utils/checklistOps';

beforeAll(() => startEnv('demo-checklist-race'));
afterAll(stopEnv);

const ITEMS = [
  { id: 'a', text: 'Bread', isCompleted: false },
  { id: 'b', text: 'Milk', isCompleted: false },
];

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'events', 'shop'), {
      title: 'Shopping', ownerId: ALICE, groupId: G1, date: '2026-09-24T00:00:00.000Z',
      checklistItems: ITEMS, assigneeIds: [],
    });
  });
});

async function read(): Promise<boolean[]> {
  let out: boolean[] = [];
  await seed(async (db) => {
    out = ((await getDoc(doc(db, 'events', 'shop'))).data()?.checklistItems as typeof ITEMS)
      .map((x) => x.isCompleted);
  });
  return out;
}

describe('two ticks at once', () => {
  it('CONTROL — the old whole-array write loses one', async () => {
    // Both screens hold the same copy; each writes it back with its own tick.
    const aliceCopy = ITEMS.map((x) => (x.id === 'a' ? { ...x, isCompleted: true } : x));
    const bobCopy = ITEMS.map((x) => (x.id === 'b' ? { ...x, isCompleted: true } : x));
    await updateDoc(doc(as(ALICE), 'events', 'shop'), { checklistItems: aliceCopy });
    await updateDoc(doc(as(BOB), 'events', 'shop'), { checklistItems: bobCopy });
    expect(await read()).toEqual([false, true]); // Alice's tick is gone
  });

  it('the new way keeps both, even raced', async () => {
    await Promise.all([
      writeChecklistOp(as(ALICE), 'shop', { kind: 'set-completed', id: 'a', value: true }, []),
      writeChecklistOp(as(BOB), 'shop', { kind: 'set-completed', id: 'b', value: true }, []),
    ]);
    expect(await read()).toEqual([true, true]);
  });

  it('and so does a tick that lands while generated items are being appended', async () => {
    await Promise.all([
      writeChecklistOp(as(ALICE), 'shop', { kind: 'append', items: [{ id: 'c', text: 'Eggs', isCompleted: false }] }, []),
      writeChecklistOp(as(BOB), 'shop', { kind: 'set-completed', id: 'b', value: true }, []),
    ]);
    expect(await read()).toEqual([false, true, false]);
  });
});
