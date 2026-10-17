// functions/test/seriesUpperBound.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// seriesUpperBound.test.ts — the series read reaches to the lookahead's last day, not only to the window's first.
//
// Written by the m-series mutation run of 17.10.2026 (commit c60463e). Every series query bounds `date` from
// above at the end of the lookahead (`toDay`). A series begun INSIDE the window is read by the dated query
// too, so a bound cut down to the window's first day passed every test: what the series read still owes such
// a series shows only when the dated read stops early. Each query has its own cap and its own time
// (remindersRead.test.ts, "each query has its own time"), so a dated read stopped at its cap must not cost a
// series begun yesterday its reminder today.
//
// Run against the emulators through `npm run test:rules`, like the files beside it.

import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const DAY = 86_400_000;
const ALICE = 'uid-sub-alice';
const MALLORY = 'uid-sub-mallory';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** An instant five minutes ago, to the minute: a reminder at it is due in this run. */
const dueAt = () => Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  // The test computes days itself and reads the clock more than once: 25 s clear of 00:05 UTC.
  await awayFromEdge(5 * 60_000, 25_000);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

it('a series begun inside the window is reminded by the series read when the dated read stops at its cap', async () => {
  const now = Date.now();
  const due = dueAt();
  const fromDay = dayOf(now - 2 * DAY); // the first day a run looks at
  const b = db.batch();
  // Six one-off events on the window's first day, no reminder: in the dated read's date order they come
  // first and fill its cap of five, so it stops before anything dated later.
  for (let i = 0; i < 6; i += 1) {
    b.set(db.doc(`events/!early${i}`), { ownerId: MALLORY, groupId: null, title: 'early', date: `${fromDay}T00:00:00.000Z` });
  }
  // A daily series begun yesterday — inside the window, after its first day — at the clock of a reminder
  // due now: today's occurrence is due in this run.
  b.set(db.doc('events/series'), {
    ownerId: ALICE, groupId: null, title: 'Pills', date: `${dayOf(due - DAY)}T00:00:00.000Z`, time: clockOf(due),
    timezone: 'UTC', reminderMinutes: 0, assigneeIds: [ALICE], recurrenceRule: { frequency: 'daily' }, recurrenceExceptions: [],
  });
  await b.commit();
  expect(dayOf(due - DAY) > fromDay).toBe(true);

  const counts = mod.emptyCounts();
  await mod.remindDue(db, now, counts, { maxCandidates: 5 });
  // The dated read stopped at its cap (red), and did not reach the series ...
  expect(counts.cut).toBe(1);
  // ... which its own read still found and reminded.
  expect(counts).toMatchObject({ due: 1, sent: 1 });
  expect((await db.doc(`reminder_log/series__${dayOf(due)}`).get()).exists).toBe(true);
}, 120_000);
