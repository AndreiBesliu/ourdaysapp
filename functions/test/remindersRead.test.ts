// functions/test/remindersRead.test.ts
//
// One account must not be able to stop everybody's reminders (12.10.2026). Until then the job read
// two queries of at most 2000 WHOLE events each, every five minutes:
//   * the recurring one orders by `recurrenceRule`'s VALUE, and `true` sorts before every real rule,
//     so 2000 personal events with `recurrenceRule: true` pushed every real series out;
//   * the dated one orders by date, so 2000 events at the start of the window pushed the rest out;
//   * every document came whole, so a few hundred padded ones ran it out of memory;
// Run against the emulators through `npm run test:rules`, through the real job.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';
import { Query } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const EVENT = { scheduleTime: new Date().toISOString(), jobName: 'test' };
const DAY = 86_400_000;
const ALICE = 'uid-rem-alice';
const MALLORY = 'uid-rem-mallory';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** An instant five minutes ago, to the minute: a reminder at it is due in this run. */
const dueAt = () => Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;

/** A timed event whose reminder ("at the time") is due now. */
const dueEvent = (owner: string, extra: Record<string, unknown> = {}) => {
  const at = dueAt();
  return {
    ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(at)}T00:00:00.000Z`, time: clockOf(at),
    timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner], ...extra,
  };
};
/**
 * A daily series that started ten days ago, at the same clock: today's occurrence is due now. Ten
 * days, so that only the SERIES query finds it — the dated one reaches back two.
 */
const dueSeries = (owner: string) => ({
  ...dueEvent(owner), date: `${dayOf(dueAt() - 10 * DAY)}T00:00:00.000Z`, recurrenceRule: { frequency: 'daily' },
  recurrenceExceptions: [],
});

async function seed(docs: Record<string, Record<string, unknown>>) {
  const entries = Object.entries(docs);
  for (let i = 0; i < entries.length; i += 450) {
    const b = db.batch();
    for (const [id, data] of entries.slice(i, i + 450)) b.set(db.doc(`events/${id}`), data);
    await b.commit();
  }
}
const many = (prefix: string, n: number, make: (i: number) => Record<string, unknown>) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(5, '0')}`, make(i)]));
const sentFor = async (eventId: string, at = dueAt()) => (await db.doc(`reminder_log/${eventId}__${dayOf(at)}`).get()).exists;
const runJob = () => (mod.sendDueReminders as unknown as { run: (e: unknown) => Promise<void> }).run(EVENT);
const marker = async () => (await db.doc('jobRuns/sendDueReminders').get()).data();

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  // The test computes days itself, the code reads its own clock: a reminder due five minutes ago
  // changes day at 00:05 UTC.
  await awayFromEdge(5 * 60_000);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('no account can push other people’s events out of the read', () => {
  it('2100 personal events with `recurrenceRule: true` do not hide a real series', async () => {
    await seed({ ...many('!junk', 2100, () => ({ ownerId: MALLORY, groupId: null, recurrenceRule: true, date: 'x' })), series: dueSeries(ALICE) });
    await runJob();
    expect(await sentFor('series')).toBe(true);
    expect(await marker()).toMatchObject({ ok: true });
  }, 120_000);

  it('2100 events at the start of the window do not hide one later in it', async () => {
    const early = `${dayOf(Date.now() - 2 * DAY)}T00:00:00.000Z`;
    await seed({ ...many('!early', 2100, () => ({ ownerId: MALLORY, groupId: null, date: early })), dentist: dueEvent(ALICE) });
    await runJob();
    expect(await sentFor('dentist')).toBe(true);
    expect(await marker()).toMatchObject({ ok: true });
  }, 120_000);
});

/** Every document any query FETCHES during `call` (a page, the edits), with the fields it came with. */
async function fetched(call: () => Promise<unknown>): Promise<Array<{ path: string; keys: string[] }>> {
  const seen: Array<{ path: string; keys: string[] }> = [];
  const realGet = Query.prototype.get;
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    for (const d of snap.docs) seen.push({ path: d.ref.path, keys: Object.keys(d.data() || {}) });
    return snap;
  } as never);
  try { await call(); } finally { vi.restoreAllMocks(); }
  return seen;
}
const onEvents = (rows: Array<{ path: string; keys: string[] }>) => rows.filter((f) => f.path.startsWith('events/'));

describe('what the job reads', () => {
  it('only the fields the reminder is computed from, in pages', async () => {
    const PAD = { description: 'x'.repeat(5000), checklistItems: [{ id: 'a', text: 'x'.repeat(5000) }], pad: 'x'.repeat(64) };
    await seed({
      ...many('p', 60, () => ({ ...dueEvent(MALLORY), ...PAD })),
      ...many('s', 60, () => ({ ...dueSeries(MALLORY), ...PAD })),
      dentist: { ...dueEvent(ALICE), ...PAD },
      // Of a rule, only its two parts are read: the rest of the map could be a megabyte too.
      ruled: { ...dueSeries(MALLORY), recurrenceRule: { frequency: 'daily', pad: 'x'.repeat(64) } },
    });
    const sizes: number[] = [];
    const realGet = Query.prototype.get;
    const events = onEvents(await fetched(async () => {
      const inner = Query.prototype.get;
      vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
        const snap = await (inner as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
        if (snap.docs.some((d) => d.ref.path.startsWith('events/'))) sizes.push(snap.size);
        return snap;
      } as never);
      await runJob();
    }));
    void realGet;
    expect(await sentFor('dentist')).toBe(true);
    // Both reads, every event once each (61 dated, 61 series that started before the dated window),
    // and nothing beyond the computation's fields.
    expect(new Set(events.map((f) => f.path)).size).toBe(61 + 61);
    expect(await sentFor('ruled')).toBe(true);
    for (const f of events) {
      expect(f.keys.filter((k) => ['description', 'checklistItems', 'pad'].includes(k)), f.path).toEqual([]);
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(mod.READ_PAGE);
  }, 120_000);

  it('of a rule, only the frequency and the day filter', async () => {
    await seed({ ruled: { ...dueSeries(ALICE), recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays', pad: 'x'.repeat(64) } } });
    const realGet = Query.prototype.get;
    const rules: unknown[] = [];
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      for (const d of snap.docs) if (d.id === 'ruled') rules.push(d.data().recurrenceRule);
      return snap;
    } as never);
    await runJob();
    vi.restoreAllMocks();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toEqual({ frequency: 'daily', onlyOn: 'weekdays' });
  }, 120_000);

  it('the series query reads only rules that are series', async () => {
    const junk = [true, 'daily', ['daily'], {}, { frequency: 'hourly' }, { frequency: 5 }, { frequency: null }];
    await seed({
      ...Object.fromEntries(junk.map((recurrenceRule, i) => [`!junk${i}`, { ownerId: MALLORY, groupId: null, recurrenceRule, date: 'x' }])),
      series: dueSeries(ALICE),
    });
    const events = onEvents(await fetched(runJob));
    expect([...new Set(events.map((f) => f.path))]).toEqual(['events/series']);
  }, 120_000);

  it('an owner’s zone, for an all-day event of their own: every owner, past the first hundred', async () => {
    // 101 owners in Kolkata (UTC+05:30), each with an all-day event — 09:00 in the owner's zone —
    // whose reminder lands now. In UTC (no zone read) it would land five and a half hours off.
    const zone = 'Asia/Kolkata';
    const nineThere = (day: string) => Date.parse(`${day}T03:30:00.000Z`);
    let day = dayOf(dueAt());
    if (nineThere(day) < dueAt()) day = dayOf(dueAt() + DAY);
    const minutes = (nineThere(day) - dueAt()) / 60_000;
    const owners = Array.from({ length: 101 }, (_, i) => `uid-zone-${String(i).padStart(3, '0')}`);
    const b = db.batch();
    for (const u of owners) b.set(db.doc(`users/${u}`), { timezone: zone, pad: 'x'.repeat(1000) });
    await b.commit();
    await seed(Object.fromEntries(owners.map((u) => [`allday-${u}`, { ownerId: u, groupId: null, title: 'Day', date: `${day}T00:00:00.000Z`, reminderMinutes: minutes }])));
    await runJob();
    // The dedupe key names the occurrence's day, which is the event's — tomorrow, by Kolkata's clock.
    for (const u of owners) expect((await db.doc(`reminder_log/allday-${u}__${day}`).get()).exists, u).toBe(true);
  }, 120_000);

  it('the exceptions of the job’s own window: a series skipped today is not reminded', async () => {
    await seed({ series: { ...dueSeries(ALICE), recurrenceExceptions: [dayOf(dueAt())] }, dentist: dueEvent(ALICE) });
    await runJob();
    expect(await sentFor('dentist')).toBe(true);
    expect(await sentFor('series')).toBe(false);
  }, 120_000);

  it('runs with the time and memory it states', () => {
    const ep = (mod.sendDueReminders as unknown as { __endpoint: { timeoutSeconds?: number; availableMemoryMb?: number } }).__endpoint;
    expect(ep.timeoutSeconds).toBeGreaterThanOrEqual((2 * mod.READ_BUDGET_MS) / 1000 + 60);
    expect(ep.availableMemoryMb).toBeGreaterThanOrEqual(512);
  });
});

describe('a read that cannot finish says so', () => {
  it('past the candidate cap, the run stops reading and turns red', async () => {
    await seed({ ...many('c', 30, () => ({ ...dueEvent(MALLORY), reminderMinutes: null })), dentist: dueEvent(ALICE) });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { maxCandidates: 10, page: 4 });
    expect(counts).toMatchObject({ cut: 1, read: 10 });
    expect(mod.reminderOutcome(counts).failed).toBeGreaterThan(0);
    expect(mod.reminderOutcome(counts).detail).toContain('stopped early 1');
    // Exactly the cap is not past it.
    const exact = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), exact, { maxCandidates: 31, page: 4 });
    expect(exact).toMatchObject({ cut: 0, read: 31 });
  }, 120_000);

  it('and the job’s own run turns red, past its own cap', async () => {
    await seed(many('c', mod.MAX_CANDIDATES + 1, () => ({ ownerId: MALLORY, groupId: null, date: `${dayOf(Date.now())}T00:00:00.000Z` })));
    await runJob();
    const m = await marker();
    expect(m).toMatchObject({ ok: false });
    expect(m!.detail).toContain('stopped early 1');
  }, 180_000);

  it('out of time, the same — and each query has its own time', async () => {
    await seed({ ...many('c', 30, () => dueEvent(MALLORY)), series: dueSeries(ALICE) });
    const counts = mod.emptyCounts();
    let looks = 0;
    // The dated read starts at 0 and is out of time at its first look; the series read starts later
    // and has its own fifteen seconds.
    await mod.remindDue(db, Date.now(), counts, { clock: () => (looks++ === 0 ? 0 : 60_000) });
    expect(counts).toMatchObject({ cut: 1, candidates: 1 });
    expect(await sentFor('series')).toBe(true);
  }, 120_000);
});

describe('a page that comes back the same', () => {
  it('stops the read and turns it red, rather than reading it for ever', async () => {
    // A cursor on a value longer than Firestore indexes (1500 bytes) can return a page again.
    await seed(many('r', 10, () => ({ ...dueEvent(MALLORY), reminderMinutes: null })));
    const realGet = Query.prototype.get;
    let first: admin.firestore.QuerySnapshot | null = null;
    let pages = 0;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      if (!snap.docs.some((d) => d.ref.path.startsWith('events/r'))) return snap;
      pages += 1;
      first ??= snap;
      return first;
    } as never);
    const counts = mod.emptyCounts();
    // No time limit: only the guard can end this read.
    await mod.remindDue(db, Date.now(), counts, { page: 5, budgetMs: Number.POSITIVE_INFINITY });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ cut: 1, read: 5 });
    expect(pages).toBe(2);
  }, 20_000);
});

describe('an edited occurrence of a series', () => {
  // `createEventOverride` writes the edit AND adds its day to the series' exceptions. The series hides
  // the original day by itself, wherever the edit is dated and whatever a cut read reached.
  const edited = () => ({ ...dueSeries(ALICE), recurrenceExceptions: [dayOf(dueAt())] });
  const editOf = (parent: string) => ({
    ownerId: ALICE, groupId: null, title: 'Moved', date: `${dayOf(Date.now() + 60 * DAY)}T00:00:00.000Z`,
    overrideOfParent: parent, overrideDate: dayOf(dueAt()), reminderMinutes: 0,
  });

  it('the original day is not reminded, wherever the edit is dated', async () => {
    await seed({ series: edited(), edit: editOf('series') });
    await runJob();
    expect(await sentFor('series')).toBe(false);
    expect(await marker()).toMatchObject({ ok: true });
  }, 120_000);

  it('nor past a cut read, and the other series still go out', async () => {
    await seed({ ...many('c', 12, () => ({ ...dueEvent(MALLORY), reminderMinutes: null })), series: edited(), other: dueSeries(MALLORY), edit: editOf('series') });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { maxCandidates: 10 });
    expect(counts).toMatchObject({ cut: 1 });
    expect(await sentFor('other')).toBe(true);
    expect(await sentFor('series')).toBe(false);
  }, 120_000);
});

describe('sending', () => {
  /** A timed event whose "at the time" reminder lands at `atMs` (a whole minute). */
  const eventAt = (owner: string, atMs: number, extra: Record<string, unknown> = {}) => ({
    ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
    timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner], ...extra,
  });
  const minute = (ms: number) => Math.floor(ms / 60_000) * 60_000;
  const logOf = async (id: string, atMs: number) => (await db.doc(`reminder_log/${id}__${dayOf(atMs)}`).get()).data();
  /** A clock that moves one tick a look: the send budget is then a number of sends. */
  const ticking = () => { let t = 0; return () => t++; };

  it('in turns between owners, within the time to send; the rest wait for the next run', async () => {
    await seed({ ...many('!m', 40, () => dueEvent(MALLORY)), dentist: dueEvent(ALICE) });
    const counts = mod.emptyCounts();
    // Two sends' time: Mallory's first reminder, then Alice's — not Mallory's other thirty-nine.
    await mod.remindDue(db, Date.now(), counts, { clock: ticking(), sendBudgetMs: 3 });
    expect(counts).toMatchObject({ due: 41, sent: 2, deferred: 39, dropped: 0 });
    expect(await sentFor('dentist')).toBe(true);
    expect(mod.reminderOutcome(counts).failed).toBe(0);
    // The next run sends the rest; nothing twice.
    const next = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), next);
    expect(next).toMatchObject({ sent: 39, dupes: 2, deferred: 0 });
  }, 120_000);

  it('a reminder on its last run goes first, and one that does not fit is counted, and red', async () => {
    const last = minute(Date.now() - 11 * 60_000);
    await seed({ ...many('!m', 5, () => dueEvent(MALLORY)), late: eventAt(ALICE, last) });
    const one = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), one, { clock: ticking(), sendBudgetMs: 2 });
    expect(one).toMatchObject({ sent: 1, deferred: 5, dropped: 0 });
    expect(await logOf('late', last)).toMatchObject({ state: 'sent' });

    await db.doc(`reminder_log/late__${dayOf(last)}`).delete();
    const none = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), none, { sendBudgetMs: 0 });
    expect(none).toMatchObject({ sent: 0, dropped: 1, deferred: 5 });
    expect(mod.reminderOutcome(none).failed).toBeGreaterThan(0);
    expect(mod.reminderOutcome(none).detail).toContain('dropped 1');
  }, 120_000);

  it('a claim left "sending" by a run that died is taken over, once old enough', async () => {
    await seed({ dentist: dueEvent(ALICE) });
    const row = (agoMs: number) => ({ eventId: 'dentist', day: dayOf(dueAt()), at: dueAt(), state: 'sending', claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - agoMs) });
    await db.doc(`reminder_log/dentist__${dayOf(dueAt())}`).set(row(60_000));
    const young = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), young);
    expect(young).toMatchObject({ sent: 0, dupes: 1, retried: 0 });

    await db.doc(`reminder_log/dentist__${dayOf(dueAt())}`).set(row(mod.STALE_CLAIM_MS + 60_000));
    const old = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), old);
    expect(old).toMatchObject({ sent: 1, retried: 1 });
    expect(await logOf('dentist', dueAt())).toMatchObject({ state: 'sent', retries: 1 });
  }, 120_000);

  it('a send that fails leaves its claim, and a later run sends it', async () => {
    await seed({ dentist: dueEvent(ALICE) });
    const real = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation(((p: string) => {
      if (p === 'notifications') throw new Error('injected: the bell is unwritable');
      return real(p);
    }) as never);
    const first = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), first);
    vi.restoreAllMocks();
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(await logOf('dentist', dueAt())).toMatchObject({ state: 'sending' });
    // Once the claim is old enough, the next run that still sees the reminder delivers it.
    await db.doc(`reminder_log/dentist__${dayOf(dueAt())}`).update({ claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - mod.STALE_CLAIM_MS - 60_000) });
    const second = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), second);
    expect(second).toMatchObject({ sent: 1, retried: 1, failed: 0 });
    expect(await logOf('dentist', dueAt())).toMatchObject({ state: 'sent' });
  }, 120_000);

  it('a row from before, with no state, was sent: nothing again', async () => {
    await seed({ dentist: dueEvent(ALICE) });
    await db.doc(`reminder_log/dentist__${dayOf(dueAt())}`).set({ eventId: 'dentist', day: dayOf(dueAt()), at: dueAt(), sentAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60_000) });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts);
    expect(counts).toMatchObject({ sent: 0, dupes: 1, retried: 0 });
  }, 120_000);

  it('the assistant gets no bell row', async () => {
    await seed({ dentist: dueEvent(ALICE, { assigneeIds: [ALICE, 'ai_assistant'], assigneeId: 'ai_assistant' }) });
    await runJob();
    expect(await sentFor('dentist')).toBe(true);
    expect((await db.collection('notifications').where('userId', '==', 'ai_assistant').get()).size).toBe(0);
    expect((await db.collection('notifications').where('userId', '==', ALICE).get()).size).toBe(1);
  }, 120_000);
});

describe('the series query reaches back as far as a series can still run (16.10.2026)', () => {
  // A series runs from its start to its horizon (recurrenceCore.ts): daily 30 days, weekly 52 weeks,
  // monthly 12 months, yearly 5 years. The series query had no bound on `date`, so every run read every
  // series ever made, ended or not. Now each frequency is a range of its own, from as far back as a series
  // of it can still have an occurrence on the first day the run looks at (`SERIES_REACH_DAYS`: 31, 365,
  // 367 and 1828 days), and not past its lookahead. Until 17.10 the first three shared 400 days, which
  // read a year of ended daily series, and read them first (review of f1052b7).
  const NOW = Date.parse('2026-10-16T12:00:00.000Z');
  const FROM = Date.parse('2026-10-14T00:00:00.000Z'); // two days before NOW, the first day a run looks at
  const TO = Date.parse('2026-11-16T00:00:00.000Z'); // NOW plus the 31 days of lookahead
  const at = (ms: number) => `${dayOf(ms)}T00:00:00.000Z`;
  const series = (frequency: string, date: string) =>
    ({ ownerId: ALICE, groupId: null, title: frequency, date, recurrenceRule: { frequency }, reminderMinutes: null });
  /** A refusal like live's when the composite index is missing, or still building just after it is published. */
  const missingIndex = () => Object.assign(
    new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/'),
    { code: 9 },
  );
  /** Every series query that bounds `date` fails with `error`; the rest run. Returns how many failed. */
  const refuseBoundedSeries = (error: () => Error) => {
    const realGet = Query.prototype.get;
    const refused = { n: 0 };
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const filters = ((this as unknown as { _queryOptions?: { filters?: Array<{ field?: { formattedName?: string } }> } })
        ._queryOptions?.filters ?? []).map((f) => f.field?.formattedName);
      if (filters.includes('recurrenceRule.frequency') && filters.includes('date')) {
        refused.n += 1;
        throw error();
      }
      return (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    } as never);
    return refused;
  };

  it('reads a series still running, to the day it can, and none that has ended or not begun', async () => {
    await seed({
      'daily-running': series('daily', at(FROM - 20 * DAY)),
      'daily-edge': series('daily', at(FROM - 31 * DAY)),
      // Its first day is FROM - 30, so it runs on FROM; stored at 22:00Z the day before (seriesStartDay).
      'daily-late': series('daily', new Date(FROM - 30 * DAY - 2 * 3_600_000).toISOString()),
      'daily-past': series('daily', at(FROM - 32 * DAY)),
      'weekly-edge': series('weekly', at(FROM - 365 * DAY)),
      'weekly-past': series('weekly', at(FROM - 366 * DAY)),
      'monthly-edge': series('monthly', at(FROM - 367 * DAY)),
      'monthly-past': series('monthly', at(FROM - 368 * DAY)),
      'yearly-four': series('yearly', at(FROM - 4 * 365 * DAY)),
      'yearly-edge': series('yearly', at(FROM - 1828 * DAY)),
      'yearly-past': series('yearly', at(FROM - 1829 * DAY)),
      'starts-last-day': series('weekly', at(TO)),
      'starts-after': series('weekly', at(TO + DAY)),
    });
    const counts = mod.emptyCounts();
    const read = new Set(onEvents(await fetched(() => mod.remindDue(db, NOW, counts))).map((f) => f.path));
    expect([...read].sort()).toEqual([
      'events/daily-edge', 'events/daily-late', 'events/daily-running', 'events/monthly-edge', 'events/starts-last-day',
      'events/weekly-edge', 'events/yearly-edge', 'events/yearly-four',
    ]);
    expect(counts).toMatchObject({ cut: 0, seriesUnbounded: 0 });
  }, 120_000);

  it('a year of ended daily series is not read, so it cannot take the cap from the running ones', async () => {
    const now = Date.now();
    const due = dueAt();
    const fromMs = Date.parse(`${dayOf(now - 2 * DAY)}T00:00:00.000Z`);
    await seed({
      // Begun 32..374 days before the first day: each ended (its first day + 30 is before it).
      ...many('ended', 20, (i) => ({
        ownerId: MALLORY, groupId: null, title: 'ended', recurrenceRule: { frequency: 'daily' },
        date: at(fromMs - (32 + i * 18) * DAY), reminderMinutes: 0,
      })),
      running: dueSeries(ALICE),
      // Four years ago today (a 29 February has one then too).
      birthday: { ...dueSeries(ALICE), date: `${Number(dayOf(due).slice(0, 4)) - 4}${dayOf(due).slice(4)}T00:00:00.000Z`, recurrenceRule: { frequency: 'yearly' } },
    });
    // A cap of exactly their number: until 17.10 it went on them, in date order, and neither reminder was reached.
    const counts = mod.emptyCounts();
    const read = onEvents(await fetched(() => mod.remindDue(db, now, counts, { maxCandidates: 20 }))).map((f) => f.path);
    expect(read.filter((p) => p.startsWith('events/ended'))).toEqual([]);
    expect(counts).toMatchObject({ cut: 0, due: 2, sent: 2 });
    expect(await sentFor('running')).toBe(true);
    expect(await sentFor('birthday')).toBe(true);
  }, 120_000);

  it('without its index, as just after publishing, it reads as before 16.10, and the run says so', async () => {
    await seed({ series: dueSeries(ALICE), ended: series('weekly', at(Date.now() - 600 * DAY)) });
    const refused = refuseBoundedSeries(missingIndex);
    const counts = mod.emptyCounts();
    const read = new Set(onEvents(await fetched(() => mod.remindDue(db, Date.now(), counts))).map((f) => f.path));
    expect(refused.n).toBe(1);
    expect(await sentFor('series')).toBe(true);
    expect(read).toEqual(new Set(['events/series', 'events/ended']));
    expect(counts).toMatchObject({ cut: 0, seriesUnbounded: 1 });
    // Nothing is lost, so the run is not red; the line says why it read more than it should.
    expect(mod.reminderOutcome(counts).failed).toBe(0);
    expect(mod.reminderOutcome(counts).detail).toContain('series read without their index');
  }, 120_000);

  it('any other failure of that read is not taken for a missing index', async () => {
    await seed({ series: dueSeries(ALICE) });
    for (const error of [
      () => Object.assign(new Error('14 UNAVAILABLE: No connection established'), { code: 14 }),
      () => Object.assign(new Error('9 FAILED_PRECONDITION: Too much contention on these documents'), { code: 9 }),
      () => Object.assign(new Error('8 RESOURCE_EXHAUSTED: Too many index entries'), { code: 8 }),
    ]) {
      refuseBoundedSeries(error);
      await expect(mod.remindDue(db, Date.now(), mod.emptyCounts())).rejects.toThrow(error().message);
      vi.restoreAllMocks();
    }
    expect(await sentFor('series')).toBe(false);
  }, 120_000);

  it('one cap for all of its ranges, as for one query', async () => {
    await seed({
      ...many('w', 3, () => series('weekly', at(FROM - 100 * DAY))),
      yearly: series('yearly', at(FROM - 1000 * DAY)),
    });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, NOW, counts, { maxCandidates: 3, page: 2 });
    expect(counts).toMatchObject({ cut: 1, read: 3 });
    const exact = mod.emptyCounts();
    await mod.remindDue(db, NOW, exact, { maxCandidates: 4, page: 2 });
    expect(exact).toMatchObject({ cut: 0, read: 4 });
  }, 120_000);

  it('one time for all of its ranges: past it, the next is not read, and the run says it stopped', async () => {
    await seed({ weekly: series('weekly', at(FROM - 100 * DAY)), yearly: series('yearly', at(FROM - 1000 * DAY)) });
    // The clock stands still until a page has brought a series, then is a minute on: the range that
    // brought it is read, and the next look stops the read, whichever range comes next.
    let found = 0;
    const realGet = Query.prototype.get;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      if (snap.docs.some((d) => d.ref.path.startsWith('events/'))) found += 1;
      return snap;
    } as never);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, NOW, counts, { clock: () => (found ? 60_000 : 0), budgetMs: 15_000 });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ cut: 1, read: 1 });
    expect(found).toBe(1);
  }, 120_000);

  // The index refused after a page of the bounded read (it went away in the middle of a run): the fallback
  // continues that read, with its time, its cap and its count (review of f1052b7, 17.10.2026).
  const refuseAfterFirstPage = () => {
    const realGet = Query.prototype.get;
    const refused = { n: 0 };
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const options = (this as unknown as { _queryOptions?: { filters?: Array<{ field?: { formattedName?: string } }>; startAt?: unknown } })._queryOptions;
      const filters = (options?.filters ?? []).map((f) => f.field?.formattedName);
      if (filters.includes('recurrenceRule.frequency') && filters.includes('date') && options?.startAt) {
        refused.n += 1;
        throw missingIndex();
      }
      return (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    } as never);
    return refused;
  };
  const threeWeekly = () => many('w', 3, () => ({ ...dueSeries(ALICE), date: `${dayOf(dueAt() - 98 * DAY)}T00:00:00.000Z`, recurrenceRule: { frequency: 'weekly' } }));

  it('refused after a page: every series is read and reminded, and counted once', async () => {
    await seed(threeWeekly());
    const refused = refuseAfterFirstPage();
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { page: 2 });
    vi.restoreAllMocks();
    expect(refused.n).toBe(1);
    // Not "read 5"; and not stopped by the fallback's first page, which brings only what was read already.
    expect(counts).toMatchObject({ seriesUnbounded: 1, cut: 0, read: 3, due: 3, sent: 3 });
  }, 120_000);

  it('refused after a page: the fallback has no time and no cap of its own', async () => {
    await seed(threeWeekly());
    const refused = refuseAfterFirstPage();
    const late = mod.emptyCounts();
    // The clock stands still until the refusal, then is a minute on: the read is past its fifteen seconds.
    await mod.remindDue(db, Date.now(), late, { page: 2, clock: () => (refused.n ? 60_000 : 0), budgetMs: 15_000 });
    expect(late).toMatchObject({ seriesUnbounded: 1, cut: 1, read: 2 });
    // A cap of 2: the first page fills it, and the third series, found by the fallback, is one past it.
    const capped = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), capped, { page: 2, maxCandidates: 2 });
    vi.restoreAllMocks();
    expect(capped).toMatchObject({ seriesUnbounded: 1, cut: 1, read: 2 });
  }, 120_000);

  it('its index is in firestore.indexes.json, so publishing it publishes the index', async () => {
    const { readFileSync } = await import('node:fs');
    const { indexes } = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
      indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }>;
    };
    expect(indexes.filter((i) => i.collectionGroup === 'events' && i.queryScope === 'COLLECTION'
      && JSON.stringify(i.fields) === JSON.stringify([
        { fieldPath: 'recurrenceRule.frequency', order: 'ASCENDING' }, { fieldPath: 'date', order: 'ASCENDING' },
      ]))).toHaveLength(1);
  });
  // What the fallback reads (review of 17.10.2026: a fallback of the short frequencies only, or of every
  // event, passed every test above).
  it('without its index, a yearly series is still read and reminded', async () => {
    const d = dayOf(dueAt());
    const dueYearly = { ...dueEvent(ALICE), date: `${Number(d.slice(0, 4)) - 4}${d.slice(4)}T00:00:00.000Z`, recurrenceRule: { frequency: 'yearly' }, recurrenceExceptions: [] };
    await seed({ yearly: dueYearly, daily: dueSeries(ALICE) });
    const refused = refuseBoundedSeries(missingIndex);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts);
    expect(refused.n).toBe(1);
    expect(counts.seriesUnbounded).toBe(1);
    expect(await sentFor('daily')).toBe(true);
    expect(await sentFor('yearly')).toBe(true);
  }, 120_000);

  it('without its index, what is no series is not read', async () => {
    const old = at(Date.now() - 600 * DAY);
    await seed({
      series: { ownerId: 'u', groupId: null, title: 's', date: old, recurrenceRule: { frequency: 'weekly' } },
      plain: { ownerId: 'u', groupId: null, title: 'p', date: old },
      junk: { ownerId: 'u', groupId: null, title: 'j', date: old, recurrenceRule: true },
    });
    refuseBoundedSeries(missingIndex);
    const counts = mod.emptyCounts();
    const read = new Set(onEvents(await fetched(() => mod.remindDue(db, Date.now(), counts))).map((f) => f.path));
    expect(counts.seriesUnbounded).toBe(1);
    expect([...read]).toEqual(['events/series']);
  }, 120_000);
});

