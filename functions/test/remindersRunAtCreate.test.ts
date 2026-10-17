// functions/test/remindersRunAtCreate.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M15 / M16 (commit c7a303d, mutation testing m-sending).
//
// The claim a run CREATES must carry the run's start (`runAt: now`), so that the next run judges it by
// when that run started, however late in it the claim was made. remindersStale.test.ts holds the READ
// side (rows seeded with `runAt`) and the takeover's own `runAt`; its two-run cases make their claim a
// few milliseconds into the first run, where the claim's own timestamp gives the same verdict, so a
// create that writes `runAt: Date.now()` (M15) or no `runAt` at all (M16), judged by the claim like
// before the fix, passed every test. Here the claim is made 90 s into its run, the latest a run claims
// (2 x READ_BUDGET_MS of reads, SEND_BUDGET_MS of sends), and that run started 110 s late in its slot.
// Run against the emulators through `npm run test:rules`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const MIN = 60_000;
const ALICE = 'uid-krc-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
/** A timed event whose "at the time" reminder lands at `atMs` (a whole minute). */
const eventAt = (owner: string, atMs: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
  timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
});
const pick = (c: Record<string, number>) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed, retried: c.retried, dropped: c.dropped });

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

describe('the claim a run creates carries the run’s start', () => {
  it('made 90 s into a run that started 110 s late: the next run takes it over, on the reminder’s last sighting', async () => {
    const T = Date.now();
    // The first run: the cadence less the 110 s it started late, before the next one (at T).
    const firstAt = T - (mod.RUN_EVERY_MS - 110_000);
    // Due in both runs; the run at T is the last that sees it (the one after looks back to T - 10 min).
    const at = minute(T - 11 * MIN);
    await db.doc('events/late').set(eventAt(ALICE, at));
    const ref = db.doc(`reminder_log/late__${dayOf(at)}`);

    // The first run's send fails (notify reads the recipient's profile first): its claim stays.
    const real = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((async (...args: unknown[]) => {
      if (args.some((a) => (a as { path?: unknown })?.path === `users/${ALICE}`)) throw new Error('injected: the send fails');
      return real(...(args as Parameters<typeof real>));
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = mod.emptyCounts();
    await mod.remindDue(db, firstAt, first);
    vi.restoreAllMocks();
    expect(pick(first)).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const claimed = (await ref.get()).data();
    expect(claimed).toMatchObject({ state: 'sending' });
    // That claim was made 90 s into its run: its server timestamp, put where it would be.
    await ref.update({ claimedAt: admin.firestore.Timestamp.fromMillis(firstAt + 90_000) });

    // The next run: 190 s after the first one started, 100 s after the claim.
    const second = mod.emptyCounts();
    await mod.remindDue(db, Date.now(), second);
    console.log('KILLER_RUNAT ' + JSON.stringify({ firstAt, runAt: claimed?.runAt ?? null, first: pick(first), second: pick(second) }));
    expect(pick(second)).toMatchObject({ due: 1, sent: 1, retried: 1, dupes: 0 });
    expect((await ref.get()).data()).toMatchObject({ state: 'sent' });
    // What it was judged by: the first run's start, written with the claim.
    expect(claimed!.runAt).toBe(firstAt);
  }, 60_000);
});
