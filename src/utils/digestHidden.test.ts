// src/utils/digestHidden.test.ts
//
// The pure half of the fix for events hidden from the caller (review of 17.10.2026).
// `digestEventLines` takes the ids the caller may not see (digestRead.ts decides them on arrival) and drops
// their occurrences AFTER the expansion and BEFORE the cut.

import { describe, it, expect } from 'vitest';
import { digestWindow, digestEventLines } from '../../functions/src/digestEvents';
import type { EventDoc } from '../../functions/src/recurrenceServer';

const G = 'group-1';
const ev = (over: Partial<EventDoc> & { id: string }): EventDoc =>
  ({ groupId: G, ownerId: 'uid-bob', title: 'Something', ...over }) as EventDoc;
const day = (d: string) => `${d}T00:00:00.000Z`;
const w = digestWindow('2026-09-19T14:32:11.123Z')!; // Saturday 19 to Saturday 26 September

describe('what the caller may not see', () => {
  it('is not a line of the caller\'s digest', () => {
    const docs = [ev({ id: 'surprise', title: 'Surprise', date: day('2026-09-20') }), ev({ id: 'plain', title: 'Plain', date: day('2026-09-21') })];
    expect(digestEventLines(docs, G, w, undefined, new Set(['surprise'])).lines).toEqual(['- Plain on 2026-09-21']);
    // Nobody named: the same as before.
    expect(digestEventLines(docs, G, w).lines).toEqual(['- Surprise on 2026-09-20', '- Plain on 2026-09-21']);
  });

  it('a hidden edit still stands in for its parent\'s occurrence: no ghost', () => {
    const weekly = ev({ id: 'r', title: 'Dinner', date: day('2026-09-19'), recurrenceRule: { frequency: 'weekly' } });
    const edited = ev({ id: 'r-edit', title: 'Surprise dinner', date: day('2026-09-26'), overrideOfParent: 'r' });
    const { lines } = digestEventLines([weekly, edited], G, w, undefined, new Set(['r-edit']));
    expect(lines).toEqual(['- Dinner on 2026-09-19']);
  });

  it('a visible edit of a hidden series is the caller\'s to see', () => {
    const weekly = ev({ id: 'r', title: 'Planning', date: day('2026-09-19'), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: ['2026-09-26'] });
    const edited = ev({ id: 'r-edit', title: 'Planning (open)', date: day('2026-09-26'), overrideOfParent: 'r', overrideDate: '2026-09-26' });
    expect(digestEventLines([weekly, edited], G, w, undefined, new Set(['r'])).lines).toEqual(['- Planning (open) on 2026-09-26']);
  });

  it('takes no line from the caller, and does not make the digest say it is cut', () => {
    const hidden = Array.from({ length: 5 }, (_, i) => ev({ id: `h${i}`, title: `H${i}`, date: day('2026-09-20') }));
    const shown = Array.from({ length: 2 }, (_, i) => ev({ id: `v${i}`, title: `V${i}`, date: day('2026-09-21') }));
    const sel = digestEventLines([...hidden, ...shown], G, w, 3, new Set(hidden.map((d) => d.id)));
    expect(sel.lines).toEqual(['- V0 on 2026-09-21', '- V1 on 2026-09-21']);
    expect(sel.truncated).toBe(false);
  });
});
