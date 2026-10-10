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

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const EVENT = { scheduleTime: new Date().toISOString(), jobName: 'test' };
const DAY = 86_400_000;

let db: admin.firestore.Firestore;
let mod: typeof import('../src/games');

const fresh = () => ({ gameType: 'tic-tac-toe', groupId: 'g1', lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now()) });
const idle = () => ({ gameType: 'tic-tac-toe', groupId: 'g2', lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3 * DAY) });
const counts = () => ({ scanned: 0, due: 0, closed: 0, raced: 0, failed: 0, slowLap: 0, cut: 0 });
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
