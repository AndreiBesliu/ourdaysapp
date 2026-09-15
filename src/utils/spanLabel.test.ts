// src/utils/spanLabel.test.ts
//
// The label beside a block on day two of a party that ran past midnight used to be the party's
// start time. These pin what each day of an event says about itself.

import { describe, it, expect } from 'vitest';
import { spanClockLabel, spanRangeLabel } from './spanLabel';

const BUC = 'Europe/Bucharest';
const LON = 'Europe/London';
const ev = (day: string, extra: Record<string, unknown> = {}) => ({ date: `${day}T00:00:00.000Z`, ...extra });

describe('the clock label, day by day', () => {
  const party = ev('2026-09-15', { time: '22:00', endDayOffset: 1, endTime: '02:00', timezone: BUC });

  it('on the first day shows the start and that it goes on', () => {
    expect(spanClockLabel(party, '2026-09-15', BUC)).toEqual({ text: '22:00 ▸', zoneNote: null });
  });

  it('on the last day shows that it began earlier and when it ends', () => {
    expect(spanClockLabel(party, '2026-09-16', BUC)).toEqual({ text: '◂ → 02:00', zoneNote: null });
  });

  it('on a middle day says only that it runs through', () => {
    const trip = ev('2026-09-15', { time: '10:00', endDayOffset: 2, endTime: '16:00', timezone: BUC });
    expect(spanClockLabel(trip, '2026-09-16', BUC)!.text).toBe('◂ … ▸');
  });

  it('for a same-day event shows both clocks', () => {
    expect(spanClockLabel(ev('2026-09-15', { time: '09:00', endTime: '11:30' }), '2026-09-15', BUC)!.text).toBe('09:00 – 11:30');
  });

  it('for an event with no end shows only the start, as it always did', () => {
    expect(spanClockLabel(ev('2026-09-15', { time: '09:00' }), '2026-09-15', BUC)!.text).toBe('09:00');
  });

  it('is null for an all-day event, which has no clock to label', () => {
    expect(spanClockLabel(ev('2026-09-15', { endDayOffset: 2 }), '2026-09-16', BUC)).toBeNull();
  });

  it('on a continuation day with no end clock says only that it began earlier', () => {
    expect(spanClockLabel(ev('2026-09-15', { time: '10:00', endDayOffset: 1 }), '2026-09-16', BUC)!.text).toBe('◂');
  });

  it('converts both clocks for a reader in another zone and names the zone once', () => {
    const e = ev('2026-09-15', { time: '19:00', endTime: '23:30', timezone: BUC });
    expect(spanClockLabel(e, '2026-09-15', LON)).toEqual({ text: '17:00 – 21:30', zoneNote: BUC });
  });
});

describe('the whole range, for the details view', () => {
  it('describes a same-day event with both clocks', () => {
    const r = spanRangeLabel(ev('2026-09-15', { time: '09:00', endTime: '11:30' }), BUC)!;
    expect(r).toEqual({ startDay: '2026-09-15', endDay: '2026-09-15', sameDay: true, clocks: '09:00 – 11:30', zoneNote: null });
  });

  it('describes a multi-day event with an arrow between its clocks', () => {
    const r = spanRangeLabel(ev('2026-09-15', { time: '22:00', endDayOffset: 1, endTime: '02:00' }), BUC)!;
    expect([r.startDay, r.endDay, r.sameDay, r.clocks]).toEqual(['2026-09-15', '2026-09-16', false, '22:00 → 02:00']);
  });

  it('describes an all-day span with days and no clocks', () => {
    const r = spanRangeLabel(ev('2026-09-15', { endDayOffset: 2 }), BUC)!;
    expect([r.startDay, r.endDay, r.sameDay, r.clocks]).toEqual(['2026-09-15', '2026-09-17', false, null]);
  });

  it('describes yesterday\'s events exactly as before', () => {
    const r = spanRangeLabel(ev('2026-09-15', { time: '19:00' }), BUC)!;
    expect([r.sameDay, r.clocks]).toEqual([true, '19:00']);
  });
});
