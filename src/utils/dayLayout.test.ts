// src/utils/dayLayout.test.ts
//
// Overlap is the case worth pinning. Two events drawn on top of each other do not look crowded —
// the one underneath is invisible, and nobody files a bug about an appointment they cannot see.

import { describe, it, expect } from 'vitest';
import { layoutDay, minutesInDay, NOMINAL_MINUTES, visibleHours } from './dayLayout';

const DAY = '2026-07-15';
const BUC = 'Europe/Bucharest';
const LON = 'Europe/London';

const ev = (id: string, time?: string, timezone?: string, title = id) => ({
  id, title, date: `${DAY}T00:00:00.000Z`, time, timezone,
});

describe('minutesInDay', () => {
  it('an all-day event has no position', () => {
    expect(minutesInDay(ev('a'), DAY, BUC)).toBeNull();
  });

  it('at home, the wall clock IS the position', () => {
    expect(minutesInDay(ev('a', '19:00', BUC), DAY, BUC)).toBe(19 * 60);
  });

  it('converts for a reader in another zone', () => {
    // 19:00 in Bucharest is 17:00 in London, in July.
    expect(minutesInDay(ev('a', '19:00', BUC), DAY, LON)).toBe(17 * 60);
  });

  it('an event with NO zone is placed as written, not converted on a guess', () => {
    // Everything saved before the clock shipped is in this branch. Assuming a zone would slide it
    // across the day for anybody not in that zone.
    expect(minutesInDay(ev('a', '19:00'), DAY, LON)).toBe(19 * 60);
  });

  it('an unusable row has no position rather than landing at midnight', () => {
    // Midnight would look like a real 00:00 appointment. The all-day strip is honest instead.
    expect(minutesInDay({ date: 'rubbish', time: '19:00', timezone: BUC }, DAY, BUC)).toBe(19 * 60);
    expect(minutesInDay(ev('a', '25:00', BUC), DAY, BUC)).toBeNull();
  });
});

describe('splitting the day', () => {
  it('timed events go on the grid, the rest into the strip', () => {
    const { allDay, timed } = layoutDay([ev('a'), ev('b', '09:00', BUC)], DAY, BUC);
    expect(allDay.map((e) => e.id)).toEqual(['a']);
    expect(timed.map((p) => p.event.id)).toEqual(['b']);
  });

  it('blocks get a nominal length, because there is no end time yet', () => {
    const [p] = layoutDay([ev('a', '09:00', BUC)], DAY, BUC).timed;
    expect(p.endMin - p.startMin).toBe(NOMINAL_MINUTES);
  });

  it('a late event is clamped to the end of the day rather than drawn past it', () => {
    const [p] = layoutDay([ev('a', '23:30', BUC)], DAY, BUC).timed;
    expect(p.endMin).toBe(24 * 60);
  });

  it('orders by start', () => {
    const { timed } = layoutDay([ev('c', '18:00', BUC), ev('a', '09:00', BUC)], DAY, BUC);
    expect(timed.map((p) => p.event.id)).toEqual(['a', 'c']);
  });
});

describe('overlap — the case that makes an event invisible', () => {
  it('two at the same time take two columns', () => {
    const { timed } = layoutDay([ev('a', '09:00', BUC), ev('b', '09:00', BUC)], DAY, BUC);
    expect(timed.map((p) => p.lane).sort()).toEqual([0, 1]);
    expect(timed.every((p) => p.lanes === 2)).toBe(true);
  });

  it('three at the same time take three', () => {
    const { timed } = layoutDay(
      [ev('a', '09:00', BUC), ev('b', '09:00', BUC), ev('c', '09:15', BUC)], DAY, BUC);
    expect(new Set(timed.map((p) => p.lane)).size).toBe(3);
    expect(timed.every((p) => p.lanes === 3)).toBe(true);
  });

  it('every block in one cluster reports the SAME column count', () => {
    // Otherwise two side-by-side blocks are drawn at different widths and stop lining up.
    const { timed } = layoutDay(
      [ev('a', '09:00', BUC), ev('b', '09:30', BUC), ev('c', '10:15', BUC)], DAY, BUC);
    expect(new Set(timed.map((p) => p.lanes)).size).toBe(1);
  });

  it('events that do not overlap share one column', () => {
    const { timed } = layoutDay([ev('a', '09:00', BUC), ev('b', '11:00', BUC)], DAY, BUC);
    expect(timed.every((p) => p.lane === 0 && p.lanes === 1)).toBe(true);
  });

  it('TOUCHING is not overlapping', () => {
    // One ends at 10:00, the next starts at 10:00. They share a boundary, not a minute — forcing
    // two columns would halve both blocks for nothing.
    const { timed } = layoutDay([ev('a', '09:00', BUC), ev('b', '10:00', BUC)], DAY, BUC);
    expect(timed.every((p) => p.lanes === 1)).toBe(true);
  });

  it('a later cluster is not widened by an earlier one', () => {
    const { timed } = layoutDay(
      [ev('a', '09:00', BUC), ev('b', '09:00', BUC), ev('z', '15:00', BUC)], DAY, BUC);
    expect(timed.find((p) => p.event.id === 'z')!.lanes).toBe(1);
  });

  it('a freed column is reused rather than growing the cluster for ever', () => {
    const { timed } = layoutDay(
      [ev('a', '09:00', BUC), ev('b', '09:30', BUC), ev('c', '10:00', BUC)], DAY, BUC);
    // c starts as a ends, so it takes a's column back: two columns, not three.
    expect(Math.max(...timed.map((p) => p.lanes))).toBe(2);
  });

  it('is stable across renders for events at the same minute', () => {
    const once = layoutDay([ev('b', '09:00', BUC), ev('a', '09:00', BUC)], DAY, BUC);
    const twice = layoutDay([ev('a', '09:00', BUC), ev('b', '09:00', BUC)], DAY, BUC);
    expect(once.timed.map((p) => `${p.event.id}:${p.lane}`))
      .toEqual(twice.timed.map((p) => `${p.event.id}:${p.lane}`));
  });
});

describe('which hours to draw', () => {
  it('a sensible band when the day is empty, so the grid does not jump about', () => {
    expect(visibleHours({ allDay: [], timed: [] })).toEqual({ from: 7, to: 22 });
  });

  it('widens for something early', () => {
    const layout = layoutDay([ev('a', '05:30', BUC)], DAY, BUC);
    expect(visibleHours(layout).from).toBe(5);
  });

  it('widens for something late', () => {
    const layout = layoutDay([ev('a', '23:30', BUC)], DAY, BUC);
    expect(visibleHours(layout).to).toBe(23);
  });

  it('an event ending exactly on the hour does not pull in an empty extra row', () => {
    const layout = layoutDay([ev('a', '21:00', BUC)], DAY, BUC); // ends 22:00
    expect(visibleHours(layout).to).toBe(22);
  });

  it('never runs past the end of the day', () => {
    const layout = layoutDay([ev('a', '23:45', BUC)], DAY, BUC);
    const { from, to } = visibleHours(layout);
    expect(to).toBeLessThanOrEqual(23);
    expect(from).toBeLessThanOrEqual(to);
  });
});
