// src/utils/recurrenceZones.test.ts
//
// Recurrence, run under TWO time zones — Bucharest and New York — by `npm run test:tz`, and
// checked from BOTH sides: the calendar's `expandRecurringEvents` and the server's
// `expandInWindow`, which drives reminders, the digest and the log. A series has one set of dates;
// the two used to disagree, and in some cases both were wrong.
//
// ── Why two zones, and why not the ordinary run ─────────────────────────────────────────────
//
// CI runs in UTC, where every one of these defects is invisible: a local formatter and a UTC one
// print the same day. Bucharest crosses its DST change in March and October; New York sits WEST
// of Greenwich, where reading a stored midnight-UTC instant locally lands on the previous evening.
//
// The cases were written against the defects measured on 24.09.2026, and the failing run is
// recorded in the DEVLOG. Not every case failed on the old code — some pin a side that was already
// right, so the two cannot drift apart again. A zone test that was only ever green would prove
// nothing about zones; this file's claim is that each DEFECT has a case that fails without its fix.

import { describe, it, expect } from 'vitest';
import { expandRecurringEvents, shiftedSeriesStart, getRecurrenceEndDate } from './recurrence';
import { seriesStartDay } from './recurrenceCore';
import { dayAsLocalDate } from './dayLabel';
import { expandInWindow } from '../../functions/src/recurrenceServer';

// The runner sets both. If TZ did not take effect this process is testing the wrong thing, and
// must say so rather than pass.
const EXPECTED = process.env.EXPECT_TZ;
const ACTUAL = Intl.DateTimeFormat().resolvedOptions().timeZone;

type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

function series(id: string, date: string, frequency: Freq, extra: Record<string, unknown> = {}) {
  return { id, date, recurrenceRule: { frequency }, ...extra };
}

function endOfLocalDay(day: string): Date {
  const d = dayAsLocalDate(day)!;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** The calendar's answer: the day LABELS it would show. */
function clientDays(ev: Record<string, unknown>, from: string, to: string): string[] {
  return expandRecurringEvents([ev], dayAsLocalDate(from)!, endOfLocalDay(to))
    .map((o) => o.recurrenceDate as string);
}

/** The server's answer. */
function serverDays(ev: Record<string, unknown>, from: string, to: string): string[] {
  return expandInWindow([ev as never], from, to).map((o) => o.day);
}

function both(ev: Record<string, unknown>, from: string, to: string) {
  return { client: clientDays(ev, from, to), server: serverDays(ev, from, to) };
}

describe(`recurrence under ${ACTUAL}`, () => {
  it('runs in the zone it was asked to', () => {
    if (EXPECTED) expect(ACTUAL).toBe(EXPECTED);
  });

  it('weekly: the same days on both sides, west of Greenwich included', () => {
    // Measured in New York before the repair: the calendar showed 19, 26, 3, 10 — a day early —
    // while the server expanded 20, 27, 4, 11. An exception written from New York then failed to
    // hide the occurrence for anybody reading from Bucharest.
    const want = ['2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'];
    const { client, server } = both(series('w', '2026-09-20T00:00:00.000Z', 'weekly'), '2026-09-01', '2026-10-15');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('weekly across the March DST change', () => {
    const want = ['2026-03-18', '2026-03-25', '2026-04-01', '2026-04-08'];
    const { client, server } = both(series('w2', '2026-03-18T00:00:00.000Z', 'weekly'), '2026-03-01', '2026-04-10');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('daily across the October DST change', () => {
    const want = Array.from({ length: 11 }, (_, i) => `2026-10-${String(20 + i).padStart(2, '0')}`);
    const { client, server } = both(series('d', '2026-10-20T00:00:00.000Z', 'daily'), '2026-10-20', '2026-10-30');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('monthly on the 31st keeps coming back to the 31st', () => {
    // Stepping from the PREVIOUS occurrence clamped once and stayed clamped: 31, 28, 28, 28 … on
    // both sides. Every occurrence is now computed from the series start.
    const want = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'];
    const { client, server } = both(series('m', '2026-01-31T00:00:00.000Z', 'monthly'), '2026-01-01', '2026-06-30');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('yearly on 29 February comes back to the 29th in a leap year', () => {
    // It used to land on the 28th in 2029 and stay there for ever.
    const want = ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'];
    const { client, server } = both(series('y', '2028-02-29T00:00:00.000Z', 'yearly'), '2028-01-01', '2032-12-31');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('moving a series across the March DST change keeps its weekday', () => {
    // Measured in Bucharest before the repair: a Wednesday series moved one week stored
    // 2026-03-31T23:00:00Z. The calendar kept showing Wednesdays; the server expanded TUESDAYS —
    // so reminders, the digest and the log all came a day early.
    const moved = shiftedSeriesStart('2026-03-25T00:00:00.000Z', '2026-03-25', '2026-04-01');
    expect(moved).toBe('2026-04-01T00:00:00.000Z');
    const want = ['2026-04-01', '2026-04-08', '2026-04-15'];
    const { client, server } = both(series('mv', moved!, 'weekly'), '2026-03-25', '2026-04-15');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });

  it('a series ALREADY stored that way is read as the day it was meant to be', () => {
    // Documents written by the old code carry 23:00Z (or 01:00Z) — midnight moved by one DST hour.
    // Read at the nearest midnight, they recover the intended day on both sides.
    const want = ['2026-04-01', '2026-04-08'];
    const { client, server } = both(series('legacy', '2026-03-31T23:00:00.000Z', 'weekly'), '2026-03-25', '2026-04-10');
    expect(client).toEqual(want);
    expect(server).toEqual(want);
  });
});

/** The day a LOCAL formatter would print for this Date. */
function localLabel(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe(`"repeats until" under ${ACTUAL}`, () => {
  it('prints the day the calendar actually stops on', () => {
    // The last occurrence the expansion produces is the day the text promises.
    const start = '2026-07-01';
    const end = localLabel(getRecurrenceEndDate(start, 'daily'));
    expect(end).toBe('2026-07-31');
    expect(clientDays(series('d', `${start}T00:00:00.000Z`, 'daily'), '2026-07-25', '2026-08-05').at(-1)).toBe(end);
  });

  it('the series panel, in Bucharest summer, does not print the day before', () => {
    // The panel used to pass a LOCAL midnight Date, read back as its UTC day: 21:00Z on 30 June in
    // Bucharest summer, so every series there "ended" a day early. It now passes the start label.
    const stored = '2026-07-01T00:00:00.000Z';
    expect(localLabel(getRecurrenceEndDate(seriesStartDay(stored), 'weekly'))).toBe('2027-06-30');
    expect(localLabel(getRecurrenceEndDate(seriesStartDay(stored), 'monthly'))).toBe('2027-07-01');
    expect(localLabel(getRecurrenceEndDate(seriesStartDay(stored), 'yearly'))).toBe('2031-07-01');
  });

  it('says nothing rather than a wrong date when there is no start', () => {
    expect(getRecurrenceEndDate(null, 'daily')).toBeNull();
    expect(getRecurrenceEndDate('', 'daily')).toBeNull();
    expect(getRecurrenceEndDate('01.07.2026', 'daily')).toBeNull();
  });
});
