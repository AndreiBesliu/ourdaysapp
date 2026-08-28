// src/utils/eventWriteTarget.test.ts
//
// Two opposite failures are possible here and both are silent, so both are pinned:
//   * writing to the synthetic occurrence id — the bug as shipped, a dead button;
//   * writing to the parent instead — one Tuesday's state applied to every Tuesday.

import { describe, it, expect } from 'vitest';
import { planEventWrite } from './eventWriteTarget';

const plain = {
  id: 'abc123',
  title: 'Dentist',
  date: '2026-09-01',
  taskStatus: 'started',
  assigneeIds: ['u1'],
};

const occurrence = {
  // expandRecurringEvents mints exactly this shape.
  id: 'parent9_2026-09-08',
  isRecurringInstance: true,
  parentEventId: 'parent9',
  recurrenceDate: '2026-09-08',
  recurrenceRule: { frequency: 'weekly' },
  recurrenceExceptions: ['2026-09-01'],
  ownerId: 'someone-else',
  groupId: 'g1',
  title: 'Bins out',
  date: '2026-08-25',
  isTask: true,
  taskStatus: 'started',
  checklistItems: [{ id: 'c1', text: 'blue bin', done: false }],
  assigneeIds: ['u1'],
};

describe('a stored event is written to directly', () => {
  it('uses its own id', () => {
    expect(planEventWrite(plain)).toEqual({ kind: 'direct', id: 'abc123' });
  });

  it('a master series event is still direct — it IS a document', () => {
    const master = { id: 'parent9', recurrenceRule: { frequency: 'weekly' }, title: 'Bins out' };
    expect(planEventWrite(master)).toEqual({ kind: 'direct', id: 'parent9' });
  });
});

describe('an occurrence becomes its own document', () => {
  const plan = planEventWrite(occurrence);

  it('never writes to the synthetic id — that document does not exist', () => {
    expect(plan.kind).toBe('override');
    expect(JSON.stringify(plan)).not.toContain('parent9_2026-09-08');
  });

  it('never writes to the parent either — that would rewrite every other occurrence', () => {
    expect(plan.kind === 'override' && plan.parentId).toBe('parent9');
    // The parent is the ANCHOR, not the destination: it is named so the server can add the
    // exception, and nothing in `data` is aimed at it.
    if (plan.kind !== 'override') throw new Error('expected override');
    expect(plan.data.id).toBeUndefined();
    expect(plan.data.overrideOfParent).toBeUndefined();
  });

  it('carries the occurrence’s own date, not the series start', () => {
    if (plan.kind !== 'override') throw new Error('expected override');
    expect(plan.data.date).toBe('2026-09-08');
    expect(plan.overrideDate).toBe('2026-09-08');
  });

  it('keeps the content worth keeping', () => {
    if (plan.kind !== 'override') throw new Error('expected override');
    expect(plan.data.title).toBe('Bins out');
    expect(plan.data.isTask).toBe(true);
    expect(plan.data.taskStatus).toBe('started');
    expect(plan.data.checklistItems).toEqual([{ id: 'c1', text: 'blue bin', done: false }]);
    expect(plan.data.assigneeIds).toEqual(['u1']);
  });

  it('drops the fields that would make the override a series, or claim an owner', () => {
    if (plan.kind !== 'override') throw new Error('expected override');
    for (const k of ['recurrenceRule', 'recurrenceExceptions', 'isRecurringInstance',
                     'parentEventId', 'recurrenceDate', 'ownerId', 'groupId', 'overrideOfParent']) {
      expect(plan.data, `${k} must not be copied`).not.toHaveProperty(k);
    }
  });

  it('never emits an undefined value — Firestore refuses the whole write over one', () => {
    const withHoles = { ...occurrence, location: undefined, notes: undefined };
    const p = planEventWrite(withHoles);
    if (p.kind !== 'override') throw new Error('expected override');
    for (const [k, v] of Object.entries(p.data)) {
      expect(v, `${k} is undefined`).not.toBeUndefined();
    }
  });
});

describe('a malformed instance fails the way it already failed, rather than inventing a document', () => {
  it('no parentEventId', () => {
    const { parentEventId, ...rest } = occurrence;
    expect(planEventWrite(rest).kind).toBe('direct');
  });

  it('no recurrenceDate', () => {
    const { recurrenceDate, ...rest } = occurrence;
    expect(planEventWrite(rest).kind).toBe('direct');
  });

  it('flag set but both anchors missing', () => {
    expect(planEventWrite({ id: 'x', isRecurringInstance: true })).toEqual({ kind: 'direct', id: 'x' });
  });
});
