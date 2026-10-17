// functions/test/seriesCapAcrossFallback.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// capAcrossFallback.test.ts — a fallback that reads again what its read already has is not past the cap.
//
// Written by the m-series mutation run of 17.10.2026 (commit c60463e). When the index is refused after a page,
// the fallback continues the same read (its time, its cap, its count) and brings back, first, what the
// bounded query already read. Those are not new: they must neither be counted nor be held against the cap.
// Exactly the cap is not past it (remindersRead.test.ts, "past the candidate cap"), also across the fallback:
// with the cap checked before "already read", the fallback's first page turned a complete read red.
//
// Run against the emulators through `npm run test:rules`, like the files beside it.

import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Query } from 'firebase-admin/firestore';
import { awayFromEdge } from './clockEdges';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const DAY = 86_400_000;
const ALICE = 'uid-caf-alice';

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  await awayFromEdge(0);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

/** A refusal like live's when the composite index is missing. */
const missingIndex = () => Object.assign(
  new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/'),
  { code: 9 },
);
/** The bounded series query is refused from its second page on (the index went away mid-run). */
const refuseAfterFirstPage = () => {
  const realGet = Query.prototype.get;
  const refused = { n: 0 };
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const options = (this as unknown as { _queryOptions?: { filters?: Array<{ field?: { formattedName?: string } }>; startAt?: unknown } })._queryOptions;
    const filters = (options?.filters ?? []).map((f) => f.field?.formattedName);
    if (filters.includes('recurrenceRule.frequency') && filters.includes('date') && options?.startAt) {
      refused.n += 1;
      throw missingIndex();
    }
    return (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
  } as never);
  return refused;
};

it('exactly the cap, refused after a page: the fallback finds nothing new, and the read is whole', async () => {
  // Two weekly series, begun fourteen weeks ago: outside the dated window, both still running.
  const b = db.batch();
  for (const id of ['w0', 'w1']) {
    b.set(db.doc(`events/${id}`), { ownerId: ALICE, groupId: null, title: id, date: `${dayOf(Date.now() - 98 * DAY)}T00:00:00.000Z`, recurrenceRule: { frequency: 'weekly' }, reminderMinutes: null });
  }
  await b.commit();
  const refused = refuseAfterFirstPage();
  const counts = mod.emptyCounts();
  // A page of two: the bounded query's first page brings both and fills the cap; its second is refused.
  await mod.remindDue(db, Date.now(), counts, { page: 2, maxCandidates: 2 });
  vi.restoreAllMocks();
  expect(refused.n).toBe(1);
  expect(counts).toMatchObject({ seriesUnbounded: 1, read: 2, cut: 0 });
  expect(mod.reminderOutcome(counts).failed).toBe(0);
}, 120_000);
