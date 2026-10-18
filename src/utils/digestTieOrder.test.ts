// src/utils/digestTieOrder.test.ts
//
// CI, 18.10.2026: `digestReadEquivalence` failed on a commit that touched only a Markdown file. Two events
// on the digest's boundary day came out in the order the callable's concurrent reads happened to return
// them, and the cut at twenty kept one of them in one run and the other in the next. `expandInWindow` now
// orders by day, then by document, so the documents decide the order and the arrival order does not.

import { describe, it, expect } from 'vitest';
import { digestWindow, digestEventLines } from '../../functions/src/digestEvents';
import { expandInWindow, type EventDoc } from '../../functions/src/recurrenceServer';

const G = 'group-1';
const ev = (over: Partial<EventDoc> & { id: string }): EventDoc =>
  ({ groupId: G, ownerId: 'uid-bob', title: over.id, recurrenceRule: null, ...over }) as EventDoc;
const day = (d: string) => `${d}T00:00:00.000Z`;
const w = digestWindow('2026-10-18T05:24:33.000Z')!; // Sunday 18 to Sunday 25 October

/** Every order of the list (n! of them; kept small). */
function orders<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

// The shapes of the failing run on the boundary day: a plain edit of a legacy series and a weekday series,
// plus a weekly one and a two-day trip, all on Friday 23.
const boundary = [
  ev({ id: 'legacy-edit', title: 'legacy edit', date: day('2026-10-23'), overrideOfParent: 'legacy-parent' }),
  ev({ id: 'daily-weekdays', date: day('2026-10-13'), recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' } }),
  ev({ id: 'weekly', date: day('2026-10-02'), recurrenceRule: { frequency: 'weekly' } }),
  ev({ id: 'trip', date: day('2026-10-23'), endDayOffset: 1 }),
];
const earlier = ev({ id: 'zz-earlier', date: day('2026-10-19') });

describe('same-day events come out in one order, whatever order they were read in', () => {
  it('the expansion orders a day by document id', () => {
    for (const docs of orders(boundary)) {
      const friday = expandInWindow(docs, '2026-10-23', '2026-10-23').map((o) => o.source.id);
      expect(friday).toEqual(['daily-weekdays', 'legacy-edit', 'trip', 'weekly']);
    }
  });

  it('so the digest\'s cut keeps the same lines on the boundary day, in every read order', () => {
    // Before Friday: `earlier` on Monday 19 and the weekday series Monday to Thursday. The cut keeps two of
    // Friday's four lines, so it falls on a tie.
    const all = digestEventLines([earlier, ...boundary], G, w, 1000).lines;
    const beforeFriday = all.filter((l) => l.slice(-10) < '2026-10-23').length;
    expect(beforeFriday).toBe(5);
    const cut = beforeFriday + 2;
    const first = digestEventLines([earlier, ...boundary], G, w, cut);
    expect(first.truncated).toBe(true);
    expect(first.lines.filter((l) => l.endsWith('2026-10-23'))).toEqual([
      '- daily-weekdays on 2026-10-23', '- legacy edit on 2026-10-23',
    ]);
    for (const docs of orders([earlier, ...boundary])) {
      expect(digestEventLines(docs, G, w, cut)).toEqual(first);
    }
  });

  it('documents read twice (by both queries) change nothing', () => {
    const once = digestEventLines([earlier, ...boundary], G, w, 1000);
    expect(digestEventLines([...boundary, earlier, ...boundary.slice().reverse()], G, w, 1000)).toEqual(once);
  });
});
