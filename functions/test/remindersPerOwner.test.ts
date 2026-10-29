// functions/test/remindersPerOwner.test.ts
//
// Reminders read share by share (29.10.2026, BACKLOG 5.3): a group's events, and each owner's personal ones.
// Until then the job read every account's events together, under one cap and one time: one account's flood
// reached them first and every reminder behind it was lost, for everybody. Now each share is read with its
// own cap and time, every share gets a first turn before any gets a second, all inside one deadline for the
// whole reading, and a flood costs the share it was written into.
// Run against the emulators through `npm run test:rules`, through the real job where it matters.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Query } from 'firebase-admin/firestore';
import { awayFromEdge } from './clockEdges';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const EVENT = { scheduleTime: new Date().toISOString(), jobName: 'test' };
const ALICE = 'uid-po-alice';
const MALLORY = 'uid-po-mallory';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** An instant five minutes ago, to the minute: a reminder at it is due in this run. */
const dueAt = () => Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;
const dueEvent = (owner: string, extra: Record<string, unknown> = {}) => {
  const at = dueAt();
  return {
    ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(at)}T00:00:00.000Z`, time: clockOf(at),
    timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner], ...extra,
  };
};
/** An event in the read's window with no reminder: it is read, and costs its owner's share. */
const filler = (owner: string) => ({ ownerId: owner, groupId: null, title: 'f', date: `${dayOf(Date.now())}T00:00:00.000Z` });

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
const sentFor = async (eventId: string) => (await db.doc(`reminder_log/${eventId}__${dayOf(dueAt())}`).get()).exists;
const runJob = () => (mod.sendDueReminders as unknown as { run: (e: unknown) => Promise<void> }).run(EVENT);
const marker = async () => (await db.doc('jobRuns/sendDueReminders').get()).data();
/** A document the scans for owners and groups brought: one a value, only `ownerId` or only `groupId`. */
const ownerScan = (d: admin.firestore.QueryDocumentSnapshot) => { const k = Object.keys(d.data()); return k.length === 1 && (k[0] === 'ownerId' || k[0] === 'groupId'); };

/** A clock that moves `step` on every page of the computation's reads (not the owners' scan). */
function pagedClock(step: number) {
  const clock = { t: 0 };
  const realGet = Query.prototype.get;
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    if (snap.docs.some((d) => !ownerScan(d))) clock.t += step;
    return snap;
  } as never);
  return clock;
}

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

describe('a flood costs only the account that made it', () => {
  it('one account past the job’s own cap: its read stops, red, and the other account’s reminder goes out', async () => {
    await seed({ ...many('!flood', mod.MAX_CANDIDATES + 1, () => filler(MALLORY)), dentist: dueEvent(ALICE) });
    await runJob();
    expect(await sentFor('dentist')).toBe(true);
    const m = await marker();
    expect(m).toMatchObject({ ok: false });
    expect(m!.detail).toContain('stopped early 1');
  }, 240_000);

  it('the same through the time: an owner past their own time does not take another owner’s', async () => {
    await seed({ ...many('m', 12, () => filler(MALLORY)), dentist: dueEvent(ALICE) });
    // Every page ten seconds: Mallory's read is past its fifteen seconds after two pages of four.
    const clock = pagedClock(10_000);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { page: 4, concurrency: 1, clock: () => clock.t, readsDeadlineMs: Number.POSITIVE_INFINITY });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ owners: 2, cut: 1, read: 8 + 1, sent: 1 });
    expect(await sentFor('dentist')).toBe(true);
  }, 120_000);
});

describe('the whole reading has one deadline', () => {
  it('past it, an owner not done is cut, and one not yet started is cut without a read', async () => {
    // Two owners alike, so the counts are the same whoever goes first: three pages each; a page ten
    // seconds; each read's own time out of the way, the deadline at 25 s. The first owner reads three pages
    // and is cut at the fourth look; the second finds the deadline gone.
    await seed({ ...many('a', 12, () => filler(ALICE)), ...many('m', 12, () => filler(MALLORY)) });
    const clock = pagedClock(10_000);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, {
      page: 4, concurrency: 1, clock: () => clock.t, budgetMs: Number.POSITIVE_INFINITY, readsDeadlineMs: 25_000,
    });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ owners: 2, cut: 2, read: 12 });
    expect(mod.reminderOutcome(counts).failed).toBeGreaterThan(0);
  }, 120_000);
});

describe('the owners', () => {
  it('are found from the events, one document each and only its owner; an account with no profile is reminded', async () => {
    const NOUSER = 'uid-po-no-users-doc';
    await seed({ ...many('a', 25, () => filler(ALICE)), ...many('m', 25, () => filler(MALLORY)), lonely: dueEvent(NOUSER) });
    const scanned: string[] = [];
    const realGet = Query.prototype.get;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      for (const d of snap.docs) if (ownerScan(d)) scanned.push(d.get('ownerId'));
      return snap;
    } as never);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts);
    vi.restoreAllMocks();
    // One read an owner, in `ownerId` order, whatever their number of events.
    expect(scanned).toEqual([ALICE, MALLORY, NOUSER]);
    expect(counts).toMatchObject({ owners: 3, cut: 0, read: 51 });
    expect((await db.doc(`users/${NOUSER}`).get()).exists).toBe(false);
    expect(await sentFor('lonely')).toBe(true);
  }, 120_000);

  it('past their cap, the scan stops there and the run is red', async () => {
    await seed({ first: dueEvent(ALICE), second: dueEvent(MALLORY) });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { maxOwners: 1 });
    // `ownerId` order: Alice is found, Mallory is past the cap.
    expect(counts).toMatchObject({ owners: 1, cut: 1 });
    expect(await sentFor('first')).toBe(true);
    expect(await sentFor('second')).toBe(false);
    // Exactly the cap is not past it.
    const exact = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), exact, { maxOwners: 2 });
    expect(exact).toMatchObject({ owners: 2, cut: 0 });
    expect(await sentFor('second')).toBe(true);
  }, 120_000);

  it('take turns: the start moves a third of the ring a run, and every share is read once', () => {
    const slot = mod.RUN_EVERY_MS;
    const at = (k: number) => 999 * slot + k * slot + 17; // a slot whose number is a multiple of 9
    // Nine shares: three runs see one reminder, and their starts are three apart, so the tails a deadline
    // cuts in those runs do not overlap (review, 29.10.2026: moved one a run, the same share was cut run
    // after run).
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect([0, 1, 2].map((k) => mod.ownerTurn(nine, at(k))[0])).toEqual(['a', 'd', 'g']);
    for (let k = 0; k < 9; k++) expect([...mod.ownerTurn(nine, at(k))].sort()).toEqual(nine);
    // Few shares: a step of one, as before.
    expect([0, 1, 2, 3].map((k) => mod.ownerTurn(['a', 'b', 'c'], at(k))[0])).toEqual(['a', 'b', 'c', 'a']);
    expect(mod.ownerTurn([], at(0))).toEqual([]);
  });

  it('read one at a time or eight at a time, the same events, the same reminders', async () => {
    await seed({
      ...many('a', 7, () => filler(ALICE)), ...many('m', 9, () => filler(MALLORY)),
      dentist: dueEvent(ALICE), other: dueEvent(MALLORY), third: dueEvent('uid-po-third'),
    });
    const one = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), one, { concurrency: 1, sendBudgetMs: 0 });
    const eight = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), eight, { concurrency: 8, sendBudgetMs: 0 });
    const pick = (c: typeof one) => ({ owners: c.owners, read: c.read, candidates: c.candidates, occurrences: c.occurrences, due: c.due, cut: c.cut });
    expect(pick(eight)).toEqual(pick(one));
    expect(pick(one)).toMatchObject({ owners: 3, read: 19, due: 3, cut: 0 });
  }, 120_000);
});

describe('every share gets a first turn before any gets a second', () => {
  /** A `now` for which this run reads `first` ahead of the other owner; a run one slot on still sees the reminder. */
  const nowWithFirst = (first: string, owners: string[]) => {
    const now = Date.now();
    return mod.ownerTurn([...owners].sort(), now)[0] === first ? now : now + mod.RUN_EVERY_MS;
  };

  it('a share that would read until the deadline does not hold the worker: the share behind it is read', async () => {
    await seed({ ...many('md', 40, () => filler(MALLORY)), dentist: dueEvent(ALICE) });
    const now = nowWithFirst(MALLORY, [ALICE, MALLORY]);
    // One worker, as many slow shares fill many; every page five seconds; a read's own time out of the way,
    // so Mallory could read until the deadline (25 s). Without the first turn she does, and Alice is cut
    // without a read; with it, Alice is read after Mallory's first eight events, and Mallory goes on after.
    const clock = pagedClock(5_000);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, now, counts, {
      page: 4, concurrency: 1, firstShare: 8, clock: () => clock.t, budgetMs: Number.POSITIVE_INFINITY,
      readsDeadlineMs: 25_000, sendBudgetMs: 0,
    });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ owners: 2, cut: 1, due: 1 });
  }, 120_000);

  it('the second turn goes on with the time the first took, not a new fifteen seconds', async () => {
    await seed({ ...many('md', 20, () => filler(MALLORY)), dentist: dueEvent(ALICE) });
    const now = nowWithFirst(MALLORY, [ALICE, MALLORY]);
    // Every page five seconds. First turn: Mallory's two pages (8 events, 10 s), Alice's page. Second turn:
    // Mallory has five seconds left, one page, then she is past her fifteen.
    const clock = pagedClock(5_000);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, now, counts, {
      page: 4, concurrency: 1, firstShare: 8, clock: () => clock.t, readsDeadlineMs: Number.POSITIVE_INFINITY,
    });
    vi.restoreAllMocks();
    expect(counts).toMatchObject({ cut: 1, read: 12 + 1, sent: 1 });
  }, 120_000);
});

describe('a group is a share of its own', () => {
  const G = 'g-po-family';
  const H = 'g-po-other';

  it('events written into a group fill that group’s share: not its members’ personal ones, nor another group’s', async () => {
    // What a member can write into another member's name: edits of an occurrence of Alice's group series
    // (`createEventOverride` gives them her owner and her group), as many as the member asks for.
    await seed({
      ...many('!edit', 30, () => ({ ...filler(ALICE), groupId: G, overrideOfParent: 'alice-series', overrideDate: dayOf(Date.now()) })),
      dentist: dueEvent(ALICE),
      other: dueEvent(ALICE, { groupId: H }),
      inG: dueEvent(MALLORY, { groupId: G }),
    });
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts, { maxCandidates: 10 });
    // Shares: Alice's and Mallory's personal ones, G and H. Only G is past its cap.
    expect(counts).toMatchObject({ owners: 2, groups: 2, cut: 1 });
    expect(await sentFor('dentist')).toBe(true);
    expect(await sentFor('other')).toBe(true);
  }, 120_000);

  it('groups are found from the events, one document each; personal events are no group', async () => {
    await seed({ a: dueEvent(ALICE, { groupId: G }), b: dueEvent(MALLORY, { groupId: H }), c: dueEvent(MALLORY) });
    const groupsScanned: string[] = [];
    const realGet = Query.prototype.get;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      for (const d of snap.docs) if (ownerScan(d) && Object.keys(d.data())[0] === 'groupId') groupsScanned.push(d.get('groupId'));
      return snap;
    } as never);
    const counts = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), counts);
    vi.restoreAllMocks();
    expect(groupsScanned.sort()).toEqual([G, H]);
    expect(counts).toMatchObject({ owners: 2, groups: 2, cut: 0, due: 3, sent: 3 });
  }, 120_000);
});
