// functions/test/serverErrorCap.test.ts
//
// One server error stores at most SERVER_ERROR_DAILY_CAP rows a UTC day (01.11.2026, errorCap.ts).
// Health groups the newest 500 rows, so before this one error repeating fast pushed every other one
// out of what the panel reads (`ai:suggestAsset` wrote 47 on 26.07.2026). Through the real writers,
// on the Firestore emulator.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';
import { fingerprint, groupErrors } from '../src/errorGrouping';
import { effectiveStatus, groupDocId } from '../src/errorState';
import { fixVerdict } from '../src/errorFixes';

/** A fix claim the test can make: the list in errorFixes.ts is code, so this one claim stands in (the rest is real). */
const claim = vi.hoisted(() => ({ fingerprint: '', since: '' }));
vi.mock('../src/errorFixes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/errorFixes')>();
  return {
    ...real,
    fixFor: (fp: unknown) => (claim.since && fp === claim.fingerprint
      ? { fingerprint: fp as string, kind: 'fixed' as const, since: claim.since, what: 'test', verify: 'test' }
      : real.fixFor(fp)),
  };
});

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

/** The test's own number, not the code's: a cap raised in the code must turn this red. */
const CAP = 20;

let logServerError: (m: string, w: string, x?: unknown) => Promise<void>;
let addServerError: (m: string, w: string, x?: unknown) => Promise<void>;
let db: admin.firestore.Firestore;

const rows = async () => (await db.collection('errorLogs').get()).docs.map((d) => d.data());
const caps = async () => (await db.collection('errorCaps').get()).docs;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index'); // initializeApp()
  ({ logServerError, addServerError } = await import('../src/errorLog'));
  db = admin.firestore();
});

beforeEach(async () => {
  // The count is per UTC day, and the code reads its own clock: not across midnight. 25 s, so the wait
  // and the fixture fit the 30 s a hook may take (the review, 01.11.2026).
  await awayFromEdge(0, 25_000);
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  claim.since = '';
});

/** The group of one error as the Health panel builds it, from every row. */
async function panelGroup(message: string, where = 'ai:test') {
  const key = fingerprint(message, where);
  return groupErrors((await db.collection('errorLogs').get()).docs.map((d) => ({
    ...d.data(), createdAt: d.data().createdAt.toDate().toISOString(),
  })) as never).find((g) => g.key === key)!;
}

afterEach(() => { vi.restoreAllMocks(); });

async function times(n: number, message: string, where = 'ai:test', write = logServerError) {
  for (let i = 0; i < n; i++) await write(message, where, { uid: 'uid-a', stack: `at line ${i}` });
}

describe('one error, one day', () => {
  it(`keeps its first ${CAP} rows, then ONE row saying the count stopped, then nothing`, async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 5, 'quota exceeded for asset 1234');
    const all = await rows();
    expect(all).toHaveLength(CAP + 1);
    const marker = all.filter((r) => String(r.message).startsWith('Cap of'));
    expect(marker).toHaveLength(1);
    expect(marker[0]).toMatchObject({
      message: `Cap of ${CAP}/day reached, the rest only in Cloud Logging: quota exceeded for asset 1234`,
      context: 'ai:test', source: 'server', stack: null,
    });
    expect(all.filter((r) => r.message === 'quota exceeded for asset 1234')).toHaveLength(CAP);
    // None is lost: everything past the cap, the marker's occurrence included, is in Cloud Logging.
    expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('SERVER_ERROR_OVER_CAP'))).toHaveLength(5);
  });

  it('counts by what the panel groups by: the same error with another number is the same error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < CAP + 3; i++) await logServerError(`quota exceeded for asset ${1000 + i}`, 'ai:test');
    expect(await rows()).toHaveLength(CAP + 1);
  });

  it('another error, or the same words from another place, has its own count', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 2, 'quota exceeded');
    await times(3, 'something else');
    await times(3, 'quota exceeded', 'ai:other');
    const all = await rows();
    expect(all.filter((r) => r.message === 'something else')).toHaveLength(3);
    expect(all.filter((r) => r.message === 'quota exceeded' && r.context === 'ai:other')).toHaveLength(3);
    expect(all.filter((r) => r.message === 'quota exceeded' && r.context === 'ai:test')).toHaveLength(CAP);
  });

  it('a new day starts the count again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 2, 'quota exceeded');
    const [cap] = await caps();
    expect(cap.data()).toMatchObject({ day: new Date().toISOString().slice(0, 10), count: CAP + 2, marked: true });
    await cap.ref.set({ ...cap.data(), day: '2000-01-01' });
    await times(1, 'quota exceeded');
    expect((await rows()).filter((r) => r.message === 'quota exceeded')).toHaveLength(CAP + 1);
    expect((await cap.ref.get()).data()).toMatchObject({ count: 1 });
  });

  it('the count keeps nothing of the message: a hash for its id; a day, numbers and a claim’s time inside', async () => {
    await times(2, 'could not reach jane.doe@example.test');
    const all = await caps();
    expect(all).toHaveLength(1);
    expect(all[0].id).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.keys(all[0].data()).sort()).toEqual(['answered', 'count', 'day', 'marked']);
    expect(JSON.stringify(all[0].data())).not.toMatch(/jane|example/);
  });

  it('under the cap, an occurrence makes no read before its transaction: the fast path is only for the capped', async () => {
    // Its own words: what this instance remembers as capped outlives a test's emptied database.
    const reads = vi.spyOn(db, 'getAll');
    await times(3, 'never capped in this file');
    expect(reads).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(3);
  });

  it('past the cap, an occurrence takes no transaction: a burst of a capped error queues on nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 1, 'quota exceeded');
    const tx = vi.spyOn(db, 'runTransaction');
    await times(5, 'quota exceeded');
    expect(tx).not.toHaveBeenCalled();
    expect((await caps())[0].data()).toMatchObject({ count: CAP + 6 });
    expect(await rows()).toHaveLength(CAP + 1);
  });

  it('the throwing writer, over the cap, writes nothing and does not throw: the error is on record today', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 1, 'sweep stuck', 'job:test', addServerError);
    await expect(addServerError('sweep stuck', 'job:test')).resolves.toBeUndefined();
    expect(await rows()).toHaveLength(CAP + 1);
  });

  it('a resolved error that comes back past the cap gets ONE row, so it reads "regressed" today, not tomorrow', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 3, 'quota exceeded');
    // Resolved as adminSetErrorStatus does it: the watermark is the newest row the panel knows of.
    const key = fingerprint('quota exceeded', 'ai:test');
    const asPanel = () => panelGroup('quota exceeded');
    const before = await asPanel();
    const state = { schema: 1, fingerprint: key, status: 'resolved', watermark: before.lastSeen };
    await db.doc(`errorGroups/${groupDocId(key)}`).set(state);
    expect(effectiveStatus(state, before.lastSeen)).toBe('resolved');

    await times(3, 'quota exceeded');
    const after = await asPanel();
    expect(after.count).toBe(CAP + 1);
    expect(effectiveStatus(state, after.lastSeen)).toBe('regressed');
    // And only one: the cap holds again once the claim is answered.
    await times(5, 'quota exceeded');
    expect((await asPanel()).count).toBe(CAP + 1);
  });

  it('a fix claimed after the newest row gets ONE row past the cap, so the claim reads "failed" today', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    claim.fingerprint = fingerprint('quota exceeded', 'ai:test');
    await times(CAP + 2, 'quota exceeded');
    // The fix ships; the error does not stop.
    claim.since = new Date().toISOString();
    expect(fixVerdict({ since: claim.since } as never, (await panelGroup('quota exceeded')).lastSeen)).toBe('holding');
    await times(3, 'quota exceeded');
    const g = await panelGroup('quota exceeded');
    expect(g.count).toBe(CAP + 1);
    expect(fixVerdict({ since: claim.since } as never, g.lastSeen)).toBe('failed');
    await times(3, 'quota exceeded');
    expect((await panelGroup('quota exceeded')).count).toBe(CAP + 1);
  });

  it('a row written for a claim is written WITH the count that records it: a lost row cannot spend the claim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 1, 'quota exceeded');
    const key = fingerprint('quota exceeded', 'ai:test');
    await db.doc(`errorGroups/${groupDocId(key)}`).set({ status: 'resolved', watermark: new Date().toISOString() });
    // The transaction fails: nothing of it lands, the row goes in through the fail-open path, and the
    // claim is still unanswered for the next one.
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('injected: commit lost'));
    await times(1, 'quota exceeded');
    expect((await panelGroup('quota exceeded')).count).toBe(CAP + 1);
    const [cap] = (await db.collection('errorCaps').get()).docs;
    expect(cap.data().answered).toBeNull();
  });

  it('a group marked seen that keeps happening past the cap shows it today, with one row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await times(CAP + 1, 'quota exceeded');
    const key = fingerprint('quota exceeded', 'ai:test');
    const newest = (await db.collection('errorLogs').orderBy('createdAt', 'desc').limit(1).get()).docs[0].data();
    await db.doc(`errorGroups/${groupDocId(key)}`).set({ status: 'seen', watermark: newest.createdAt.toDate().toISOString() });
    await times(4, 'quota exceeded');
    expect((await rows()).filter((r) => r.message === 'quota exceeded')).toHaveLength(CAP + 1);
  });

  it('a count that cannot be read does not hide the error: the row is written', async () => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('injected: transaction failed'));
    await logServerError('server boom', 'ai:test');
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ message: 'server boom', context: 'ai:test', source: 'server' });
  });
});
