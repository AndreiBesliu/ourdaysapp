// src/utils/checklistOps.test.ts
//
// Checklist changes used to write the whole array from the screen's copy, so two people ticking
// at once erased each other's tick. See the header of checklistOps.ts. The race itself is run on
// the emulator in rules-tests/checklist-concurrency.test.ts; this file pins the operations.

import { describe, it, expect } from 'vitest';
import { applyChecklistOp } from './checklistOps';

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
