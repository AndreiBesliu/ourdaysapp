// functions/test/remindersStale.test.ts
//
// Written by the review of 17.10.2026.
//
// A claim left "sending" (106729a) is taken over by the next run that still sees its reminder, judged by
// when the claiming RUN started, not by when the claim was made (review, 17.10.2026). Until then a claim
// was stale four minutes after it was made, while the next run comes five minutes after the last one
// STARTED: a claim made by a run that started a minute or more late (or late in a heavy run whose next run
// reached it sooner) was younger than that when the next run looked, and on the reminder's last run it was
// skipped as "already sent", green, and lost.
//
// The two-run cases are real runs of `remindDue` on the emulator, on the job's real cadence (read off its
// cron) with the idle time between them taken out: the first run is started AS IF at the instant it would
// have had, and its claim's server timestamp is moved back by the time the test did not wait. In the second
// run, `Date.now()` minus that timestamp is then what it is on live, with how far into each run the claim
// was made and looked at measured, not assumed.
// Run against the emulators through `npm run test:rules`.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const MIN = 60_000;
const ALICE = 'uid-stale-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
/** A timed event whose "at the time" reminder lands at `atMs` (a whole minute). */
const eventAt = (owner: string, atMs: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
  timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
});
const keyOf = (id: string, atMs: number) => `${id}__${dayOf(atMs)}`;
const bellsFor = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).size;
const pick = (c: Record<string, number>) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed, retried: c.retried, dropped: c.dropped });
const show = (label: string, v: unknown) => console.log(`PROBE ${label} ${JSON.stringify(v)}`);
type Endpoint = { timeoutSeconds?: number; scheduleTrigger?: { schedule?: string } };
const endpoint = () => (mod.sendDueReminders as unknown as { __endpoint: Endpoint }).__endpoint;

/** The job's cadence, off its cron, where the deploy reads it. */
const cadence = () => {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(endpoint().scheduleTrigger?.schedule || '');
  expect(m, 'a "*/N * * * *" cron').not.toBeNull();
  return Number(m![1]) * MIN;
};

/** `notify` reads its recipients' profiles first: from now on it fails for `uid`. */
function sendsFailFor(uid: string) {
  const real = db.getAll.bind(db);
  vi.spyOn(db, 'getAll').mockImplementation((async (...args: unknown[]) => {
    if (args.some((a) => (a as { path?: unknown })?.path === `users/${uid}`)) throw new Error('injected: the send fails');
    return real(...(args as Parameters<typeof real>));
  }) as never);
}

type Plan = { firstAt: number; secondAt: number };
/** The second run a real instant `firstMs` ahead (waited for), the first `cadence - late` before it. */
const plan = (late: number, firstMs: number): Plan => {
  const secondAt = Date.now() + firstMs;
  return { firstAt: secondAt - (cadence() - late), secondAt };
};

/**
 * The first run, started now as if at `p.firstAt`. Once it is over its claim's server timestamp moves back
 * by the difference (the only instant it wrote that is not its `now`), and the second run's instant is
 * waited for. Returns how far into the run the claim was made, real.
 */
async function runFirst(p: Plan, key: string) {
  const counts = mod.emptyCounts();
  const startedAt = Date.now();
  await mod.remindDue(db, p.firstAt, counts);
  vi.restoreAllMocks();
  const ref = db.doc(`reminder_log/${key}`);
  const row = (await ref.get()).data();
  expect(row, 'the first run claimed it').toMatchObject({ state: 'sending' });
  const claimedMs = (row!.claimedAt as admin.firestore.Timestamp).toMillis();
  await ref.update({ claimedAt: admin.firestore.Timestamp.fromMillis(claimedMs - (startedAt - p.firstAt)) });
  const left = p.secondAt - Date.now();
  expect(left, 'the first run fits in the time planned for it').toBeGreaterThan(0);
  await sleep(left);
  return { counts, madeAfterMs: claimedMs - startedAt };
}

/** The second run, at `p.secondAt`. Returns how far into it the claim was looked at (its transaction). */
async function runSecond(p: Plan) {
  const looks: number[] = [];
  const realTx = db.runTransaction.bind(db);
  vi.spyOn(db, 'runTransaction').mockImplementation(((fn: never, o?: never) => {
    looks.push(Date.now());
    return realTx(fn, o);
  }) as never);
  const counts = mod.emptyCounts();
  await mod.remindDue(db, p.secondAt, counts);
  vi.restoreAllMocks();
  return { counts, lookedAfterMs: looks.length ? looks[0] - p.secondAt : null };
}

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

describe('the stale bound', () => {
  it('lies past the timeout, and within the cadence less the slack', () => {
    const timeoutMs = (endpoint().timeoutSeconds ?? 0) * 1000;
    show('bounds', { STALE_CLAIM_MS: mod.STALE_CLAIM_MS, timeoutMs, cadence: cadence(), LATE_RUN_SLACK_MS: mod.LATE_RUN_SLACK_MS });
    // A run still alive never loses its claim: past its timeout, with room for two machines' clocks.
    expect(mod.STALE_CLAIM_MS).toBeGreaterThanOrEqual(timeoutMs + 15_000);
    // The next run takes over a claim whose run started up to the slack later in its slot than it does.
    expect(mod.RUN_EVERY_MS).toBe(cadence());
    expect(mod.STALE_CLAIM_MS).toBeLessThanOrEqual(cadence() - mod.LATE_RUN_SLACK_MS);
  });

  /** A reminder due now, and another run's claim on it, `runAgoMs` after its run started (none: a claim from before). */
  const claimOf = async (runAgoMs: number | null, madeAgoMs: number) => {
    const at = minute(Date.now() - 5 * MIN);
    await db.doc('events/dentist').set(eventAt(ALICE, at));
    await db.doc(`reminder_log/${keyOf('dentist', at)}`).set({
      eventId: 'dentist', day: dayOf(at), at, state: 'sending', claimId: 'another-run',
      claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - madeAgoMs),
      ...(runAgoMs === null ? {} : { runAt: Date.now() - runAgoMs }),
    });
    const counts = mod.emptyCounts();
    const runNow = Date.now();
    await mod.remindDue(db, runNow, counts);
    return { counts, runNow, row: (await db.doc(`reminder_log/${keyOf('dentist', at)}`).get()).data() };
  };

  it('a claim whose run may still be alive is left to it', async () => {
    for (const [runAgo, madeAgo] of [[1_000, 1_000], [170_000, 100_000]] as const) {
      const { counts, row } = await claimOf(runAgo, madeAgo);
      expect(pick(counts), `run started ${runAgo} ms ago`).toMatchObject({ sent: 0, dupes: 1, retried: 0 });
      expect(row).toMatchObject({ state: 'sending', claimId: 'another-run' });
    }
  }, 60_000);

  it('a claim whose run started past the bound is taken over, however late in it the claim was made', async () => {
    // Made 90 s into its run (30 s of reads, 60 s of sends), and that run started 185 s ago.
    const { counts, runNow, row } = await claimOf(185_000, 95_000);
    expect(pick(counts)).toMatchObject({ sent: 1, retried: 1, dupes: 0 });
    // The claim is now this run's: its mark, and its start, which the run after judges it by.
    expect(row).toMatchObject({ state: 'sent', retries: 1, runAt: runNow });
    expect(row!.claimId).not.toBe('another-run');
  }, 60_000);

  it('a claim written before `runAt` existed is judged by when it was made, with the same bound', async () => {
    const young = await claimOf(null, 170_000);
    expect(pick(young.counts)).toMatchObject({ sent: 0, dupes: 1 });
    const old = await claimOf(null, 185_000);
    expect(pick(old.counts)).toMatchObject({ sent: 1, retried: 1 });
  }, 60_000);
});

describe('the next run, on the real cadence', () => {
  // The first run sees the reminder fresh and its send fails; the second, `cadence - late` later, sees it for
  // the last time; the third no longer sees it. The first run started `late` later in its slot than the
  // second (a cold start, a late delivery of the schedule): LATE_RUN_SLACK_MS is how late the job allows.
  for (const late of [70_000, 110_000]) {
    it(`a failed send, from a run that started ${late / 1000} s late, goes out with the reminder's last run`, async () => {
      const p = plan(late, 8_000);
      const at = minute(p.firstAt - 7 * MIN);
      await db.doc('events/late').set(eventAt(ALICE, at));
      sendsFailFor(ALICE);
      const first = await runFirst(p, keyOf('late', at));
      expect(pick(first.counts)).toMatchObject({ due: 1, sent: 0, failed: 1 });
      const second = await runSecond(p);
      const third = mod.emptyCounts();
      await mod.remindDue(db, p.secondAt + cadence(), third);
      const bells = await bellsFor(ALICE);
      show(`late${late / 1000}`, {
        madeAfterMs: first.madeAfterMs, lookedAfterMs: second.lookedAfterMs,
        claimAgeAtLookMs: cadence() - late + (second.lookedAfterMs ?? 0) - first.madeAfterMs,
        runAgeAtLookMs: cadence() - late + (second.lookedAfterMs ?? 0),
        second: pick(second.counts), outcome: mod.reminderOutcome(second.counts), third: pick(third), bells,
      });
      expect(third.due, 'the third run no longer sees it').toBe(0);
      expect(pick(second.counts)).toMatchObject({ due: 1, sent: 1, retried: 1, dupes: 0 });
      expect(bells).toBe(1);
    }, 60_000);
  }
});

describe('two runs at once over a claim left by a dead run', () => {
  it('deliver it once: the run that takes it over moves `runAt` with it', async () => {
    // A send takes a second and a half, as one waiting on FCM can: the other run looks again while the
    // first is still sending, and must read the claim as that run's, not as the dead run's.
    const real = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((async (...args: unknown[]) => {
      if (args.some((a) => String((a as { path?: unknown })?.path ?? '').startsWith('users/'))) await sleep(1_500);
      return real(...(args as Parameters<typeof real>));
    }) as never);
    const rounds: Array<{ bells: number; sent: number; retried: number }> = [];
    for (let round = 0; round < 5; round++) {
      expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
      const at = minute(Date.now() - 5 * MIN);
      await db.doc('events/dentist').set(eventAt(ALICE, at));
      await db.doc(`reminder_log/${keyOf('dentist', at)}`).set({
        eventId: 'dentist', day: dayOf(at), at, state: 'sending', claimId: 'a-dead-run',
        runAt: Date.now() - 6 * MIN, claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * MIN),
      });
      const a = mod.emptyCounts();
      const b = mod.emptyCounts();
      await Promise.all([mod.remindDue(db, Date.now(), a), mod.remindDue(db, Date.now(), b)]);
      rounds.push({ bells: await bellsFor(ALICE), sent: a.sent + b.sent, retried: a.retried + b.retried });
    }
    show('overlap', rounds);
    for (const r of rounds) expect(r).toMatchObject({ bells: 1, sent: 1, retried: 1 });
  }, 120_000);
});
