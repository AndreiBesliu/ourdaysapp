// functions/test/jobRuns.test.ts
//
// The scheduled jobs leave markers, and the health check reads them — run through the REAL handlers
// (`.run()`) on the emulator, on a success path and on a failure path each. A source check can be
// satisfied by a marker that is never written; only running the job shows it is.
//
// Failures are injected at the job's first read (a spy on the one Firestore instance), so the job's
// own catch path runs, not a copy of it. See functions/src/jobRuns.ts and jobHealthCore.ts.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  JOB_SCHEDULE, STUCK_MS, STARTS_WITHOUT_END_FAIL, LOGS_HINT, cronMinutes, type JobName,
} from '../src/jobHealthCore';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const ADMIN = 'uid-job-admin';

type Job = { run: (e: unknown) => Promise<void>; __endpoint: Record<string, any> };
let mod: Record<string, unknown>;
let jobs: Record<JobName, Job>;
let adminGetHealth: { run: (req: CallableRequest<unknown>) => Promise<any> };
let runJob: typeof import('../src/jobRuns').runJob;
let markJobStart: typeof import('../src/jobRuns').markJobStart;
let db: admin.firestore.Firestore;

const EVENT = { scheduleTime: new Date().toISOString(), jobName: 'test' };
const marker = async (name: string) => (await db.doc(`jobRuns/${name}`).get()).data();
const errorRows = async (name: string) =>
  (await db.collection('errorLogs').get()).docs.map((d) => d.data()).filter((r) => r.context === `job:${name}`);

/** Throw on the FIRST `collection(path)` call only, so the job fails at its first read while the
 *  error row that reports it (errorLogs) can still be written. */
function failFirstRead(path: string) {
  const real = db.collection.bind(db);
  let armed = true;
  return vi.spyOn(db, 'collection').mockImplementation(((p: string) => {
    if (armed && p === path) { armed = false; throw new Error(`injected: ${path} unreadable`); }
    return real(p);
  }) as never);
}

const FIRST_READ: Record<JobName, string> = {
  sendDueReminders: 'events',
  expireIdleGames: 'games',
  logErrorDigest: 'errorLogs',
};

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  mod = (await import('../src/index')) as Record<string, unknown>;
  jobs = Object.fromEntries(JOB_SCHEDULE.map((j) => [j.name, mod[j.name] as Job])) as Record<JobName, Job>;
  adminGetHealth = mod.adminGetHealth as never;
  ({ runJob, markJobStart } = await import('../src/jobRuns'));
  db = admin.firestore();
  // The spies below replace a method on THIS instance; the handlers must be using the same one.
  expect(admin.firestore()).toBe(db);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('what the deploy reads (`__endpoint`)', () => {
  it('schedules exactly the jobs on the list, in cron, at the listed interval, in UTC', () => {
    const scheduled = Object.entries(mod)
      .filter(([, v]) => typeof v === 'function' && (v as Job).__endpoint?.scheduleTrigger)
      .map(([k, v]) => ({ name: k, trigger: (v as Job).__endpoint.scheduleTrigger, timeout: (v as Job).__endpoint.timeoutSeconds }));
    expect(scheduled.map((s) => s.name).sort()).toEqual(JOB_SCHEDULE.map((j) => j.name).sort());
    for (const s of scheduled) {
      const j = JOB_SCHEDULE.find((x) => x.name === s.name)!;
      expect(cronMinutes(s.trigger.schedule), `${s.name}: "${s.trigger.schedule}"`).toBe(j.everyMinutes);
      expect(s.trigger.timeZone).toBe('UTC');
      // "stuck" must not fire on a run still inside its timeout: the platform default is 60 s.
      const timeout = typeof s.timeout === 'number' ? s.timeout : 60;
      expect(STUCK_MS, `${s.name}: timeout ${timeout}s`).toBeGreaterThan(timeout * 1000 * 5);
    }
  });
});

describe('a run that succeeds', () => {
  for (const j of JOB_SCHEDULE) {
    it(`${j.name} leaves { at, ok: true, detail, failStreak: 0 } and nothing of its start`, async () => {
      const before = Date.now();
      await jobs[j.name].run(EVENT);
      const after = Date.now();
      const m = await marker(j.name);
      expect(m).toBeTruthy();
      expect(m!.ok).toBe(true);
      expect(m!.failStreak).toBe(0);
      expect(m!.at).toBeGreaterThanOrEqual(before);
      expect(m!.at).toBeLessThanOrEqual(after);
      expect(typeof m!.detail).toBe('string');
      expect(m!.detail.length).toBeGreaterThan(0);
      // The end REPLACES the document: a start marker left behind would read as "still running".
      expect(m).not.toHaveProperty('startedAt');
      expect(m).not.toHaveProperty('startsSinceEnd');
      expect(await errorRows(j.name)).toEqual([]);
    });
  }
});

describe('a run that throws', () => {
  for (const j of JOB_SCHEDULE) {
    it(`${j.name}: re-thrown, marked not ok, one error row — and the streak counts, then resets`, async () => {
      failFirstRead(FIRST_READ[j.name]);
      await expect(jobs[j.name].run(EVENT)).rejects.toThrow('injected');
      let m = await marker(j.name);
      expect(m).toMatchObject({ ok: false, failStreak: 1 });
      expect(m!.detail).toContain('injected');
      const rows = await errorRows(j.name);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'server' });
      expect(rows[0].message).toContain('injected');

      vi.restoreAllMocks();
      failFirstRead(FIRST_READ[j.name]);
      await expect(jobs[j.name].run(EVENT)).rejects.toThrow('injected');
      m = await marker(j.name);
      expect(m).toMatchObject({ ok: false, failStreak: 2 });

      vi.restoreAllMocks();
      await jobs[j.name].run(EVENT);
      m = await marker(j.name);
      expect(m).toMatchObject({ ok: true, failStreak: 0 });
    });
  }
});

describe('a run whose items fail', () => {
  it('is not ok although it did not throw (expireIdleGames, one idle game that will not close)', async () => {
    await db.doc('games/g-idle').set({
      gameType: 'tictactoe', groupId: 'g1',
      lastMoveAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3 * 86_400_000),
    });
    vi.spyOn(db, 'runTransaction').mockRejectedValue(new Error('injected: transaction refused'));
    await jobs.expireIdleGames.run(EVENT);
    const m = await marker('expireIdleGames');
    expect(m).toMatchObject({ ok: false, failStreak: 1 });
    expect(m!.detail).toContain('failed 1');
    const rows = await errorRows('expireIdleGames');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain('ended with failures');
  });
});

describe('the start marker', () => {
  it('is there while the job runs, counted, and gone when it ends', async () => {
    let seen: Record<string, unknown> | undefined;
    await runJob('logErrorDigest', async () => {
      seen = await marker('logErrorDigest');
      return { failed: 0, detail: 'probe' };
    });
    expect(seen?.startedAt).toEqual(expect.any(Number));
    expect(seen?.startsSinceEnd).toBe(1);
    const m = await marker('logErrorDigest');
    expect(m).toMatchObject({ ok: true, detail: 'probe' });
    expect(m).not.toHaveProperty('startedAt');
  });
});

describe('adminGetHealth', () => {
  const ask = () => adminGetHealth.run({
    data: {}, auth: { uid: ADMIN, token: { uid: ADMIN } }, rawRequest: {},
  } as unknown as CallableRequest<unknown>);

  beforeEach(async () => { await db.doc(`admins/${ADMIN}`).set({ email: 'admin@example.test' }); });

  it('with no markers: one "not yet" line per job — and stamps when it first looked', async () => {
    const before = Date.now();
    const r = await ask();
    expect(r.jobs.map((l: any) => l.name)).toEqual(JOB_SCHEDULE.map((j) => j.name));
    expect(r.jobs.every((l: any) => l.status === 'info')).toBe(true);
    const stamps: number[] = [];
    for (const j of JOB_SCHEDULE) {
      const m = await marker(j.name);
      expect(m?.firstMissingAt).toBeGreaterThanOrEqual(before);
      stamps.push(m!.firstMissingAt);
    }
    // Looking again does not restart the clock — that is what lets "never ran" turn red.
    await ask();
    for (const [i, j] of JOB_SCHEDULE.entries()) expect((await marker(j.name))!.firstMissingAt).toBe(stamps[i]);
  });

  it('reads a real run as green', async () => {
    await jobs.logErrorDigest.run(EVENT);
    const r = await ask();
    expect(r.jobs.find((l: any) => l.name === 'logErrorDigest').status).toBe('ok');
  });

  it('a job that keeps starting and never ends is red, by the count the increments keep', async () => {
    for (let i = 0; i < STARTS_WITHOUT_END_FAIL; i++) await markJobStart('sendDueReminders');
    expect((await marker('sendDueReminders'))!.startsSinceEnd).toBe(STARTS_WITHOUT_END_FAIL);
    const r = await ask();
    const line = r.jobs.find((l: any) => l.name === 'sendDueReminders');
    expect(line.status).toBe('fail');
    expect(line.hint).toBe(LOGS_HINT);
  });

  it('is still admin-only', async () => {
    await expect(adminGetHealth.run({
      data: {}, auth: { uid: 'uid-nobody', token: { uid: 'uid-nobody' } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>)).rejects.toThrow(/Admin access required/);
  });
});
