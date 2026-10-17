// src/utils/seriesReach.test.ts
//
// The reminders read each frequency's series from `SERIES_REACH_DAYS` before the first day a run looks at
// (functions/src/recurrenceServer.ts, 17.10.2026). That is a promise about the horizon in recurrenceCore.ts:
// no series begun earlier has an occurrence on that day or after. Held here against the real horizon, so
// that a horizon made longer turns this red rather than quietly losing the last reminders of a series.

import { describe, expect, it } from 'vitest';
import { FREQUENCIES, SERIES_REACH_DAYS } from '../../functions/src/recurrenceServer';
import { lastOccurrenceDay, seriesStartDay } from '../../functions/src/recurrenceCore';

const DAY = 86_400_000;
const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00.000Z`);

describe('how far back a series can have started and still run', () => {
  it('is its longest run, from its first day to its last occurrence, plus one day', () => {
    // Every first day of 1999..2104: leap years, the century 2100 that is not one, every month length.
    const longest: Record<string, number> = {};
    for (let ms = dayMs('1999-01-01'); ms < dayMs('2105-01-01'); ms += DAY) {
      const start = dayString(ms);
      for (const f of FREQUENCIES) {
        for (const onlyOn of f === 'daily' ? [null, 'weekdays', 'weekends'] : [null]) {
          const last = lastOccurrenceDay(start, f, onlyOn);
          if (last) longest[f] = Math.max(longest[f] ?? 0, Math.round((dayMs(last) - ms) / DAY));
        }
      }
    }
    expect(longest).toEqual({ daily: 30, weekly: 364, monthly: 366, yearly: 1827 });
    for (const f of FREQUENCIES) expect(SERIES_REACH_DAYS[f], f).toBe(longest[f] + 1);
  });

  it('the one day more: every way a first day is stored sorts at or after midnight of the day before it', () => {
    for (let ms = dayMs('2023-12-01'); ms < dayMs('2025-01-31'); ms += DAY) {
      const day = dayString(ms);
      // The form, the old move code's 23:00Z the day before, seriesStartDay's 22:00Z edge, a bare label.
      for (const stored of [`${day}T00:00:00.000Z`, new Date(ms - 3_600_000).toISOString(), new Date(ms - 2 * 3_600_000).toISOString(), day]) {
        const first = seriesStartDay(stored) as string;
        expect(stored >= `${dayString(dayMs(first) - DAY)}T00:00:00.000Z`, stored).toBe(true);
      }
    }
  });
});
