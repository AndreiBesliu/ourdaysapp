// functions/test/seriesTimeBetweenPages.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// timeBetweenPages.test.ts — a read past its time stops at the next page, not at the next query.
//
// Written by the m-series mutation run of 17.10.2026 (commit c60463e). `readAll` looks at the clock before
// every page. Every test of the time budget moves the clock before a query's FIRST page ("each query has
// its own time", "one time for all of its ranges", "the fallback has no time ... of its own"), so a look
// moved out of the page loop — once per query — passed them all, and a query of many pages, like the
// fallback's every series however old, ran to its end whatever the time.
//
// Run against the emulators through `npm run test:rules`, like the files beside it.

import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Query } from 'firebase-admin/firestore';
import { awayFromEdge } from './clockEdges';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const DAY = 86_400_000;
const MALLORY = 'uid-tbp-mallory';

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

async function seed(docs: Record<string, Record<string, unknown>>) {
  const b = db.batch();
  for (const [id, data] of Object.entries(docs)) b.set(db.doc(`events/${id}`), data);
  await b.commit();
}
/** Pages that brought at least one event, counted as they come back. */
function countPages(refuseBounded = false) {
  const realGet = Query.prototype.get;
  const pages = { n: 0 };
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const filters = ((this as unknown as { _queryOptions?: { filters?: Array<{ field?: { formattedName?: string } }> } })
      ._queryOptions?.filters ?? []).map((f) => f.field?.formattedName);
    if (refuseBounded && filters.includes('recurrenceRule.frequency') && filters.includes('date')) {
      throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 });
    }
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    if (snap.docs.some((d) => d.ref.path.startsWith('events/'))) pages.n += 1;
    return snap;
  } as never);
  return pages;
}

it('the dated read: the clock passes its time after the first page, and the second is not read', async () => {
  const today = `${dayOf(Date.now())}T00:00:00.000Z`;
  await seed(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i}`, { ownerId: MALLORY, groupId: null, title: 'd', date: today }])));
  const pages = countPages();
  const counts = mod.emptyCounts();
  // The clock stands still until a page has brought events, then is a minute on.
  await mod.remindDue(db, Date.now(), counts, { page: 4, budgetMs: 15_000, clock: () => (pages.n ? 60_000 : 0) });
  vi.restoreAllMocks();
  expect(pages.n).toBe(1);
  expect(counts).toMatchObject({ read: 4, cut: 1 });
}, 120_000);

it('the fallback, one query over every series: past its time after a page, it stops there', async () => {
  const old = `${dayOf(Date.now() - 600 * DAY)}T00:00:00.000Z`;
  await seed(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, { ownerId: MALLORY, groupId: null, title: 's', date: old, recurrenceRule: { frequency: 'weekly' } }])));
  const pages = countPages(true);
  const counts = mod.emptyCounts();
  await mod.remindDue(db, Date.now(), counts, { page: 2, budgetMs: 15_000, clock: () => (pages.n ? 60_000 : 0) });
  vi.restoreAllMocks();
  expect(pages.n).toBe(1);
  expect(counts).toMatchObject({ seriesUnbounded: 1, read: 2, cut: 1 });
}, 120_000);
