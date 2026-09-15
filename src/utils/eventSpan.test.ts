// src/utils/eventSpan.test.ts
//
// An event may end on a later day than it starts. The end is stored RELATIVE to the start —
// `endDayOffset` whole days plus an `endTime` wall clock in the event's own zone — and these
// tests pin the three things that follow from that choice:
//
//   1. every occurrence of a series carries the same span, because it inherits the offset;
//   2. an occurrence that started before the visible window but is still running is shown;
//   3. an event that never had an end behaves exactly as it always did.

import { describe, it, expect } from 'vitest';
import {
  MAX_SPAN_DAYS, isValidDayOffset, dayPlus, spanOf, occursOn, daysOf,
  endInstant, startInstant, spanProblem, endFieldsFor, timeFieldsFor,
} from './eventTime';
import { expandRecurringEvents } from './recurrence';

const BUC = 'Europe/Bucharest';

const ev = (day: string, extra: Record<string, unknown> = {}) => ({
  date: `${day}T00:00:00.000Z`, ...extra,
});

describe('an event with no end field, which is every event saved before today', () => {
  it('spans exactly its own day', () => {
    expect(spanOf(ev('2026-09-15'))).toEqual({ startDay: '2026-09-15', endDay: '2026-09-15', offset: 0, endTime: null });
    expect(daysOf(ev('2026-09-15'))).toEqual(['2026-09-15']);
  });

  it('is on its day and on no other', () => {
    expect(occursOn(ev('2026-09-15'), '2026-09-15')).toBe(true);
    expect(occursOn(ev('2026-09-15'), '2026-09-14')).toBe(false);
    expect(occursOn(ev('2026-09-15'), '2026-09-16')).toBe(false);
  });

  it('has no end instant', () => {
    expect(endInstant(ev('2026-09-15', { time: '19:00', timezone: BUC }))).toBeNull();
    expect(endInstant(ev('2026-09-15'))).toBeNull();
  });

  it('has nothing wrong with it', () => {
    expect(spanProblem(ev('2026-09-15', { time: '19:00' }))).toBeNull();
    expect(spanProblem(ev('2026-09-15'))).toBeNull();
  });
});

describe('a span of several days', () => {
  const trip = ev('2026-09-15', { endDayOffset: 2 }); // 15, 16, 17

  it('covers every day from the first to the last, inclusive', () => {
    expect(daysOf(trip)).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    for (const d of ['2026-09-15', '2026-09-16', '2026-09-17']) expect(occursOn(trip, d)).toBe(true);
    expect(occursOn(trip, '2026-09-14')).toBe(false);
    expect(occursOn(trip, '2026-09-18')).toBe(false);
  });

  it('crosses a month and a year boundary without a calendar library', () => {
    expect(dayPlus('2026-01-31', 1)).toBe('2026-02-01');
    expect(dayPlus('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayPlus('2028-02-28', 1)).toBe('2028-02-29'); // leap
    expect(daysOf(ev('2026-12-30', { endDayOffset: 2 }))).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('refuses a nonsense offset and treats it as one day', () => {
    for (const bad of [-1, 1.5, MAX_SPAN_DAYS + 1, '2', null, undefined, NaN, Infinity]) {
      expect(isValidDayOffset(bad)).toBe(false);
    }
    expect(spanOf(ev('2026-09-15', { endDayOffset: -1 }))!.offset).toBe(0);
    expect(spanOf(ev('2026-09-15', { endDayOffset: '2' }))!.offset).toBe(0);
  });

  it('accepts the whole legal range', () => {
    expect(isValidDayOffset(0)).toBe(true);
    expect(isValidDayOffset(MAX_SPAN_DAYS)).toBe(true);
  });
});

describe('the end instant of a timed span', () => {
  it('lands on the end day at the end wall clock, in the event zone', () => {
    // 22:00 Bucharest on the 15th until 02:00 Bucharest on the 16th: four hours.
    const party = ev('2026-09-15', { time: '22:00', endDayOffset: 1, endTime: '02:00', timezone: BUC });
    const start = startInstant(party, BUC)!;
    const end = endInstant(party, BUC)!;
    expect(end - start).toBe(4 * 3_600_000);
  });

  it('is DST-correct across the spring-forward night', () => {
    // Bucharest moves 03:00 -> 04:00 on Sunday 29 March 2026. 23:00 Saturday to 04:00 Sunday is
    // five hours of clock and FOUR of elapsed time.
    const night = ev('2026-03-28', { time: '23:00', endDayOffset: 1, endTime: '04:00', timezone: BUC });
    const start = startInstant(night, BUC)!;
    const end = endInstant(night, BUC)!;
    expect(end - start).toBe(4 * 3_600_000);
  });

  it('needs both clocks; a start without an end has no end instant', () => {
    expect(endInstant(ev('2026-09-15', { time: '22:00', endDayOffset: 1, timezone: BUC }))).toBeNull();
    expect(endInstant(ev('2026-09-15', { endDayOffset: 1, endTime: '02:00', timezone: BUC }))).toBeNull();
  });
});

describe('what cannot be saved', () => {
  it('a same-day event that ends before it starts', () => {
    expect(spanProblem({ time: '19:00', endTime: '18:00' })).toBe('ends-before-start');
    expect(spanProblem({ time: '19:00', endTime: '19:00' })).toBe('ends-before-start');
  });

  it('the same clocks on a later day are fine — that is the whole point', () => {
    expect(spanProblem({ time: '19:00', endDayOffset: 1, endTime: '18:00' })).toBeNull();
    expect(spanProblem({ time: '22:00', endDayOffset: 1, endTime: '02:00' })).toBeNull();
  });

  it('an end time on an event with no start time', () => {
    expect(spanProblem({ endTime: '18:00' })).toBe('end-without-start');
  });

  it('an offset that is not a whole day in range', () => {
    expect(spanProblem({ endDayOffset: -1 })).toBe('offset');
    expect(spanProblem({ endDayOffset: 1.5 })).toBe('offset');
    expect(spanProblem({ endDayOffset: MAX_SPAN_DAYS + 1 })).toBe('offset');
  });

  it('a malformed end clock', () => {
    expect(spanProblem({ time: '19:00', endTime: '25:00' })).toBe('ends-before-start');
  });
});

describe('what gets written', () => {
  it('writes null, not 0, for a same-day end, so old and new events look alike', () => {
    expect(endFieldsFor(0, null, true)).toEqual({ endDayOffset: null, endTime: null });
    expect(endFieldsFor(undefined, undefined, false)).toEqual({ endDayOffset: null, endTime: null });
  });

  it('writes a real span', () => {
    expect(endFieldsFor(2, '18:00', true)).toEqual({ endDayOffset: 2, endTime: '18:00' });
    expect(endFieldsFor(2, null, false)).toEqual({ endDayOffset: 2, endTime: null });
  });

  it('drops an end time when there is no start time', () => {
    expect(endFieldsFor(1, '18:00', false)).toEqual({ endDayOffset: 1, endTime: null });
  });

  it('drops garbage rather than writing it', () => {
    expect(endFieldsFor(-3, 'soon', true)).toEqual({ endDayOffset: null, endTime: null });
  });

  it('leaves timeFieldsFor exactly as its own test pins it', () => {
    expect(Object.keys(timeFieldsFor('19:00', BUC)).sort()).toEqual(['time', 'timezone']);
  });
});

describe('a recurring series with a span', () => {
  const WEEKLY = {
    id: 'w', title: 'Weekend away', date: '2026-09-04T00:00:00.000Z',
    recurrenceRule: { frequency: 'weekly' as const }, endDayOffset: 2, // Fri, Sat, Sun
  };
  const expand = (from: string, to: string) =>
    expandRecurringEvents([WEEKLY as never], new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`));

  it('gives every occurrence the same span, inherited from the series', () => {
    const occ = expand('2026-09-01', '2026-09-30');
    expect(occ.length).toBeGreaterThan(2);
    for (const o of occ) {
      expect(o.endDayOffset).toBe(2);
      expect(daysOf(o)).toHaveLength(3);
    }
  });

  it('shows an occurrence that started before the window but is still running', () => {
    // The occurrence starts Friday 11 Sept; the window opens Saturday 12 Sept.
    const occ = expand('2026-09-12', '2026-09-13');
    expect(occ.map((o) => o.recurrenceDate)).toContain('2026-09-11');
  });

  it('still hides a single-day occurrence that ended before the window', () => {
    // Same series without a span: the Friday occurrence is over by Saturday.
    const single = { ...WEEKLY, endDayOffset: 0 };
    const occ = expandRecurringEvents([single as never], new Date('2026-09-12T00:00:00.000Z'), new Date('2026-09-13T00:00:00.000Z'));
    expect(occ.map((o) => o.recurrenceDate)).not.toContain('2026-09-11');
  });
});

describe('an occurrence agreeing with itself', () => {
  // Found by an adversarial review, then measured: `advanceDate` is date-fns, which steps the LOCAL
  // calendar, so from a spring DST change onward the walked instant drifts to 23:00Z. The expander
  // used to emit that instant as `date` while labelling the row `recurrenceDate` from the same
  // instant formatted LOCALLY — so the document contradicted itself. Under Europe/Bucharest the
  // first five occurrences of a daily series from 25 March agreed and every one after did not:
  // `recurrenceDate: '2026-03-30'` beside `date: '2026-03-29T23:00:00.000Z'`.
  //
  // Rendering that compared the raw instant in local time happened to agree with the label, which
  // is why nobody saw it; anything reading the DAY out of `date` — as occursOn does — did not.
  //
  // NOTE ON WHERE THIS BITES: in UTC there is no drift, so on a UTC runner these assertions would
  // also have passed before the fix. They bite where the developer sits, and they state the
  // contract either way: an occurrence's date is midnight UTC of its own label.
  const daily = {
    id: 'd', title: 'Daily', date: '2026-03-25T00:00:00.000Z',
    recurrenceRule: { frequency: 'daily' as const },
  };
  const occ = expandRecurringEvents(
    [daily as never], new Date('2026-03-25T00:00:00.000Z'), new Date('2026-04-02T00:00:00.000Z'),
  );

  it('emits more than one occurrence, so the rest is not vacuous', () => {
    expect(occ.length).toBeGreaterThan(5);
  });

  it('puts every occurrence at midnight UTC of its own day label', () => {
    for (const o of occ) {
      expect(o.date).toBe(`${o.recurrenceDate}T00:00:00.000Z`);
    }
  });

  it('is on the day it says it is', () => {
    for (const o of occ) {
      expect(occursOn(o, o.recurrenceDate)).toBe(true);
      expect(spanOf(o)!.startDay).toBe(o.recurrenceDate);
    }
  });

  it('never puts two occurrences of a daily series on one day', () => {
    const days = occ.map((o) => o.recurrenceDate);
    expect(new Set(days).size).toBe(days.length);
  });
});
