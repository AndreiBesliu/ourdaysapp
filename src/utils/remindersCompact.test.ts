// src/utils/remindersCompact.test.ts
//
// The reminder job reads only REMINDER_FIELDS and reduces each event to a bounded copy on arrival
// (functions/src/remindersCore.ts, 12.10.2026): a personal event's fields are not checked by the
// rules, and the job keeps thousands of candidates together. Two promises, pinned here:
//   1. for every event the app writes, the reminders come out exactly as they did from the whole
//      document — a field the computation reads and the list leaves out would change them quietly;
//   2. whatever an event holds, the copy is small.

import { describe, it, expect, vi } from 'vitest';
import { REMINDER_FIELDS, compactEvent, dueIn, sendOrder } from '../../functions/src/remindersCore';
import { isValidZone, zoneOffsetMs } from '../../functions/src/eventTime';
import { expandInWindow } from '../../functions/src/recurrenceServer';

const FROM_DAY = '2026-07-08';
const TO_DAY = '2026-08-12';
const OWNER = 'uid-owner';
const ANA = 'uid-ana';
const BUC = 'Europe/Bucharest';
const NY = 'America/Argentina/ComodRivadavia'; // a long real zone: 32 characters

/** Events as the app writes them: every field the computation reads, in the shapes it reads. */
const EVENTS: Array<Record<string, unknown> & { id: string }> = [
  { id: 'plain', ownerId: OWNER, groupId: 'g1', title: 'Dentist', date: '2026-07-15T00:00:00.000Z', time: '19:00', timezone: BUC, reminderMinutes: 30, assigneeIds: [OWNER, ANA], assigneeId: ANA, recurrenceRule: null, recurrenceExceptions: [] },
  { id: 'allday', ownerId: ANA, groupId: null, title: 'Birthday', date: '2026-07-20T00:00:00.000Z', reminderMinutes: 1440, assigneeIds: [ANA] },
  // The older single assignee, alone.
  { id: 'nozone', ownerId: OWNER, title: 'Call', date: '2026-07-21T00:00:00.000Z', time: '08:15', reminderMinutes: 0, assigneeId: ANA },
  { id: 'longzone', ownerId: OWNER, title: 'Flight', date: '2026-07-22T00:00:00.000Z', time: '06:00', timezone: NY, reminderMinutes: 60 },
  { id: 'span', ownerId: OWNER, groupId: 'g1', title: 'Trip', date: '2026-07-06T00:00:00.000Z', endDayOffset: 4, reminderMinutes: 0 },
  { id: 'daily', ownerId: OWNER, groupId: 'g1', title: 'Pills', date: '2026-07-01T00:00:00.000Z', time: '09:00', timezone: BUC, reminderMinutes: 5, recurrenceRule: { frequency: 'daily' }, recurrenceExceptions: ['2026-07-10', '2026-07-12', '2026-05-01'] },
  { id: 'weekdays', ownerId: ANA, title: 'Standup', date: '2026-07-01T00:00:00.000Z', time: '10:00', timezone: BUC, reminderMinutes: 10, recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' }, recurrenceExceptions: [] },
  { id: 'weekly', ownerId: OWNER, groupId: 'g1', title: 'Football', date: '2026-01-06T00:00:00.000Z', time: '18:30', timezone: BUC, reminderMinutes: 120, assigneeIds: [ANA], recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: ['2026-07-13', '2026-07-21'] },
  { id: 'late', ownerId: OWNER, title: 'Night shift', date: '2026-06-01T23:00:00.000Z', time: '23:30', timezone: BUC, reminderMinutes: 15, recurrenceRule: { frequency: 'weekly' } },
  { id: 'monthly', ownerId: ANA, title: 'Rent', date: '2025-12-31T00:00:00.000Z', reminderMinutes: 2880, recurrenceRule: { frequency: 'monthly' } },
  { id: 'yearly', ownerId: OWNER, title: 'Anniversary', date: '2022-07-25T00:00:00.000Z', reminderMinutes: 0, recurrenceRule: { frequency: 'yearly' } },
  // An edited occurrence of the weekly series, moved: it hides the original day, and is reminded itself.
  { id: 'weekly-edit', ownerId: OWNER, groupId: 'g1', title: 'Football (moved)', date: '2026-07-29T00:00:00.000Z', time: '19:00', timezone: BUC, reminderMinutes: 120, overrideOfParent: 'weekly', overrideDate: '2026-07-28' },
  // A legacy edit without `overrideDate`, keyed on its own date.
  { id: 'daily-edit', ownerId: OWNER, groupId: 'g1', title: 'Pills (late)', date: '2026-07-15T00:00:00.000Z', time: '11:00', timezone: BUC, reminderMinutes: 5, overrideOfParent: 'daily' },
  // A copy that carries the keys but is not the parent's (another owner): hides nothing.
  { id: 'foreign-edit', ownerId: ANA, title: 'Not an edit', date: '2026-07-16T00:00:00.000Z', reminderMinutes: 0, overrideOfParent: 'daily', overrideDate: '2026-07-16' },
  // The same owner's PERSONAL copy (leaving a group copies the keys): it belongs to no group, so it
  // hides nothing of the group's series. Only `groupId` tells the two apart.
  { id: 'daily-copy', ownerId: OWNER, groupId: null, title: 'Copy', date: '2026-07-18T00:00:00.000Z', reminderMinutes: null, overrideOfParent: 'daily', overrideDate: '2026-07-18' },
  { id: 'unreminded', ownerId: OWNER, title: 'No reminder', date: '2026-07-15T00:00:00.000Z', reminderMinutes: null },
];

const ZONES = { [OWNER]: BUC, [ANA]: 'Europe/London' };
const EVER = [-8.64e15, 8.64e15] as const;

/** Every reminder of every occurrence in the window — the window wide open, so every field counts. */
function reminders(docs: Array<Record<string, unknown> & { id: string }>) {
  const occ = expandInWindow(docs as never, FROM_DAY, TO_DAY).map((o) => ({ source: o.source as never, day: o.day }));
  return dueIn(occ, ZONES, EVER[0], EVER[1]);
}

/** What `select(REMINDER_FIELDS)` returns of a document: whole fields, and the named parts of a map. */
function selected(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of REMINDER_FIELDS) {
    const [top, sub] = path.split('.');
    if (!(top in e)) continue;
    if (sub === undefined) { out[top] = e[top]; continue; }
    const m = e[top];
    if (m && typeof m === 'object' && !Array.isArray(m) && sub in m) {
      out[top] = { ...(out[top] as object), [sub]: (m as Record<string, unknown>)[sub] };
    }
  }
  return out;
}

/** A document without one field of the list (a part of a map, for a dotted one). */
function without(e: Record<string, unknown> & { id: string }, path: string) {
  const [top, sub] = path.split('.');
  if (sub === undefined) { const { [top]: _gone, ...rest } = e; return rest as typeof e; }
  const m = e[top];
  if (!m || typeof m !== 'object') return e;
  const { [sub]: _part, ...restOfMap } = m as Record<string, unknown>;
  return { ...e, [top]: restOfMap };
}

const compactAll = (docs: Array<Record<string, unknown> & { id: string }>) =>
  docs.map((e) => compactEvent(e.id, selected(e), FROM_DAY, TO_DAY)).filter((x): x is NonNullable<typeof x> => x !== null);

describe('for every event the app writes, the reminders are the same', () => {
  it('from the selected fields, reduced, as from the whole documents', () => {
    const whole = reminders(EVENTS);
    // Not a vacuous comparison: series, edits, spans, zones and both kinds of assignee all in it.
    expect(whole.length).toBeGreaterThan(50);
    expect(new Set(whole.map((d) => d.eventId))).toEqual(new Set(EVENTS.filter((e) => typeof e.reminderMinutes === 'number').map((e) => e.id)));
    expect(reminders(compactAll(EVENTS))).toEqual(whole);
  });

  it('with the rest of each document beside them, which is simply not read', () => {
    const padded = EVENTS.map((e) => ({ ...e, description: 'x'.repeat(10_000), checklistItems: [{ id: 'a' }], aiNote: { text: 'y' } }));
    expect(reminders(compactAll(padded))).toEqual(reminders(EVENTS));
  });

  it('every field on the list changes some reminder when it is gone — the list holds nothing idle', () => {
    const whole = reminders(EVENTS);
    for (const f of REMINDER_FIELDS) {
      expect(reminders(compactAll(EVENTS.map((e) => without(e, f)))), f).not.toEqual(whole);
    }
  });
});

describe('whatever an event holds, the copy is small', () => {
  const big = 'x'.repeat(1_000_000);

  it('a title is cut where the reminder cuts it', () => {
    const c = compactEvent('e', { date: '2026-07-15T00:00:00.000Z', title: big }, FROM_DAY, TO_DAY)!;
    expect(c.title).toBe('x'.repeat(120));
  });

  it('a title is cut on whole characters: an emoji across the cut is left out whole, in the copy and in the reminder', () => {
    // Half an emoji is not text: the digest sent it to the model, and the API refuses it (17.10.2026).
    const cake = '\u{1F382}';
    const across = { id: 'e', ownerId: OWNER, date: '2026-07-15T00:00:00.000Z', time: '10:00', timezone: 'UTC', reminderMinutes: 0, title: `${'x'.repeat(119)}${cake} party` };
    expect(compactEvent('e', across, FROM_DAY, TO_DAY)!.title).toBe('x'.repeat(119));
    // An emoji that ends at the cut is kept.
    expect(compactEvent('e', { ...across, title: `${'x'.repeat(118)}${cake} party` }, FROM_DAY, TO_DAY)!.title).toBe(`${'x'.repeat(118)}${cake}`);
    const fromCopy = reminders(compactAll([across]));
    expect(fromCopy.map((d) => d.title)).toEqual(['x'.repeat(119)]);
    expect(reminders([across])).toEqual(fromCopy);
  });

  it('exceptions: only days that can suppress an occurrence of the window, each once', () => {
    const c = compactEvent('e', {
      date: '2026-07-01T00:00:00.000Z', endDayOffset: 2,
      recurrenceExceptions: [
        ...Array(50_000).fill('2026-07-20'), '2026-07-05', '2026-07-04', '2026-08-13', '2026-08-14', '2026-01-01',
        big, 5, null, { a: 1 }, '2026-7-20', '2026-07-20T00:00:00.000Z', 'abcd-ef-gh', '2026/07/20',
        // Ten characters that sort inside the window but are no day: without the day's shape, any
        // number of such strings would be kept.
        ...Array.from({ length: 26 }, (_, i) => `2026-07-2${String.fromCharCode(97 + i)}`), '2026-07-1 ',
      ],
    }, FROM_DAY, TO_DAY)!;
    // From two days of span and one of tolerance before the window, to one after it.
    expect(c.recurrenceExceptions).toEqual(['2026-07-20', '2026-07-05', '2026-08-13']);
  });

  it('a rule is a frequency and a day filter, or nothing', () => {
    const rule = (recurrenceRule: unknown) => compactEvent('e', { date: '2026-07-15T00:00:00.000Z', recurrenceRule }, FROM_DAY, TO_DAY)!.recurrenceRule;
    for (const junk of [true, 1, 'daily', ['daily'], null, undefined]) expect(rule(junk), String(junk)).toBeNull();
    expect(rule({ frequency: 'daily', onlyOn: 'weekdays', pad: big })).toEqual({ frequency: 'daily', onlyOn: 'weekdays' });
    expect(rule({ frequency: big, onlyOn: big })).toEqual({});
    expect(rule({ frequency: 7 })).toEqual({});
  });

  it('assignees: text of an id’s length, each once, fifty at most', () => {
    const c = compactEvent('e', {
      date: '2026-07-15T00:00:00.000Z',
      assigneeIds: [...Array(10_000).fill(ANA), big, 5, null, ...Array.from({ length: 80 }, (_, i) => `uid-${i}`)],
    }, FROM_DAY, TO_DAY)!;
    expect(c.assigneeIds).toHaveLength(50);
    expect((c.assigneeIds as string[])[0]).toBe(ANA);
    expect(new Set(c.assigneeIds as string[]).size).toBe(50);
    expect((c.assigneeIds as string[]).every((x) => x.length <= 128)).toBe(true);
  });

  it('a field longer than the app writes is left out', () => {
    const c = compactEvent('e', {
      date: '2026-07-15T00:00:00.000Z', ownerId: big, groupId: big, timezone: big, time: big, overrideOfParent: big,
      overrideDate: big, assigneeId: big, reminderMinutes: big, endDayOffset: big,
    }, FROM_DAY, TO_DAY)!;
    expect(Object.keys(c).sort()).toEqual(['date', 'id', 'recurrenceRule']);
  });

  it('an event whose id or date cannot be the app’s is not a candidate at all', () => {
    expect(compactEvent('x'.repeat(129), { date: '2026-07-15T00:00:00.000Z' }, FROM_DAY, TO_DAY)).toBeNull();
    expect(compactEvent('', { date: '2026-07-15T00:00:00.000Z' }, FROM_DAY, TO_DAY)).toBeNull();
    for (const date of [big, '2026-07-15T00:00:00.000Z' + 'x'.repeat(20), 20260715, null, undefined]) {
      expect(compactEvent('e', { date }, FROM_DAY, TO_DAY), String(date).slice(0, 30)).toBeNull();
    }
    expect(compactEvent('x'.repeat(128), { date: '2026-07-15T00:00:00.000Z' }, FROM_DAY, TO_DAY)).not.toBeNull();
  });
});

describe('ids the app can write are kept whole', () => {
  it('a parent or group id up to Firestore’s length, not past it', () => {
    const at = (n: number) => 'p'.repeat(n);
    const c = compactEvent('e', { date: '2026-07-15T00:00:00.000Z', overrideOfParent: at(1500), groupId: at(1500) }, FROM_DAY, TO_DAY)!;
    expect([c.overrideOfParent, c.groupId]).toEqual([at(1500), at(1500)]);
    const d = compactEvent('e', { date: '2026-07-15T00:00:00.000Z', overrideOfParent: at(1501), groupId: at(1501) }, FROM_DAY, TO_DAY)!;
    expect([d.overrideOfParent, d.groupId]).toEqual([undefined, undefined]);
    const o = compactEvent('e', { date: '2026-07-15T00:00:00.000Z', ownerId: at(128), assigneeId: at(128), assigneeIds: [at(128)] }, FROM_DAY, TO_DAY)!;
    expect([o.ownerId, o.assigneeId, o.assigneeIds]).toEqual([at(128), at(128), [at(128)]]);
  });
});

describe('zone formatters are built once per zone, not per occurrence', () => {
  /** How many Intl.DateTimeFormat a call builds. */
  function built(call: () => void): number {
    const Real = Intl.DateTimeFormat;
    let n = 0;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...a: unknown[]) {
      n += 1;
      return new (Real as unknown as new (...x: unknown[]) => Intl.DateTimeFormat)(...a);
    } as never);
    try { call(); } finally { spy.mockRestore(); }
    return n;
  }

  it('the offset and the validity of a zone, each once', () => {
    expect(built(() => { for (let i = 0; i < 5; i++) zoneOffsetMs(Date.UTC(2026, 6, 15), 'Pacific/Chatham'); })).toBe(1);
    expect(built(() => { for (let i = 0; i < 5; i++) isValidZone('Antarctica/Troll'); })).toBe(1);
    // And a string longer than any zone is refused without building anything, as is an offset that
    // is no real one — newer runtimes accept thousands of spellings, more than any cache holds.
    expect(built(() => expect(isValidZone('Europe/Bucharest' + 'x'.repeat(60))).toBe(false))).toBe(0);
    for (const offset of ['+05:31', '-03:07', '+15:00', '+5:30', '+05:30:00', '-14:60', '+']) {
      expect(built(() => expect(isValidZone(offset), offset).toBe(false)), offset).toBe(0);
    }
    expect(isValidZone('Etc/GMT+5')).toBe(true);
    // A real offset is a zone where the runtime takes it (a device on a fixed offset reports one).
    const takesOffsets = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: '+05:30' }); return true; } catch { return false; } })();
    for (const offset of ['+05:30', '-03:00', '+14:00', '-09:45']) expect(isValidZone(offset), offset).toBe(takesOffsets);
  });

  it('every real zone fits the caches at once: series in two hundred zones build a few per zone', () => {
    const zones = [...new Set(Intl.supportedValuesOf('timeZone').slice(0, 200)
      .map((z) => new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone))];
    expect(zones.length).toBeGreaterThan(150);
    const docs = zones.map((tz, i) => ({
      id: `z${i}`, ownerId: OWNER, title: 'Pills', date: '2026-07-01T00:00:00.000Z', time: '09:00', timezone: tz,
      reminderMinutes: 5, recurrenceRule: { frequency: 'daily' },
    }));
    const occ = expandInWindow(docs as never, FROM_DAY, TO_DAY).map((o) => ({ source: o.source as never, day: o.day }));
    let due: unknown[] = [];
    const n = built(() => { due = dueIn(occ, ZONES, EVER[0], EVER[1]); });
    expect(due).toHaveLength(occ.length);
    expect(n).toBeLessThan(zones.length * 4);
  });

  it('more spellings of one zone than the caches hold, on daily series: a few per event, not one per day', () => {
    // Intl takes any capitalisation. Past the caches' size, cycling through the spellings day by day
    // would empty them on every lookup — unless each event's zone is resolved once, by its real name.
    const letters = [...'europe/bucharest'];
    const spellings = Array.from({ length: 1100 }, (_, i) => {
      let bit = 0;
      return letters.map((c) => (c === '/' ? c : ((i >> bit++) & 1 ? c.toUpperCase() : c))).join('');
    });
    expect(new Set(spellings).size).toBe(1100);
    const docs = spellings.map((tz, i) => ({
      id: `s${i}`, ownerId: OWNER, title: 'Pills', date: '2026-07-01T00:00:00.000Z', time: '09:00', timezone: tz,
      reminderMinutes: 5, recurrenceRule: { frequency: 'daily' },
    }));
    const occ = expandInWindow(docs as never, FROM_DAY, TO_DAY).map((o) => ({ source: o.source as never, day: o.day }));
    expect(occ.length).toBeGreaterThan(1100 * 20);
    let due: unknown[] = [];
    const n = built(() => { due = dueIn(occ, ZONES, EVER[0], EVER[1]); });
    expect(due).toHaveLength(occ.length);
    expect(n).toBeLessThan(1100 * 4);
  });
});

describe('the order reminders are sent in', () => {
  const WINDOW = 15 * 60_000;
  const EVERY = 5 * 60_000;
  const SLACK = 2 * 60_000;
  const NOW = Date.UTC(2026, 6, 15, 12, 0);
  const due = (key: string, ownerId: string, at: number) =>
    ({ key, eventId: key, ownerId, day: '2026-07-15', title: '', at, zone: 'UTC', recipients: [ownerId], bodyKey: '', bodyParam: '' });

  it('round the owners, one each, so one account’s many wait behind everybody else’s first', () => {
    const fresh = NOW - 60_000;
    const order = sendOrder([due('a1', 'A', fresh), due('a2', 'A', fresh), due('a3', 'A', fresh), due('b1', 'B', fresh), due('c1', 'C', fresh), due('c2', 'C', fresh)], NOW, WINDOW, EVERY, SLACK).order;
    expect(order.map((d) => d.key)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });

  it('those the next run will not see go first, round the owners too', () => {
    const last = NOW - 11 * 60_000;
    const { order, lastChance } = sendOrder([due('a1', 'A', NOW - 60_000), due('a2', 'A', last), due('b1', 'B', NOW - 60_000), due('b2', 'B', last)], NOW, WINDOW, EVERY, SLACK);
    expect(order.map((d) => d.key)).toEqual(['a2', 'b2', 'a1', 'b1']);
    expect([...lastChance].sort()).toEqual(['a2', 'b2']);
  });

  it('the last chance starts where the next run, late by the slack, no longer looks back', () => {
    const edge = NOW + EVERY + SLACK - WINDOW;
    const { lastChance } = sendOrder([due('on', 'A', edge), due('after', 'A', edge + 1)], NOW, WINDOW, EVERY, SLACK);
    expect([...lastChance]).toEqual(['on']);
  });
});

describe('who is told', () => {
  it('not the assistant, which is nobody’s phone', () => {
    const occ = [{ source: { id: 'e', ownerId: OWNER, title: 'T', date: '2026-07-15T00:00:00.000Z', time: '09:00', timezone: BUC, reminderMinutes: 0, assigneeIds: ['ai_assistant', ANA], assigneeId: 'ai_assistant' } as never, day: '2026-07-15' }];
    expect(dueIn(occ, ZONES, EVER[0], EVER[1]).map((d) => d.recipients)).toEqual([[OWNER, ANA]]);
  });
});
