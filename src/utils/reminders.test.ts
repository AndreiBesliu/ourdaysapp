// src/utils/reminders.test.ts
// Which reminders are due, and when.
//
// The window arithmetic is the part most likely to be quietly wrong, and both ways of being wrong
// are invisible: a closed interval on both ends sends every reminder twice, and an exclusive top
// end means a reminder that lands exactly on a run boundary is never sent at all. Neither
// produces an error anywhere.

import { describe, it, expect } from 'vitest';
import { dueIn } from '../../functions/src/remindersCore';

const BUC = 'Europe/Bucharest';
const OWNER = 'uid-owner';
const ANA = 'uid-ana';

/** 19:00 Bucharest on 15 July 2026 is 16:00 UTC. */
const START = Date.UTC(2026, 6, 15, 16, 0);

const occ = (over: Record<string, unknown> = {}, day = '2026-07-15') => ([{
  source: {
    id: 'e1', ownerId: OWNER, title: 'Dentist',
    date: `${day}T00:00:00.000Z`, time: '19:00', timezone: BUC, reminderMinutes: 30,
    ...over,
  } as any,
  day,
}]);

const zones = { [OWNER]: BUC };

describe('the window is half-open', () => {
  const at = START - 30 * 60_000; // 15:30 UTC

  it('a reminder landing inside it is due', () => {
    expect(dueIn(occ(), zones, at - 1000, at + 1000)).toHaveLength(1);
  });

  it('landing exactly on the TOP boundary is due — this run owns it', () => {
    expect(dueIn(occ(), zones, at - 60_000, at)).toHaveLength(1);
  });

  it('landing exactly on the BOTTOM boundary is not — the previous run owned it', () => {
    // Closed on both ends and every reminder on a boundary goes out twice, on consecutive runs.
    expect(dueIn(occ(), zones, at, at + 60_000)).toHaveLength(0);
  });

  it('outside it, nothing', () => {
    expect(dueIn(occ(), zones, at + 1000, at + 2000)).toHaveLength(0);
    expect(dueIn(occ(), zones, at - 3000, at - 2000)).toHaveLength(0);
  });
});

describe('when the reminder actually lands', () => {
  const window = (at: number) => dueIn(occ(), zones, at - 1, at);

  it('30 minutes before a 19:00 Bucharest event, in summer', () => {
    expect(window(START - 30 * 60_000)).toHaveLength(1);
  });

  it('zero minutes means at the start', () => {
    expect(dueIn(occ({ reminderMinutes: 0 }), zones, START - 1, START)).toHaveLength(1);
  });

  it('the same wall clock in WINTER is an hour later in real time', () => {
    // If the offset were read once and reused, this would be an hour out for half the year.
    const winterStart = Date.UTC(2026, 0, 15, 17, 0); // 19:00 EET
    const due = dueIn(occ({}, '2026-01-15'), zones, winterStart - 30 * 60_000 - 1, winterStart - 30 * 60_000);
    expect(due).toHaveLength(1);
  });
});

describe('all-day events', () => {
  it('are treated as starting at 09:00 in the OWNER’s zone', () => {
    // Every event in this app was all-day until the clock shipped. Refusing to remind for them
    // would silently drop every reminder anybody has ever set.
    const nineBuc = Date.UTC(2026, 6, 15, 6, 0); // 09:00 EEST
    const due = dueIn(occ({ time: undefined, timezone: undefined }), zones, nineBuc - 30 * 60_000 - 1, nineBuc - 30 * 60_000);
    expect(due).toHaveLength(1);
  });

  it('fall back to UTC when the owner has no zone either, rather than not firing', () => {
    const nineUtc = Date.UTC(2026, 6, 15, 9, 0);
    const due = dueIn(occ({ time: undefined, timezone: undefined }), {}, nineUtc - 30 * 60_000 - 1, nineUtc - 30 * 60_000);
    expect(due).toHaveLength(1);
  });
});

describe('what is skipped', () => {
  const anyWindow = (o: ReturnType<typeof occ>) => dueIn(o, zones, 0, Date.UTC(2030, 0, 1));

  it('an event with no reminder', () => {
    expect(anyWindow(occ({ reminderMinutes: undefined }))).toHaveLength(0);
    expect(anyWindow(occ({ reminderMinutes: null }))).toHaveLength(0);
  });

  it('a negative lead time, which is not a thing', () => {
    expect(anyWindow(occ({ reminderMinutes: -10 }))).toHaveLength(0);
  });

  it('an event with nobody to tell', () => {
    expect(anyWindow(occ({ ownerId: '', assigneeIds: [] }))).toHaveLength(0);
  });

  it('a malformed date, without throwing', () => {
    expect(dueIn([{ source: { id: 'x', ownerId: OWNER, reminderMinutes: 30 } as any, day: 'nonsense' }], zones, 0, Date.UTC(2030, 0, 1)))
      .toHaveLength(0);
  });
});

describe('who gets told', () => {
  const at = START - 30 * 60_000;

  it('the owner, even though nobody "caused" it', () => {
    expect(dueIn(occ(), zones, at - 1, at)[0].recipients).toEqual([OWNER]);
  });

  it('and the assignees, deduped', () => {
    const due = dueIn(occ({ assigneeIds: [ANA, OWNER], assigneeId: ANA }), zones, at - 1, at);
    expect(due[0].recipients).toEqual([OWNER, ANA]);
  });
});

describe('recurring series', () => {
  const at = (day: string) => {
    // 19:00 Bucharest on that day, minus 30 minutes.
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 16, 0) - 30 * 60_000;
  };

  it('use the OCCURRENCE day, not the day the series started', () => {
    // The series document's own `date` is months ago; expanding is the entire reason this works.
    const later = '2026-09-21';
    const due = dueIn(
      [{ source: { id: 'weekly', ownerId: OWNER, title: 'Gym', date: '2026-07-15T00:00:00.000Z', time: '19:00', timezone: BUC, reminderMinutes: 30 } as any, day: later }],
      zones, at(later) - 1, at(later),
    );
    expect(due).toHaveLength(1);
    expect(due[0].day).toBe(later);
  });

  it('get one dedupe key PER occurrence, so every week is reminded', () => {
    // A key of just the event id would remind once and then go quiet for ever.
    const a = dueIn(occ({}, '2026-07-15'), zones, at('2026-07-15') - 1, at('2026-07-15'))[0].key;
    const b = dueIn(occ({}, '2026-07-22'), zones, at('2026-07-22') - 1, at('2026-07-22'))[0].key;
    expect(a).not.toBe(b);
    expect(a).toContain('2026-07-15');
    expect(b).toContain('2026-07-22');
  });
});

describe('what the notification says', () => {
  it('carries the title and the local wall clock', () => {
    const due = dueIn(occ(), zones, START - 30 * 60_000 - 1, START - 30 * 60_000)[0];
    expect(due.title).toBe('Dentist');
    expect(due.clock).toBe('19:00');
  });

  it('shows an all-day event as the nine o’clock it is treated as', () => {
    const nineBuc = Date.UTC(2026, 6, 15, 6, 0);
    const due = dueIn(occ({ time: undefined, timezone: undefined }), zones, nineBuc - 30 * 60_000 - 1, nineBuc - 30 * 60_000)[0];
    expect(due.clock).toBe('09:00');
  });
});
