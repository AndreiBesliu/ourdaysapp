// src/utils/seriesStart.test.ts
//
// Editing a recurring event used to destroy it. Opening the September occurrence of a series that
// began in August, changing the title, and saving with "All events in series" wrote September onto
// the parent — and since the parent's date IS the series start, every occurrence before September
// stopped existing. Nine became three, measured on the real expander.
//
// The first test below is that scenario, end to end, through `expandRecurringEvents`. The rest are
// about refusing to write, because a wrong series start deletes history silently.

import { describe, it, expect } from 'vitest';
import { expandRecurringEvents, shiftedSeriesStart } from './recurrence';
import { dayAsLocalDate } from './dayLabel';

const WEEKLY = {
  id: 'series-1',
  title: 'Gym',
  date: '2026-08-03T00:00:00.000Z',
  recurrenceRule: { frequency: 'weekly' as const },
};

const FROM = new Date('2026-08-01T00:00:00.000Z');
const TO = new Date('2026-10-01T00:00:00.000Z');

const daysOf = (ev: unknown) =>
  expandRecurringEvents([ev as never], FROM, TO).map((e) => (e as { date: string }).date.slice(0, 10));

describe('editing the whole series without touching the date', () => {
  it('leaves every occurrence exactly where it was', () => {
    // The regression this file exists for.
    const before = daysOf(WEEKLY);
    const shift = shiftedSeriesStart(WEEKLY.date, '2026-09-14', '2026-09-14');
    expect(shift).toBeNull();

    // Nothing written, so the series is untouched.
    const after = daysOf(WEEKLY);
    expect(after).toEqual(before);
    expect(after).toHaveLength(9);
    expect(after[0]).toBe('2026-08-03');
  });

  it('is what the old behaviour destroyed, for comparison', () => {
    // What used to happen: the occurrence's date written straight onto the parent.
    const broken = { ...WEEKLY, date: '2026-09-14T00:00:00.000Z' };
    expect(daysOf(broken)).toHaveLength(3);
    expect(daysOf(WEEKLY)).toHaveLength(9);
  });
});

describe('deliberately moving the series', () => {
  it('shifts the whole series by the same offset, keeping its history', () => {
    // Opened the 14 Sept occurrence and moved it to the 16th: the series moves by two days, so the
    // August occurrences move too rather than disappearing.
    const next = shiftedSeriesStart(WEEKLY.date, '2026-09-14', '2026-09-16');
    expect(next).not.toBeNull();

    const moved = daysOf({ ...WEEKLY, date: next });
    expect(moved).toHaveLength(9);
    expect(moved[0]).toBe('2026-08-05');       // was 08-03, +2 days
    expect(moved).toContain('2026-09-16');
  });

  it('moves backwards too', () => {
    // Asserted on the START, not on the expansion: three days earlier puts the first occurrence at
    // 31 July, which is outside the August-to-October window `daysOf` looks at, so the expansion
    // legitimately does not show it. The test failed on that and was wrong, not the code.
    const next = shiftedSeriesStart(WEEKLY.date, '2026-09-14', '2026-09-11');
    expect(next!.slice(0, 10)).toBe('2026-07-31');
    expect(daysOf({ ...WEEKLY, date: next })[0]).toBe('2026-08-07');
  });

  it('moves by calendar days, across a month boundary', () => {
    const next = shiftedSeriesStart('2026-08-03T00:00:00.000Z', '2026-08-30', '2026-09-02');
    expect(next!.slice(0, 10)).toBe('2026-08-06');
  });
});

describe('refusing to write, which is always the safe direction', () => {
  it('writes nothing when the date did not change', () => {
    expect(shiftedSeriesStart(WEEKLY.date, '2026-09-14', '2026-09-14')).toBeNull();
  });

  it('writes nothing when any input is missing or unusable', () => {
    expect(shiftedSeriesStart(undefined, '2026-09-14', '2026-09-16')).toBeNull();
    expect(shiftedSeriesStart(WEEKLY.date, undefined, '2026-09-16')).toBeNull();
    expect(shiftedSeriesStart(WEEKLY.date, '2026-09-14', undefined)).toBeNull();
    expect(shiftedSeriesStart('not a date', '2026-09-14', '2026-09-16')).toBeNull();
    expect(shiftedSeriesStart(WEEKLY.date, 'whenever', '2026-09-16')).toBeNull();
    expect(shiftedSeriesStart(WEEKLY.date, '2026-09-14', 'soon')).toBeNull();
  });

  it('survives junk without throwing', () => {
    for (const junk of [42, {}, [], null, true]) {
      expect(() => shiftedSeriesStart(junk, junk, junk)).not.toThrow();
      expect(shiftedSeriesStart(junk, junk, junk)).toBeNull();
    }
  });
});

// ── A day-filtered daily series moves from its first KEPT day (26.09.2026) ─────────────────────
describe('moving a weekdays-only series stored on a Saturday', () => {
  const WEEKDAYS = { frequency: 'daily', onlyOn: 'weekdays' };
  const SAT = '2026-10-10T00:00:00.000Z'; // first occurrence: Monday the 12th

  it('Monday → Tuesday moves the series one day: its first occurrence becomes Tuesday', () => {
    const moved = shiftedSeriesStart(SAT, '2026-10-12', '2026-10-13', WEEKDAYS);
    expect(moved).toBe('2026-10-13T00:00:00.000Z');
    const days = expandRecurringEvents(
      [{ id: 'w', date: moved, recurrenceRule: WEEKDAYS }], dayAsLocalDate('2026-10-10')!, dayAsLocalDate('2026-10-16')!,
    ).map((o) => o.recurrenceDate);
    expect(days[0]).toBe('2026-10-13');
  });

  it('without the rule it would have shifted the Saturday — the same Monday, nothing visible', () => {
    // What the call used to do, kept as the contrast: the anchor is what makes the move real.
    expect(shiftedSeriesStart(SAT, '2026-10-12', '2026-10-13')).toBe('2026-10-11T00:00:00.000Z');
  });

  it('a plain daily, weekly or unfiltered series still moves from its stored start', () => {
    expect(shiftedSeriesStart(SAT, '2026-10-12', '2026-10-13', { frequency: 'daily' })).toBe('2026-10-11T00:00:00.000Z');
    expect(shiftedSeriesStart(SAT, '2026-10-17', '2026-10-18', { frequency: 'weekly', onlyOn: 'weekdays' })).toBe('2026-10-11T00:00:00.000Z');
  });
});
