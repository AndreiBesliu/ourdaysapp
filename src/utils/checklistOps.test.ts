// src/utils/checklistOps.test.ts
//
// Checklist changes used to write the whole array from the screen's copy, so two people ticking
// at once erased each other's tick. See the header of checklistOps.ts. The race itself is run on
// the emulator in rules-tests/checklist-concurrency.test.ts; this file pins the operations.

import { describe, it, expect } from 'vitest';
import { applyChecklistOp, writeChecklistOpWith, type ChecklistWriter } from './checklistOps';

const BASE = [
  { id: 'a', text: 'Bread', isCompleted: false },
  { id: 'b', text: 'Milk', isCompleted: false },
  { id: 'c', text: 'Eggs', isCompleted: false },
];

describe('two changes to the same checklist both survive', () => {
  it('Alice ticks one item, Bob another — in either order', () => {
    const alice = { kind: 'set-completed', id: 'a', value: true } as const;
    const bob = { kind: 'set-completed', id: 'c', value: true } as const;
    const ab = applyChecklistOp(applyChecklistOp(BASE, alice), bob);
    const ba = applyChecklistOp(applyChecklistOp(BASE, bob), alice);
    for (const out of [ab, ba]) {
      expect(out.map((x) => x.isCompleted)).toEqual([true, false, true]);
    }
  });

  it('two people ticking the SAME item agree instead of cancelling out', () => {
    // A toggle applied twice is back where it started. A set is not.
    const tick = { kind: 'set-completed', id: 'b', value: true } as const;
    expect(applyChecklistOp(applyChecklistOp(BASE, tick), tick)[1].isCompleted).toBe(true);
  });
});

describe('each operation', () => {
  it('edits the text of one item and nothing else', () => {
    const out = applyChecklistOp(BASE, { kind: 'set-text', id: 'b', text: 'Oat milk' });
    expect(out.map((x) => x.text)).toEqual(['Bread', 'Oat milk', 'Eggs']);
  });

  it('moves an item before its new neighbour, or to the end', () => {
    expect(applyChecklistOp(BASE, { kind: 'move', id: 'c', beforeId: 'a' }).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(applyChecklistOp(BASE, { kind: 'move', id: 'a', beforeId: null }).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    // A neighbour removed meanwhile: to the end, not lost.
    expect(applyChecklistOp(BASE, { kind: 'move', id: 'a', beforeId: 'zz' }).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('appends each item once, however many times the write is retried', () => {
    const add = { kind: 'append', items: [{ id: 'd', text: 'Tea' }, { id: 'a', text: 'dup' }] } as const;
    const once = applyChecklistOp(BASE, add);
    expect(once.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyChecklistOp(once, add)).toEqual(once);
  });
});

describe('what it must not do', () => {
  it('bring back an item somebody deleted meanwhile', () => {
    const withoutB = BASE.filter((x) => x.id !== 'b');
    for (const op of [
      { kind: 'set-completed', id: 'b', value: true },
      { kind: 'set-text', id: 'b', text: 'x' },
      { kind: 'move', id: 'b', beforeId: null },
    ] as const) {
      expect(applyChecklistOp(withoutB, op), op.kind).toEqual(withoutB);
    }
  });

  it('throw on a checklist that is not one', () => {
    for (const bad of [undefined, null, 'x', {}, [null, 3, 'y']]) {
      expect(applyChecklistOp(bad, { kind: 'set-completed', id: 'a', value: true })).toEqual([]);
    }
  });
});

// ── How the writes leave this screen ────────────────────────────────────────────────────────

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { p, open };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const never = () => new Promise<void>(() => {});
const failWith = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };

function writer(over: Partial<ChecklistWriter>): ChecklistWriter {
  return { offline: () => false, transact: async () => {}, queue: async () => {}, ...over };
}

describe("one person's changes land in the order they were made", () => {
  it('tick then untick ends unticked, even when the tick is slow', async () => {
    // Two transactions at once, and Firestore retries the loser — so the tick could commit after
    // the untick and leave the item ticked. Measured against the version without the queue.
    const log: string[] = [];
    let ticked = false;
    const slow = gate();
    const tick = writeChecklistOpWith(writer({
      transact: async () => { log.push('tick'); await slow.p; ticked = true; },
    }), 'ev-order');
    const untick = writeChecklistOpWith(writer({
      transact: async () => { log.push('untick'); ticked = false; },
    }), 'ev-order');
    await settle();
    expect(log).toEqual(['tick']);
    slow.open();
    await Promise.all([tick, untick]);
    expect(log).toEqual(['tick', 'untick']);
    expect(ticked).toBe(false);
  });

  it('a refused change does not hold the next one hostage, and is still reported', async () => {
    const first = writeChecklistOpWith(writer({ transact: failWith('permission-denied') }), 'ev-refused');
    let ran = false;
    const second = writeChecklistOpWith(writer({ transact: async () => { ran = true; } }), 'ev-refused');
    await expect(first).rejects.toThrow('permission-denied');
    await second;
    expect(ran).toBe(true);
  });

  it('a different event does not wait', async () => {
    const slow = gate();
    void writeChecklistOpWith(writer({ transact: () => slow.p }), 'ev-a');
    let ran = false;
    await writeChecklistOpWith(writer({ transact: async () => { ran = true; } }), 'ev-b');
    expect(ran).toBe(true);
    slow.open();
  });
});

describe('when the server cannot be reached', () => {
  it('"online" but unreachable: the change is queued, not dropped', async () => {
    const queued: string[] = [];
    await writeChecklistOpWith(writer({
      transact: failWith('unavailable'),
      queue: async () => { queued.push('whole array'); },
    }), 'ev-unreachable');
    expect(queued).toEqual(['whole array']);
  });

  it('any other failure is reported, and nothing is queued behind its back', async () => {
    for (const code of ['permission-denied', 'failed-precondition']) {
      const queued: string[] = [];
      await expect(writeChecklistOpWith(writer({
        transact: failWith(code),
        queue: async () => { queued.push('x'); },
      }), `ev-${code}`)).rejects.toThrow(code);
      expect(queued).toEqual([]);
    }
  });

  it('offline, a queued write that is not yet acknowledged does not block the next change', async () => {
    // Offline, `updateDoc` settles only when the connection returns. Waiting for it would hold
    // every later change on this event back — not even applied locally — until then.
    const log: string[] = [];
    void writeChecklistOpWith(writer({ offline: () => true, queue: () => { log.push('first'); return never(); } }), 'ev-offline');
    void writeChecklistOpWith(writer({ offline: () => true, queue: () => { log.push('second'); return never(); } }), 'ev-offline');
    await settle();
    expect(log).toEqual(['first', 'second']);
  });
});
