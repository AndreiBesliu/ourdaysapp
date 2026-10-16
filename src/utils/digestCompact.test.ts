// src/utils/digestCompact.test.ts
//
// The group digest reads only DIGEST_FIELDS of the group's events and reduces each one on arrival
// (`compactEvent`; functions/src/digestRead.ts, 16.10.2026): any member can pad a group's event to a
// megabyte. Pinned here: for every event the app writes, the digest's lines come out exactly as they
// did from the whole document, but for a title, which reaches the model as its first 120 characters, as
// a reminder's does (groupDigestRead.test.ts holds that, through the callable). A field the lines are
// made from and the list leaves out would change them quietly, and a field the list holds for nothing
// would be read for nothing.

import { describe, it, expect } from 'vitest';
import { DIGEST_FIELDS, digestEventLines, digestWindow } from '../../functions/src/digestEvents';
import { compactEvent } from '../../functions/src/remindersCore';

const G = 'g1';
const OWNER = 'uid-owner';
const ANA = 'uid-ana';
const WINDOW = digestWindow('2026-07-15T10:00:00.000Z')!; // Wednesday 15 to Wednesday 22 July
const day = (d: string) => `${d}T00:00:00.000Z`;

/** A group's events as the app writes them: every field the lines are made from, in the shapes it writes. */
const EVENTS: Array<Record<string, unknown> & { id: string }> = [
  { id: 'plain', ownerId: OWNER, groupId: G, title: 'Dentist', date: day('2026-07-16'), time: '10:00', recurrenceRule: null, recurrenceExceptions: [] },
  // Began before the window and still running on its first day.
  { id: 'trip', ownerId: ANA, groupId: G, title: 'Trip', date: day('2026-07-12'), endDayOffset: 4 },
  // Weekdays only: without its filter it would also fall on the weekend.
  { id: 'standup', ownerId: ANA, groupId: G, title: 'Standup', date: day('2026-07-01'), recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' }, recurrenceExceptions: ['2026-07-16'] },
  { id: 'football', ownerId: OWNER, groupId: G, title: 'Football', date: day('2026-01-06'), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [] },
  { id: 'rent', ownerId: OWNER, groupId: G, title: 'Rent', date: day('2025-12-20'), recurrenceRule: { frequency: 'monthly' } },
  { id: 'anniversary', ownerId: ANA, groupId: G, title: 'Anniversary', date: day('2022-07-18'), recurrenceRule: { frequency: 'yearly' } },
  // An edited occurrence of Football, MOVED from Tuesday 21 to Wednesday 22: it hides the 21st.
  { id: 'football-moved', ownerId: OWNER, groupId: G, title: 'Football (moved)', date: day('2026-07-22'), overrideOfParent: 'football', overrideDate: '2026-07-21' },
  // A copy that carries the keys but is not the series' (another owner, same group): it hides nothing,
  // so Rent still falls on the 20th.
  { id: 'not-an-edit', ownerId: ANA, groupId: G, title: 'Not an edit', date: day('2026-07-14'), overrideOfParent: 'rent', overrideDate: '2026-07-20' },
  // Another group's: never a line of this one.
  { id: 'elsewhere', ownerId: OWNER, groupId: 'g2', title: 'Elsewhere', date: day('2026-07-17') },
];

const lines = (docs: Array<Record<string, unknown> & { id: string }>) =>
  digestEventLines(docs as never, G, WINDOW, 1000).lines;

/** What `select(DIGEST_FIELDS)` returns of a document: whole fields, and the named parts of a map. */
function selected(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of DIGEST_FIELDS) {
    const [top, sub] = path.split('.');
    if (!(top in e)) continue;
    if (sub === undefined) { out[top] = e[top]; continue; }
    const m = e[top];
    if (m && typeof m === 'object' && !Array.isArray(m) && sub in m) {
      out[top] = { ...(out[top] as object), [sub]: (m as Record<string, unknown>)[sub] };
    }
  }
  return out;
}

/** A document without one field of the list (a part of a map, for a dotted one). */
function without(e: Record<string, unknown> & { id: string }, path: string) {
  const [top, sub] = path.split('.');
  if (sub === undefined) { const { [top]: _gone, ...rest } = e; return rest as typeof e; }
  const m = e[top];
  if (!m || typeof m !== 'object') return e;
  const { [sub]: _part, ...restOfMap } = m as Record<string, unknown>;
  return { ...e, [top]: restOfMap };
}

const compactAll = (docs: Array<Record<string, unknown> & { id: string }>) =>
  docs.map((e) => compactEvent(e.id, selected(e), WINDOW.fromDay, WINDOW.toDay))
    .filter((x): x is NonNullable<typeof x> => x !== null);

describe('for every event the app writes, the digest lists the same', () => {
  it('from the selected fields, reduced, as from the whole documents', () => {
    const whole = lines(EVENTS);
    // Not a vacuous comparison: a span, every frequency, a day filter, an exception, a moved edit.
    expect(whole).toContain('- Trip on 2026-07-12');
    expect(whole).toContain('- Football (moved) on 2026-07-22');
    expect(whole).not.toContain('- Football on 2026-07-21');
    expect(whole).toContain('- Rent on 2026-07-20');
    expect(whole.filter((l) => l.startsWith('- Standup'))).toHaveLength(5);
    expect(whole.some((l) => l.includes('Elsewhere'))).toBe(false);
    expect(lines(compactAll(EVENTS))).toEqual(whole);
  });

  it('with the rest of each document beside them, which is simply not read', () => {
    const padded = EVENTS.map((e) => ({ ...e, description: 'x'.repeat(10_000), checklistItems: [{ id: 'a' }], hiddenFrom: ['b'], imageUrl: 'c' }));
    expect(lines(compactAll(padded))).toEqual(lines(EVENTS));
  });

  it('every field on the list changes some line when it is gone — the list holds nothing idle', () => {
    const whole = lines(EVENTS);
    for (const f of DIGEST_FIELDS) {
      expect(lines(compactAll(EVENTS.map((e) => without(e, f)))), f).not.toEqual(whole);
    }
  });
});
