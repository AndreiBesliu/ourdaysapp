// src/utils/overrideFields.test.ts
//
// The list that decides what survives when one occurrence of a repeating event is materialised.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// `OVERRIDE_FIELDS` in `functions/src/index.ts` is a whitelist, and `createEventOverride` copies a
// field only if it is on it. Anything else is dropped SILENTLY — no error, no log, no sign on the
// screen; the occurrence simply comes back missing something the parent had.
//
// On 19.09 an adversarial review found `rsvpEnabled` on the list and `rsvps` not. So the moment an
// occurrence was materialised — by ticking a checklist item, or by answering an invitation — the
// new document kept the question and dropped everybody's answers.
//
// The defect is not one missing word. It is that fields which only mean something TOGETHER were
// added one at a time, by different changes, months apart. This file pins the pairs.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(__dirname, '..', '..', 'functions', 'src', 'index.ts');

/** The literal list, read from the server file rather than from a copy that could drift. */
function overrideFields(): string[] {
  const src = readFileSync(SOURCE, 'utf8');
  const start = src.indexOf('const OVERRIDE_FIELDS = [');
  expect(start, 'OVERRIDE_FIELDS is no longer declared the way this test reads it').toBeGreaterThan(-1);
  const end = src.indexOf('] as const;', start);
  expect(end, 'the declaration is no longer closed with `] as const;`').toBeGreaterThan(start);
  const body = src.slice(start, end).replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
}

describe('what an occurrence carries away from its parent', () => {
  const fields = overrideFields();

  it('is read at all, so this cannot pass by parsing nothing', () => {
    expect(fields.length).toBeGreaterThan(15);
    expect(fields).toContain('title');
  });

  it('carries every field the details window writes on an occurrence', () => {
    // Each of these is written by a handler in EventDetailsModal through `resolveWriteTarget`,
    // which materialises the occurrence first. A field missing here is a write that lands on a
    // document which has just thrown that field away.
    for (const f of ['taskStatus', 'checklistItems', 'assigneeIds', 'rsvps']) {
      expect(fields, f + ' is written on an occurrence but would not survive materialising it').toContain(f);
    }
  });

  it('keeps together the fields that only mean something together', () => {
    // A question with no answers, a clock with no zone, a start with no end: each half alone is
    // worse than neither, because the screen renders it as fact.
    const pairs: [string, string][] = [
      ['rsvpEnabled', 'rsvps'],
      ['time', 'timezone'],
      ['endDayOffset', 'endTime'],
      ['assigneeIds', 'assigneeId'],
    ];
    for (const [a, b] of pairs) {
      expect(fields.includes(a), a + ' and ' + b + ' must both be on the list or neither')
        .toBe(fields.includes(b));
    }
  });

  it('does not carry the fields that make an occurrence an occurrence', () => {
    // These are written by the override itself. Copying the parent's would make the new document
    // claim to be the series, or to be an occurrence of itself.
    for (const f of ['recurrenceRule', 'parentEventId', 'recurrenceDate', 'ownerId', 'groupId']) {
      expect(fields, f + ' belongs to the override, not to what it copies').not.toContain(f);
    }
  });
});
