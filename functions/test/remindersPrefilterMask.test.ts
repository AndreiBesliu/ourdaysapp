// functions/test/remindersPrefilterMask.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M03 (commit c7a303d, mutation testing m-sending).
//
// The dedupe rows are read before the turns are drawn, "only their state" (reminders.ts): the read is
// `getAll(..., { fieldMask: ["state"] })`. remindersSentBudget.test.ts ("costs one read per hundred")
// counts the calls, not what each brings, so a read of whole rows (M03) passed it. This test looks at
// what the read BRINGS (the snapshots it returns), not at the arguments.
// Run against the emulators through `npm run test:rules`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const MIN = 60_000;
const ALICE = 'uid-kpm-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const eventAt = (owner: string, atMs: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
  timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
});

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

describe('the dedupe rows are read for their state only', () => {
  it('a sent row and a claim still "sending" come back with the state and nothing else', async () => {
    const T = Date.now();
    const at = minute(T - 6 * MIN);
    await db.doc('events/sent').set(eventAt(ALICE, at));
    await mod.remindDue(db, T - 5 * MIN, mod.emptyCounts()); // delivered by the run before: a whole row, "sent"
    await db.doc('events/stuck').set(eventAt(ALICE, at));
    await db.doc(`reminder_log/stuck__${dayOf(at)}`).set({
      eventId: 'stuck', day: dayOf(at), at, state: 'sending', claimId: 'another-run', runAt: T - 30_000,
      claimedAt: admin.firestore.Timestamp.fromMillis(T - 30_000),
    });
    const brought: Array<{ path: string; keys: string[] }> = [];
    const real = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((async (...args: unknown[]) => {
      const snaps = await real(...(args as Parameters<typeof real>));
      for (const s of snaps) if (s.ref.path.startsWith('reminder_log/')) brought.push({ path: s.ref.path, keys: Object.keys(s.data() ?? {}).sort() });
      return snaps;
    }) as never);
    const out = mod.emptyCounts();
    await mod.remindDue(db, T, out);
    vi.restoreAllMocks();
    console.log('KILLER_MASK ' + JSON.stringify({ out: { due: out.due, sent: out.sent, dupes: out.dupes }, brought }));
    expect(out).toMatchObject({ due: 2, sent: 0, dupes: 2 });
    expect(brought.map((b) => b.path).sort()).toEqual([`reminder_log/sent__${dayOf(at)}`, `reminder_log/stuck__${dayOf(at)}`]);
    for (const b of brought) expect(b.keys, b.path).toEqual(['state']);
  }, 60_000);
});
