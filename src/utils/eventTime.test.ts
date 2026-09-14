// src/utils/eventTime.test.ts
//
// The thing being pinned is the DST correction. Everything else here is bookkeeping; that one
// piece is where a reminder silently fires an hour out, twice a year, in a way nobody reports as
// a bug because it looks like the app being a bit late.

import { describe, it, expect } from 'vitest';
import {
  COMMON_ZONES, dayOf, displayTime, isValidTime, isValidZone, reminderInstant, startInstant,
  timeFieldsFor, zoneChoices, zoneLabel, zoneOffsetMs,
} from './eventTime';

const BUC = 'Europe/Bucharest';
const UTC = 'UTC';

/** An event as the app stores it: the day at midnight UTC, plus a wall clock and its zone. */
const ev = (day: string, time?: string, timezone?: string, reminderMinutes?: number) => ({
  date: `${day}T00:00:00.000Z`, time, timezone, reminderMinutes,
});

describe('isValidTime', () => {
  it('accepts a 24-hour wall clock', () => {
    for (const t of ['00:00', '09:05', '13:30', '23:59']) expect(isValidTime(t)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const t of ['24:00', '7:30', '19:60', '19', '', null, undefined, 1930, '19:30:00']) {
      expect(isValidTime(t)).toBe(false);
    }
  });
});

describe('zoneOffsetMs — the platform owns the DST rules, not us', () => {
  const H = 3_600_000;

  it('Bucharest is UTC+2 in winter and UTC+3 in summer', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15), BUC)).toBe(2 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15), BUC)).toBe(3 * H);
  });

  it('UTC is always zero', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15), UTC)).toBe(0);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15), UTC)).toBe(0);
  });

  it('handles a half-hour zone', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(5.5 * H);
  });
});

describe('startInstant', () => {
  it('an all-day event has no instant', () => {
    expect(startInstant(ev('2026-09-20'))).toBeNull();
    expect(startInstant(ev('2026-09-20', undefined, BUC))).toBeNull();
  });

  it('19:00 in Bucharest in summer is 16:00 UTC', () => {
    const at = startInstant(ev('2026-07-15', '19:00', BUC));
    expect(new Date(at!).toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('19:00 in Bucharest in winter is 17:00 UTC', () => {
    // The same wall clock, an hour apart in real time. This is the whole reason the offset is
    // read at the instant rather than taken once.
    const at = startInstant(ev('2026-01-15', '19:00', BUC));
    expect(new Date(at!).toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('an evening either side of the spring-forward gets its own offset', () => {
    // True, but NOT what pins the two-pass correction — a single pass gets both of these right.
    // Kept because they are the ordinary case and would catch a wholesale breakage.
    expect(new Date(startInstant(ev('2026-03-28', '23:00', BUC))!).toISOString())
      .toBe('2026-03-28T21:00:00.000Z');
    expect(new Date(startInstant(ev('2026-03-29', '23:00', BUC))!).toISOString())
      .toBe('2026-03-29T20:00:00.000Z');
  });

  it('02:30 on the morning of the spring-forward — the case one pass gets WRONG', () => {
    // Europe/Bucharest goes EET(+2) -> EEST(+3) at 01:00 UTC on 2026-03-29, so 03:00-03:59 local
    // does not exist that day and 02:30 is the last wall time on the old offset.
    //
    // One pass: reads the offset at 02:30 treated as UTC — by then the switch has happened, so it
    // finds +3 and answers 23:30Z on the 28th, which is 01:30 local. An hour early, silently.
    // Two passes: corrects to 23:30Z, re-reads the offset THERE (+2), and answers 00:30Z — 02:30
    // local, which is what was written.
    //
    // Proven by mutation: deleting the second pass turns this red and leaves every other test in
    // this file green.
    const at = startInstant(ev('2026-03-29', '02:30', BUC));
    expect(new Date(at!).toISOString()).toBe('2026-03-29T00:30:00.000Z');
  });

  it('and the same morning, an hour later, is on the NEW offset', () => {
    // 04:00 local exists and is EEST(+3): 01:00Z. Both passes agree here, which is the point —
    // the correction must not disturb the cases that were already right.
    const at = startInstant(ev('2026-03-29', '04:00', BUC));
    expect(new Date(at!).toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('a missing zone falls back rather than guessing the reader’s', () => {
    // Every event saved before this feature has no zone. Treating it as the READER's would move
    // an old event by hours the first time somebody opened the app on holiday.
    const at = startInstant(ev('2026-07-15', '19:00'), UTC);
    expect(new Date(at!).toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });

  it('an unknown zone falls back instead of throwing', () => {
    const at = startInstant({ date: '2026-07-15T00:00:00.000Z', time: '19:00', timezone: 'Mars/Olympus' }, UTC);
    expect(new Date(at!).toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });

  it('a malformed date gives null, not NaN', () => {
    expect(startInstant({ date: 'not a date', time: '19:00', timezone: BUC })).toBeNull();
    expect(startInstant({ date: 123 as unknown, time: '19:00' })).toBeNull();
  });
});

describe('reminderInstant', () => {
  it('subtracts the minutes from the start', () => {
    const at = reminderInstant(ev('2026-07-15', '19:00', BUC, 30));
    expect(new Date(at!).toISOString()).toBe('2026-07-15T15:30:00.000Z');
  });

  it('zero minutes means at the start', () => {
    const at = reminderInstant(ev('2026-07-15', '19:00', BUC, 0));
    expect(new Date(at!).toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('a day before crosses the DST change correctly', () => {
    // 1440 minutes before 23:00 on the 29th — the day between them contains the jump.
    const at = reminderInstant(ev('2026-03-29', '23:00', BUC, 1440));
    expect(new Date(at!).toISOString()).toBe('2026-03-28T20:00:00.000Z');
  });

  it('no reminder, no instant', () => {
    expect(reminderInstant(ev('2026-07-15', '19:00', BUC))).toBeNull();
    expect(reminderInstant(ev('2026-07-15', '19:00', BUC, -5))).toBeNull();
  });

  it('an all-day event has no reminder instant — the case that was firing at 02:30', () => {
    // This is the bug in one line. Before there was a time at all, `date` was midnight UTC and a
    // 30-minute reminder resolved to 23:30 UTC the previous day: half past two in the morning in
    // Bucharest. Now it returns null and the caller decides what an all-day reminder means.
    expect(reminderInstant({ date: '2026-07-15T00:00:00.000Z', reminderMinutes: 30 })).toBeNull();
  });
});

describe('displayTime', () => {
  it('shows the wall clock and names no zone at home', () => {
    expect(displayTime(ev('2026-07-15', '19:00', BUC), BUC)).toEqual({ text: '19:00', zoneNote: null });
  });

  it('converts and names the zone when the reader is elsewhere', () => {
    const shown = displayTime(ev('2026-07-15', '19:00', BUC), 'Europe/London');
    expect(shown).toEqual({ text: '17:00', zoneNote: BUC });
  });

  it('an event with no zone is shown as written, not converted on a guess', () => {
    expect(displayTime(ev('2026-07-15', '19:00'), 'Europe/London'))
      .toEqual({ text: '19:00', zoneNote: null });
  });

  it('an all-day event has nothing to show', () => {
    expect(displayTime(ev('2026-07-15'), BUC)).toBeNull();
  });
});

describe('timeFieldsFor', () => {
  it('writes the clock and the zone it was written in', () => {
    expect(timeFieldsFor('19:00', BUC)).toEqual({ time: '19:00', timezone: BUC });
  });

  it('clearing the time clears the ZONE too', () => {
    // Otherwise an all-day event keeps a zone, claiming a precision it no longer has — and the
    // next reader of `timezone` has no way to know it is stale.
    expect(timeFieldsFor(null, BUC)).toEqual({ time: null, timezone: null });
    expect(timeFieldsFor('', BUC)).toEqual({ time: null, timezone: null });
  });

  it('always writes both keys, so an edit really clears the old value', () => {
    expect(Object.keys(timeFieldsFor(null, BUC)).sort()).toEqual(['time', 'timezone']);
  });
});

describe('the picker', () => {
  it('puts the viewer’s own zone first, even when it is not on the list', () => {
    const choices = zoneChoices('Pacific/Auckland');
    expect(choices[0]).toBe('Pacific/Auckland');
    expect(choices).toContain('Europe/Bucharest');
  });

  it('does not repeat it when it IS on the list', () => {
    const choices = zoneChoices(BUC);
    expect(choices.filter((z) => z === BUC)).toHaveLength(1);
  });

  it('drops a zone this runtime does not know rather than offering a broken choice', () => {
    expect(zoneChoices('Mars/Olympus')).not.toContain('Mars/Olympus');
  });

  it('every zone on the built-in list is real', () => {
    for (const z of COMMON_ZONES) expect(isValidZone(z), z).toBe(true);
  });

  it('labels a zone with the offset people recognise', () => {
    expect(zoneLabel(BUC, Date.UTC(2026, 6, 15))).toBe('Europe/Bucharest (UTC+03:00)');
    expect(zoneLabel(BUC, Date.UTC(2026, 0, 15))).toBe('Europe/Bucharest (UTC+02:00)');
    expect(zoneLabel('Asia/Kolkata', Date.UTC(2026, 0, 15))).toBe('Asia/Kolkata (UTC+05:30)');
  });

  it('labels a negative offset with a minus, not a wrapped positive', () => {
    expect(zoneLabel('America/New_York', Date.UTC(2026, 0, 15))).toBe('America/New York (UTC-05:00)');
  });
});

describe('dayOf', () => {
  it('reads the stored UTC day', () => {
    expect(dayOf('2026-09-20T00:00:00.000Z')).toBe('2026-09-20');
  });

  it('is null for rubbish', () => {
    expect(dayOf('nope')).toBeNull();
  });
});
