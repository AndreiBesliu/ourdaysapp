// functions/test/gamesExpiry.test.ts
//
// The idle-game sweep reads a WINDOW of the collection that moves on from run to run (10.10.2026).
// Until then every run read the first 2000 games by id, so anybody who created that many games with
// ids that sort first (`!…`) hid every other group's games from it for good: none would ever expire.
// Run against the Firestore emulator through `npm run test:rules`, with a small window, page and cap so
// a handful of documents plays the part of thousands.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { expiryRefusal } from '../src/gameSession';
import { fingerprint } from '../src/errorGrouping';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const EVENT = { scheduleTime: new Date().toISOString(), jobName: 'test' };
const DAY = 86_400_000;

let db: admin.firestore.Firestore;
let mod: typeof import('../src/games');

const fresh = () => ({ gameType: 'tic-tac-toe', groupId: 'g1', lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now()) });
const idle = () => ({ gameType: 'tic-tac-toe', groupId: 'g2', lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3 * DAY) });
const counts = () => ({ scanned: 0, due: 0, closed: 0, raced: 0, failed: 0, unclosable: 0, slowLap: 0, cut: 0 });
type Opts = Parameters<typeof import('../src/games').sweepIdleGames>[4];
const run = async (opts: Opts = {}) => {
  const c = counts();
  const r = await mod.sweepIdleGames(db, Date.now(), c, {}, { window: 5, page: 2, ...opts });
  return { counts: c, ...r };
};
const isClosed = async (id: string) => (await db.doc(`games/${id}`).get()).data()?.finalized === true;
const state = async () => (await db.doc(mod.SWEEP_STATE_DOC).get()).data();
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);

async function seed(docs: Record<string, Record<string, unknown>>) {
  const batch = db.batch();
  for (const [id, data] of Object.entries(docs)) batch.set(db.doc(`games/${id}`), data);
  await batch.commit();
}
const many = (prefix: string, n: number, make: () => Record<string, unknown>) =>
  Object.fromEntries(ids(prefix, n).map((id) => [id, make()]));

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/games');
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('the window moves on from run to run', () => {
  it('an idle game behind many active ones that sort first is still reached and closed', async () => {
    // The old `limit(n)` read these twelve, and only these, every run.
    await seed({ ...many('!a', 12, fresh), 'game-real': idle() });
    const closedAfter: boolean[] = [];
    for (let i = 0; i < 3; i++) { await run(); closedAfter.push(await isClosed('game-real')); }
    expect(closedAfter).toEqual([false, false, true]);
  });

  it('idle games past the cap are not passed over: the next run starts at the first one not tried', async () => {
    // An attacker's idle games sort first and are re-opened every hour; two more than the cap.
    await seed({ ...many('!x', 4, idle), 'game-real': idle() });
    const r1 = await run({ perRun: 2, window: 50 });
    expect(r1.counts).toMatchObject({ due: 2, closed: 2, cut: 1 });
    expect(await isClosed('game-real')).toBe(false);
    // Re-opened by the attacker before the next run.
    for (const id of ids('!x', 4)) await db.doc(`games/${id}`).update({ finalized: false });
    await run({ perRun: 2, window: 50 });
    const r3 = await run({ perRun: 2, window: 50 });
    // Two runs to get past the attacker's four; the third reaches the real one, whatever was re-opened.
    expect(await isClosed('game-real')).toBe(true);
    expect(r3.counts.closed).toBeGreaterThan(0);
  });

  it('a run out of time stops in front of the next idle game, and the next run starts there', async () => {
    await seed(many('g', 4, idle));
    let t = 0;
    // Each look at the clock is a second later; the budget is three seconds.
    const r1 = await run({ window: 50, timeBudgetMs: 3000, clock: () => (t += 1000) });
    expect(r1.counts.cut).toBe(1);
    const closed1 = (await Promise.all(ids('g', 4).map(isClosed))).filter(Boolean).length;
    expect(closed1).toBeGreaterThan(0);
    expect(closed1).toBeLessThan(4);
    await run({ window: 50 });
    expect((await Promise.all(ids('g', 4).map(isClosed))).every(Boolean)).toBe(true);
  });

  it('out of time between pages, the run ends there with its work saved; a page is at most 50 games', async () => {
    // Nothing to close, so only the look at the clock between pages can stop the run. The job's own
    // window and page: a page of padded games must not be able to run the function out of memory.
    await seed(many('g', 60, fresh));
    let looks = 0;
    // The run starts at 0; every later look is past the 40 s budget.
    const c = counts();
    await mod.sweepIdleGames(db, Date.now(), c, {}, { clock: () => (looks++ === 0 ? 0 : 60_000) });
    expect(c).toMatchObject({ scanned: 50, cut: 1 });
    expect((await state())?.after).toBe('g49');
  });

  it('a window larger than the collection reads every game once, from wherever it starts', async () => {
    await seed(many('g', 7, fresh));
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: 'g03', lapRuns: 0, lastLapRuns: null });
    const r = await run({ window: 10 });
    expect(r.counts.scanned).toBe(7);
    expect(r.lapRuns).toBe(0);
    expect((await state())?.after).toBeNull();
  });

  it('a game it tried moves the window on past it: the next page does not read it again', async () => {
    await seed({ g00: fresh(), g01: idle(), g02: fresh(), g03: idle() });
    const r = await run({ window: 4, page: 2 });
    // Four reads, four games: the closed one is not read again at the top of the next page.
    expect(r.counts).toMatchObject({ scanned: 4, closed: 2 });
    expect((await state())?.after).toBe('g03');
  });

  it('closes every idle game in a turn, each exactly once', async () => {
    await seed(Object.fromEntries(ids('g', 11).map((id, i) => [id, i % 2 ? idle() : fresh()])));
    let closed = 0;
    for (let i = 0; i < 3; i++) closed += (await run()).counts.closed;
    expect(closed).toBe(5);
    for (const id of ids('g', 11).filter((_, i) => i % 2)) expect(await isClosed(id)).toBe(true);
  });

  it('a run that dies mid-window resumes at the page it died in, not from the start', async () => {
    await seed(many('g', 6, fresh));
    const real = db.collection.bind(db);
    let calls = 0;
    vi.spyOn(db, 'collection').mockImplementation(((p: string) => {
      if (p === 'games' && ++calls === 2) throw new Error('injected: page 2 unreadable');
      return real(p);
    }) as never);
    await expect(run({ window: 6, page: 2 })).rejects.toThrow('injected');
    expect((await state())?.after).toBe('g01');
    vi.restoreAllMocks();
    const r = await run({ window: 2, page: 2 });
    expect(r.counts.scanned).toBe(2);
    expect((await state())?.after).toBe('g03');
  });

  it('a cursor that cannot be read fails the run instead of starting again from the top', async () => {
    await seed({ a: idle() });
    const realGet = admin.firestore.DocumentReference.prototype.get;
    vi.spyOn(admin.firestore.DocumentReference.prototype, 'get').mockImplementation(function (this: admin.firestore.DocumentReference, ...args: unknown[]) {
      if (this.path === mod.SWEEP_STATE_DOC) return Promise.reject(new Error('injected: state unreadable'));
      return (realGet as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    } as never);
    await expect(run()).rejects.toThrow('injected');
    expect(await isClosed('a')).toBe(false);
  });

  it('the window reads only the fields the verdict reads, and they are enough for it', async () => {
    const src = (await import('node:fs')).readFileSync('functions/src/games.ts', 'utf8');
    expect(src).toContain('.select(...VERDICT_FIELDS)');
    const fields = /const VERDICT_FIELDS = \[([^\]]*)\]/.exec(src)![1].match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1));
    const pick = (g: Record<string, unknown>) => Object.fromEntries(Object.entries(g).filter(([k]) => fields.includes(k)));
    const now = Date.now();
    const games: Record<string, unknown>[] = [
      { gameType: 'warlord-battle' }, { gameType: 'tic-tac-toe', finalized: true }, idle(), fresh(),
      { gameType: 'tic-tac-toe', createdAt: admin.firestore.Timestamp.fromMillis(now - 3 * DAY) },
      { gameType: 'tic-tac-toe', lastMoveAt: admin.firestore.Timestamp.fromMillis(now + 3 * DAY) },
      { gameType: 'tic-tac-toe', createdAt: admin.firestore.Timestamp.fromMillis(now - 3 * DAY), date: new Date(now + 3 * DAY).toISOString().slice(0, 10) },
      { gameType: 'rummy-45', state: { players: {} }, winner: 'x', padding: 'x'.repeat(1000) },
    ];
    for (const g of games) expect(expiryRefusal(pick(g), now), JSON.stringify(Object.keys(g))).toBe(expiryRefusal(g, now));
  });
});

describe('the turn, for the health panel', () => {
  it('counts the runs a turn takes, and starts the next one', async () => {
    await seed(many('g', 12, fresh));
    const seen = [];
    for (let i = 0; i < 4; i++) { const r = await run(); seen.push([r.counts.scanned, r.lapRuns, r.lastLapRuns]); }
    // 12 games, 5 a run: two runs into the turn, the third reaches the end, the fourth begins again.
    expect(seen).toEqual([[5, 1, null], [5, 2, null], [5, 0, 3], [5, 1, 3]]);
    expect(await state()).toMatchObject({ lapRuns: 1, lastLapRuns: 3 });
  });

  it('a turn longer than allowed counts against every run until a turn ends within it again', async () => {
    await seed(many('g', 12, fresh));
    const slow: number[] = [];
    // A three-run turn against a limit of two: slow from the third run of the turn on…
    for (let i = 0; i < 4; i++) slow.push((await run({ maxLapRuns: 2 })).counts.slowLap);
    expect(slow).toEqual([0, 0, 1, 1]);
    // …and once the turns fit (a window that reads them all), green again.
    expect((await run({ maxLapRuns: 2, window: 50 })).counts.slowLap).toBe(0);
  });

  it('a cursor or a count that is not one starts from the beginning', async () => {
    await seed({ a: fresh(), b: fresh() });
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: 5, lapRuns: 'x', lastLapRuns: -3 });
    const r = await run();
    expect(r.counts.scanned).toBe(2);
    expect(r).toMatchObject({ lapRuns: 0, lastLapRuns: 1 });
    // A count that is not one, on a turn that does not end in this run, is read as 0, never kept.
    await seed(many('g', 12, fresh));
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 'x', lastLapRuns: -3 });
    expect((await run()).lastLapRuns).toBe(0);
  });

  it('a cursor that cannot be written at the end is counted as a failure, after the work is done', async () => {
    await seed({ a: idle() });
    const realSet = admin.firestore.DocumentReference.prototype.set;
    vi.spyOn(admin.firestore.DocumentReference.prototype, 'set').mockImplementation(function (this: admin.firestore.DocumentReference, ...args: unknown[]) {
      if (this.path === mod.SWEEP_STATE_DOC) return Promise.reject(new Error('injected: state unwritable'));
      return (realSet as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    } as never);
    const r = await run();
    expect(r.counts.closed).toBe(1);
    expect(r.counts.failed).toBe(1);
  });

  it('the line for the panel has the same words every run; only numbers change', () => {
    const shape = (s: string) => s.replace(/\d+/g, '#');
    const lines = [
      mod.sweepDetail(counts(), { lapRuns: 0, lastLapRuns: 1 }),
      mod.sweepDetail({ ...counts(), scanned: 2000, due: 5, cut: 1, slowLap: 1 }, { lapRuns: 7, lastLapRuns: null }),
      mod.sweepDetail({ ...counts(), failed: 3 }, { lapRuns: 30, lastLapRuns: 31 }),
    ];
    expect(new Set(lines.map(shape)).size).toBe(1);
    expect(lines[0].length).toBeLessThanOrEqual(200);
  });
});

describe('a game nobody can write any more', () => {
  // A member can pad a game to just under the 1 MiB a document may hold (the board, the hands — the
  // rules type the fields the panels read, not how much a game holds). Closing it adds a few fields,
  // and the server refuses the write: INVALID_ARGUMENT, "maximum entity size". Until 10.10.2026 that
  // counted as a failure on every run that met it, and the job stayed red for good.
  // The pad that fits under the limit with these fields and this id, on the emulator (measured the
  // same day: 1 048 455 is the most it takes); the few bytes closing adds do not.
  const fat = () => ({ ...idle(), state: { pad: 'x'.repeat(1_048_440) } });

  it('is counted as unclosable, not as a failure, and the run goes on to the next', async () => {
    await seed({ fat: fat(), g01: idle() });
    const r = await run({ window: 10 });
    expect(r.counts).toMatchObject({ scanned: 2, due: 2, closed: 1, failed: 0, unclosable: 1 });
    expect(await isClosed('g01')).toBe(true);
    expect(await isClosed('fat')).toBe(false);
  });

  it('and the health marker stays ok, with the game in the line', async () => {
    await seed({ fat: fat() });
    await (mod.expireIdleGames as unknown as { run: (e: unknown) => Promise<void> }).run(EVENT);
    const m = (await db.doc('jobRuns/expireIdleGames').get()).data();
    expect(m).toMatchObject({ ok: true });
    expect(m!.detail).toContain('failed 0, unclosable 1');
  });

  // Every gRPC code but INVALID_ARGUMENT, and an error with none (the SDK's own checks): the retryable
  // ones the SDK gives up on, and the refusals that say nothing about the document. A classifier wider
  // than "3" would hide one of these.
  it.each([
    [1, 'CANCELLED'], [2, 'UNKNOWN'], [4, 'DEADLINE_EXCEEDED'], [5, 'NOT_FOUND'], [6, 'ALREADY_EXISTS'],
    [7, 'PERMISSION_DENIED'], [8, 'RESOURCE_EXHAUSTED'], [9, 'FAILED_PRECONDITION'], [10, 'ABORTED'],
    [11, 'OUT_OF_RANGE'], [12, 'UNIMPLEMENTED'], [13, 'INTERNAL'], [14, 'UNAVAILABLE'], [15, 'DATA_LOSS'],
    [16, 'UNAUTHENTICATED'], [undefined, 'no code'],
  ])('a close that fails with code %s (%s) is still a failure', async (code, name) => {
    await seed({ g01: idle() });
    vi.spyOn(db, 'runTransaction').mockRejectedValue(Object.assign(new Error(`${code} ${name}: injected`), code === undefined ? {} : { code }));
    const r = await run({ window: 10 });
    expect(r.counts).toMatchObject({ due: 1, closed: 0, failed: 1, unclosable: 0 });
  });

  // Counted in the line is not reported: a green line that changes every hour reaches nobody. A run
  // that meets such a game for the first time leaves ONE row in errorLogs (the Health panel's
  // problems, the digest), and the ids go where the row says, so the next runs do not repeat it.
  const reports = async () => (await db.collection('errorLogs').where('context', '==', 'job:expireIdleGames:unclosable').get()).docs;
  const WEEK = 7 * 86_400_000;
  /** Small, fresh games that sort after the padded ones and keep a turn from ending in one run. */
  const others = (n: number) => many('old', n, fresh);

  it('is reported once, in errorLogs, with the ids kept in the sweep’s state', async () => {
    await seed({ fat: fat(), g01: idle() });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
    expect((await state())?.unclosable).toEqual(['fat']);
    // The next turn meets it again, and says nothing new.
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
    // A second one is news: one row more.
    await seed({ fat2: fat() });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(2);
    expect((await state())?.unclosable).toEqual(['fat', 'fat2']);
  });

  it('one row a run, however many are new, and the same problem every time', async () => {
    await seed({ fat: fat(), fat2: fat(), fat3: fat() });
    await run({ window: 10 });
    const rows = await reports();
    expect(rows).toHaveLength(1);
    expect(rows[0].data().message).toContain('3 idle game(s) cannot be closed');
    expect((await state())?.unclosable).toEqual(['fat', 'fat2', 'fat3']);
    await seed({ fat4: fat() });
    await run({ window: 10 });
    const again = await reports();
    expect(again).toHaveLength(2);
    const prints = new Set(again.map((d) => fingerprint(d.data().message, d.data().context)));
    expect(prints.size).toBe(1);
  });

  it('a game met for the first time is remembered only once its row is written: a run that dies after it reports it next time', async () => {
    await seed({ fat: fat(), g01: idle(), g02: idle() });
    const real = db.collection.bind(db);
    let pages = 0;
    vi.spyOn(db, 'collection').mockImplementation(((p: string) => {
      if (p === 'games' && ++pages === 2) throw new Error('injected: page 2 unreadable');
      return real(p);
    }) as never);
    await expect(run({ window: 10, page: 2 })).rejects.toThrow('injected');
    expect(await reports()).toHaveLength(0);
    expect((await state())?.unclosable ?? []).toEqual([]);
    vi.restoreAllMocks();
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
    expect((await state())?.unclosable).toEqual(['fat']);
  });

  it('a row that cannot be written is a failure of the run, and the game is news the next time', async () => {
    await seed({ fat: fat() });
    const real = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation(((p: string) => {
      if (p !== 'errorLogs') return real(p);
      return { add: () => Promise.reject(Object.assign(new Error('14 UNAVAILABLE: injected'), { code: 14 })) };
    }) as never);
    const r = await run({ window: 10 });
    expect(r.counts).toMatchObject({ unclosable: 1, failed: 1 });
    vi.restoreAllMocks();
    expect((await state())?.unclosable).toEqual([]);
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
    expect((await state())?.unclosable).toEqual(['fat']);
  });

  it('reported again a week after the last row while it is still met, and not sooner', async () => {
    await seed({ fat: fat() });
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 0, lastLapRuns: null, unclosable: ['fat'], unclosableReportedAt: Date.now() - WEEK + 3_600_000 });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(0);
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 0, lastLapRuns: null, unclosable: ['fat'], unclosableReportedAt: Date.now() - WEEK - 1000 });
    await run({ window: 10 });
    const rows = await reports();
    expect(rows).toHaveLength(1);
    // The games met in the run, not only the new ones: here one, and none of it news.
    expect(rows[0].data().message).toContain('1 idle game(s) cannot be closed');
    expect((await state())?.unclosableReportedAt).toBeGreaterThan(Date.now() - 60_000);
    // A week has to pass again.
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
    expect(mod.UNCLOSABLE_REPORT_EVERY_MS).toBe(WEEK);
  });

  it('is tried again each turn, and closed once it can be; it then leaves the list', async () => {
    await seed({ fat: fat() });
    await run({ window: 10 });
    expect((await state())?.unclosable).toEqual(['fat']);
    // Somebody makes it small again.
    await db.doc('games/fat').update({ state: {} });
    const r = await run({ window: 10 });
    expect(r.counts).toMatchObject({ closed: 1, unclosable: 0 });
    expect((await state())?.unclosable).toEqual([]);
  });

  it('a game played again leaves the list too', async () => {
    await seed({ fat: fat() });
    await run({ window: 10 });
    await db.doc('games/fat').update({ lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now()) });
    const r = await run({ window: 10 });
    expect(r.counts).toMatchObject({ due: 0, unclosable: 0 });
    expect((await state())?.unclosable).toEqual([]);
  });

  it('and a game deleted since leaves it when a turn ends', async () => {
    await seed({ fat: fat() });
    await run({ window: 10 });
    expect((await state())?.unclosable).toEqual(['fat']);
    await db.doc('games/fat').delete();
    await run({ window: 10 });
    expect((await state())?.unclosable).toEqual([]);
  });

  it('but not before the turn ends', async () => {
    await seed({ fat: fat() });
    await run({ window: 10 });
    await db.doc('games/fat').delete();
    await seed(others(12));
    await run({ window: 5 });
    expect((await state())?.unclosable).toEqual(['fat']);
  });

  it('one met again moves to the end of the list, so it is not the first to go', async () => {
    // The listed games exist and this run reads only the two padded ones, so the turn does not end
    // and no listed game is met: only the cap shortens the list.
    await seed(others(mod.UNCLOSABLE_KEPT - 1));
    await seed({ fat: fat(), fat2: fat() });
    await db.doc(mod.SWEEP_STATE_DOC).set({
      after: null, lapRuns: 0, lastLapRuns: null, unclosableReportedAt: Date.now(),
      unclosable: ['fat', ...ids('old', mod.UNCLOSABLE_KEPT - 1)],
    });
    await run({ window: 2 });
    const kept = (await state())?.unclosable as string[];
    expect(kept).toHaveLength(mod.UNCLOSABLE_KEPT);
    expect(kept.slice(-2)).toEqual(['fat', 'fat2']);
    expect(kept).not.toContain('old00');
    expect(await reports()).toHaveLength(1);
  });

  it('the list is bounded, and keeps the latest', async () => {
    await seed(others(mod.UNCLOSABLE_KEPT));
    await seed({ fat: fat() });
    await db.doc(mod.SWEEP_STATE_DOC).set({
      after: null, lapRuns: 0, lastLapRuns: null, unclosableReportedAt: Date.now(), unclosable: ids('old', mod.UNCLOSABLE_KEPT),
    });
    await run({ window: 1 });
    const kept = (await state())?.unclosable as string[];
    expect(kept).toHaveLength(mod.UNCLOSABLE_KEPT);
    expect(kept[kept.length - 1]).toBe('fat');
    expect(kept).not.toContain('old00');
  });

  it('a list of anything else is read as an empty one', async () => {
    await seed({ fat: fat() });
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 0, lastLapRuns: null, unclosableReportedAt: Date.now(), unclosable: [5, { a: 1 }, 'fat', ''] });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(0);
    expect((await state())?.unclosable).toEqual(['fat']);
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 0, lastLapRuns: null, unclosableReportedAt: Date.now(), unclosable: 'fat' });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
  });

  it('a report time that is not one is read as never', async () => {
    await seed({ fat: fat() });
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: null, lapRuns: 0, lastLapRuns: null, unclosable: ['fat'], unclosableReportedAt: 'yesterday' });
    await run({ window: 10 });
    expect(await reports()).toHaveLength(1);
  });
});

describe('the scheduled job', () => {
  it('reports the turn on the health marker', async () => {
    await seed({ a: fresh() });
    await (mod.expireIdleGames as unknown as { run: (e: unknown) => Promise<void> }).run(EVENT);
    const m = (await db.doc('jobRuns/expireIdleGames').get()).data();
    expect(m).toMatchObject({ ok: true });
    expect(m!.detail).toContain('scanned 1');
    expect(m!.detail).toContain('turn 0/1');
  });

  it('a slow turn turns the marker not ok', async () => {
    await seed({ a: fresh() });
    // Already past the limit, and the turn ends in this run (nothing sorts after 'a').
    await db.doc(mod.SWEEP_STATE_DOC).set({ after: 'a', lapRuns: mod.MAX_LAP_RUNS + 2, lastLapRuns: null });
    await (mod.expireIdleGames as unknown as { run: (e: unknown) => Promise<void> }).run(EVENT);
    const m = (await db.doc('jobRuns/expireIdleGames').get()).data();
    expect(m).toMatchObject({ ok: false });
  });
});
