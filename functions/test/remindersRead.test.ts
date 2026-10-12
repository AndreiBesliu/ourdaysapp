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
