// functions/test/remindersRowKeyDays.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M24 (commit c7a303d, mutation testing m-sending).
//
// A reminder's bell rows are keyed by the REMINDER (`rowKey: reminder:<event>__<day>`), so a second send
// of the same reminder rewrites them (remindersSendDetails.test.ts, Ebell/Emark) — and a series, one
// event reminded on many days, keeps a row for each day. Every test of the key has one occurrence, so a
// key made of the event id alone (M24) passed them all, and on live each day's reminder of a series
// would overwrite the day before's bell row.
// Run against the emulators through `npm run test:rules`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
process.env.METADATA_SERVER_DETECTION = 'none';
const MIN = 60_000;
const DAY = 86_400_000;
const ALICE = 'uid-krk-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const bellIds = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).docs.map((d) => d.id);
const pick = (c: Record<string, number>) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed });

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  // The days are computed here and in the code: not across midnight.
  await awayFromEdge(0, 25_000);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('a series keeps a bell row for each day it is reminded', () => {
  it('the same daily series, reminded yesterday and today: two rows, one per occurrence', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    // A daily series that began ten days ago, at the reminder's clock.
    await db.doc('events/daily').set({
      ownerId: ALICE, groupId: null, title: 'Pills', date: `${dayOf(at - 10 * DAY)}T00:00:00.000Z`, time: clockOf(at),
      timezone: 'UTC', reminderMinutes: 0, assigneeIds: [ALICE], recurrenceRule: { frequency: 'daily' }, recurrenceExceptions: [],
    });
    const yesterday = mod.emptyCounts();
    await mod.remindDue(db, T - DAY, yesterday);
    const today = mod.emptyCounts();
    await mod.remindDue(db, T, today);
    const ids = await bellIds(ALICE);
    console.log('KILLER_ROWKEY ' + JSON.stringify({ yesterday: pick(yesterday), today: pick(today), ids }));
    expect(pick(yesterday)).toMatchObject({ due: 1, sent: 1 });
    expect(pick(today)).toMatchObject({ due: 1, sent: 1 });
    expect((await db.doc(`reminder_log/daily__${dayOf(at - DAY)}`).get()).data()?.state).toBe('sent');
    expect((await db.doc(`reminder_log/daily__${dayOf(at)}`).get()).data()?.state).toBe('sent');
    expect(ids.length).toBe(2);
  }, 60_000);
});
