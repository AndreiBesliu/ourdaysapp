// src/utils/daySpanLayout.test.ts
//
// A multi-day event is drawn one SLICE per day: the start day from its clock to midnight, middle
// days whole, the end day from midnight to its end clock. The slice knows it is a piece of
// something longer, so the block can say so instead of printing yesterday's start time as today's.
//
// The first block pins that an event with no end — every event saved before today — is laid out
// exactly as before, number for number.

import { describe, it, expect } from 'vitest';
import { layoutDay, sliceInDay, NOMINAL_MINUTES } from './dayLayout';

const BUC = 'Europe/Bucharest';
const LON = 'Europe/London';
const D1 = '2026-09-15';
const D2 = '2026-09-16';
const D3 = '2026-09-17';

const ev = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, date: `${day}T00:00:00.000Z`, ...extra,
});

describe('an event with no end, laid out exactly as before', () => {
  it('is drawn at the nominal length from its start', () => {
    const s = sliceInDay(ev('a', D1, { time: '19:00', timezone: BUC }), D1, BUC)!;
    expect(s).toEqual({ startMin: 19 * 60, endMin: 19 * 60 + NOMINAL_MINUTES, continuesBefore: false, continuesAfter: false });
  });

  it('is clamped to midnight and does not claim to continue', () => {
    const s = sliceInDay(ev('a', D1, { time: '23:30', timezone: BUC }), D1, BUC)!;
    expect(s.endMin).toBe(24 * 60);
    expect(s.continuesAfter).toBe(false);
  });

  it('is not on any other day', () => {
    expect(sliceInDay(ev('a', D1, { time: '19:00' }), D2, BUC)).toBeNull();
  });

  it('still lands in the all-day strip when it has no clock', () => {
    const layout = layoutDay([ev('a', D1)], D1, BUC);
    expect(layout.allDay).toHaveLength(1);
    expect(layout.timed).toHaveLength(0);
  });
});

describe('a same-day event with a real end', () => {
  it('is drawn to its end clock, not a nominal hour', () => {
    const s = sliceInDay(ev('a', D1, { time: '09:00', endTime: '11:30', timezone: BUC }), D1, BUC)!;
    expect(s.startMin).toBe(9 * 60);
    expect(s.endMin).toBe(11 * 60 + 30);
  });

  it('now genuinely overlaps a later event it used to merely touch', () => {
    // a 09:00–11:00 and b at 10:00 share an hour, so they need two columns.
    const layout = layoutDay([
      ev('a', D1, { time: '09:00', endTime: '11:00', timezone: BUC }),
      ev('b', D1, { time: '10:00', timezone: BUC }),
    ], D1, BUC);
    expect(layout.timed.map((p) => p.lanes)).toEqual([2, 2]);
  });

  it('converts both ends for a reader in another zone', () => {
    // 19:00–23:30 in Bucharest is 17:00–21:30 in London, in September.
    const s = sliceInDay(ev('a', D1, { time: '19:00', endTime: '23:30', timezone: BUC }), D1, LON)!;
    expect([s.startMin, s.endMin]).toEqual([17 * 60, 21 * 60 + 30]);
  });
});

describe('a party that runs past midnight', () => {
  const party = ev('p', D1, { time: '22:00', endDayOffset: 1, endTime: '02:00', timezone: BUC });

  it('on its first day runs from its start to midnight and says it goes on', () => {
    const s = sliceInDay(party, D1, BUC)!;
    expect(s).toEqual({ startMin: 22 * 60, endMin: 24 * 60, continuesBefore: false, continuesAfter: true });
  });

  it('on its second day runs from midnight to its end and says it began earlier', () => {
    const s = sliceInDay(party, D2, BUC)!;
    expect(s).toEqual({ startMin: 0, endMin: 2 * 60, continuesBefore: true, continuesAfter: false });
  });

  it('is on no third day', () => {
    expect(sliceInDay(party, D3, BUC)).toBeNull();
  });

  it('is laid out on both days by layoutDay, once each', () => {
    expect(layoutDay([party], D1, BUC).timed).toHaveLength(1);
    expect(layoutDay([party], D2, BUC).timed).toHaveLength(1);
    expect(layoutDay([party], D2, BUC).timed[0].continuesBefore).toBe(true);
  });

  it('shifts correctly for a reader two hours west', () => {
    // 22:00–02:00 Bucharest is 20:00–00:00 London, so on London's 15th the block is 20:00–24:00 and
    // on the 16th there is nothing of it left to draw.
    //
    // `continuesAfter` stays TRUE there: it says which day of the EVENT this is, not what the
    // reader's clock makes of it. An earlier draft derived it from instants in the reader's zone,
    // which read better here and made legacy events in another zone vanish from the grid entirely
    // — see `wallMinutes`. A flag that is occasionally generous is worth an event that is never lost.
    const first = sliceInDay(party, D1, LON)!;
    expect([first.startMin, first.endMin, first.continuesAfter]).toEqual([20 * 60, 24 * 60, true]);
    expect(sliceInDay(party, D2, LON)).toBeNull();
  });
});

describe('a three-day event', () => {
  const trip = ev('t', D1, { time: '10:00', endDayOffset: 2, endTime: '16:00', timezone: BUC });

  it('fills its middle day and continues in both directions', () => {
    const s = sliceInDay(trip, D2, BUC)!;
    expect(s).toEqual({ startMin: 0, endMin: 24 * 60, continuesBefore: true, continuesAfter: true });
  });

  it('ends at its end clock on the last day', () => {
    const s = sliceInDay(trip, D3, BUC)!;
    expect([s.startMin, s.endMin, s.continuesBefore, s.continuesAfter]).toEqual([0, 16 * 60, true, false]);
  });
});

describe('a multi-day event with no end clock', () => {
  it('runs to the end of its last day, not one hour into it', () => {
    const e = ev('e', D1, { time: '10:00', endDayOffset: 1, timezone: BUC });
    expect(sliceInDay(e, D1, BUC)!.endMin).toBe(24 * 60);
    const last = sliceInDay(e, D2, BUC)!;
    expect([last.startMin, last.endMin, last.continuesAfter]).toEqual([0, 24 * 60, false]);
  });
});

describe('what layoutDay does with things it should not draw', () => {
  it('skips a timed event that is not on the requested day', () => {
    const layout = layoutDay([ev('a', D1, { time: '19:00' })], D2, BUC);
    expect(layout.timed).toHaveLength(0);
    expect(layout.allDay).toHaveLength(0);
  });

  it('still draws a row whose date is unreadable but whose clock is not', () => {
    // At its wall clock, at the nominal length — exactly what happened before spans existed.
    // Filing it under "all day" instead would have hidden the only time it has, and would have
    // contradicted dayLayout.test.ts, which pins minutesInDay answering for this very row.
    const layout = layoutDay([{ id: 'x', title: 'x', date: 'not a date', time: '19:00' }], D1, BUC);
    expect(layout.allDay).toHaveLength(0);
    expect(layout.timed).toHaveLength(1);
    expect(layout.timed[0].startMin).toBe(19 * 60);
  });

  it('puts an all-day span in the strip on every day it covers', () => {
    const allDay = ev('h', D1, { endDayOffset: 2 });
    for (const d of [D1, D2, D3]) expect(layoutDay([allDay], d, BUC).allDay).toHaveLength(1);
  });
});
