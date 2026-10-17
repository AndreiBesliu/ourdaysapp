// functions/test/remindersClaimOverlap.test.ts
//
// Written by the review of 17.10.2026.
// claim left "sending" by a dead run must deliver the reminder ONCE (reminders.ts: "an overlapping run
// sends nothing twice"; the takeover is a transaction for exactly this). No existing test runs two
// runs at the same time, so a takeover that reads outside its transaction, or does not refresh
// `claimedAt`, passes the whole suite.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-rem-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dueAt = () => Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;
const dueEvent = (owner: string) => {
  const at = dueAt();
  return {
    ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(at)}T00:00:00.000Z`, time: clockOf(at),
    timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
  };
};
const wipe = async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
};

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(wipe);
afterEach(() => vi.restoreAllMocks());

describe('overlapping runs and a claim left by a dead run', () => {
  it('two runs that both find it stale deliver the reminder once', async () => {
    const results: Array<{ bells: number; sent: number; retried: number; dupes: number; failed: number }> = [];
    for (let round = 0; round < 5; round++) {
      await wipe();
      await db.doc('events/dentist').set(dueEvent(ALICE));
      await db.doc(`reminder_log/dentist__${dayOf(dueAt())}`).set({
        eventId: 'dentist', day: dayOf(dueAt()), at: dueAt(), state: 'sending',
        claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - mod.STALE_CLAIM_MS - 60_000),
      });
      const a = mod.emptyCounts();
      const b = mod.emptyCounts();
      await Promise.all([mod.remindDue(db, Date.now(), a), mod.remindDue(db, Date.now(), b)]);
      const bells = (await db.collection('notifications').where('userId', '==', ALICE).get()).size;
      results.push({ bells, sent: a.sent + b.sent, retried: a.retried + b.retried, dupes: a.dupes + b.dupes, failed: a.failed + b.failed });
    }
    console.log('PROBE_OVERLAP ' + JSON.stringify(results));
    for (const r of results) expect(r).toMatchObject({ bells: 1, sent: 1 });
  }, 120_000);
});
