// functions/test/deletionResume.test.ts
//
// How long deleting an account takes, when other people decide how much there is to go through: any
// member may write a group's events, as many as they like, and any stranger may send anybody friend
// requests. Pinned on the emulators, through the real callable:
//   1. A deletion over many such events finishes across attempts, each attempt continuing where the
//      last one stopped, and every attempt that does not finish stops by itself, in time, saying
//      "try again" (deadline-exceeded), rather than being killed by the platform.
//   2. The same for what a stranger can pile up: friend requests, deleted in batches.
//   3. The keep list only ever names files that are in the person's folders: links to files that do not
//      exist, which any member can write by the megabyte into one event's checklist, keep nothing.
//   4. With no file of theirs that somebody else's event could keep, the group's events are not read.
//   5. The run's budget ends it well before either callable that runs it is stopped.
//
// The time model of 1 and 2. Every round trip to Firestore (a query page, a getAll, a batch commit)
// costs STEP_MS of the run's time. A run that passes the callable's declared timeout is killed: every
// later round trip of that run fails, as nothing more happens once the platform stops it. If the code
// exposes a clock (`deletionClock`), it is pointed at the same time, so its budget sees what the
// platform sees. The person presses Delete again, up to MAX_ATTEMPTS times.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentSnapshot, Firestore, Query, WriteBatch } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

/** The test's own numbers. */
const N = 2000; // Ana's events in the group
const STEP_MS = 4_500; // one round trip, scaled so that a 540 s run holds 120 of them
const MAX_ATTEMPTS = 6;
/** One page of fields holds at most ten documents (deletionReads.test.ts). */
const PAGE = 10;

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any>; __endpoint?: { timeoutSeconds?: number } };
let deleteMine: Callable;
let accountDeletion: Record<string, any>;
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const STRANGER = 'uid-stranger';
const EMAIL = 'gone@example.test';
const G = 'aaaaaaaaaaaaaaaaaaa1';
const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({ data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>);
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const evId = (i: number) => `e${String(i).padStart(6, '0')}`;
const realData = DocumentSnapshot.prototype.data;
const realNow = () => Date.now();

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

async function seedPeople() {
  await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
  await admin.auth().createUser({ uid: ANA });
  await writeAll([
    [`users/${GONE}`, { name: 'Gina', email: EMAIL }],
    [`profiles/${GONE}`, { name: 'Gina' }],
    [`groups/${G}`, { name: 'Family', ownerId: ANA, members: [ANA, GONE] }],
  ]);
}

/**
 * Spies on the round trips: counts the query pages that brought any of Ana's group events WITH fields,
 * and, when `tick` is given, calls it before every query page, getAll and batch commit.
 */
function watch(tick?: () => void): { fieldPages: () => number } {
  let fieldPages = 0;
  const realGet = Query.prototype.get;
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...a: unknown[]) {
    tick?.();
    const snap = await (realGet as (...x: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, a);
    if (snap.docs.some((d) => /^e\d{6}$/.test(d.id) && Object.keys(realData.call(d) || {}).length > 0)) fieldPages++;
    return snap;
  } as never);
  if (tick) {
    const realGetAll = Firestore.prototype.getAll;
    vi.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (this: Firestore, ...a: unknown[]) {
      tick();
      return (realGetAll as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    } as never);
    const realCommit = WriteBatch.prototype.commit;
    vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(async function (this: WriteBatch, ...a: unknown[]) {
      tick();
      return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    } as never);
  }
  return { fieldPages: () => fieldPages };
}

/** Presses Delete until it finishes or MAX_ATTEMPTS, every run under the time model above. */
async function deleteUnderTheTimeLimit(): Promise<{ outcomes: string[]; result: any; fieldPages: number }> {
  const timeoutMs = (deleteMine.__endpoint?.timeoutSeconds ?? 0) * 1000;
  expect(timeoutMs, 'the callable states its timeout').toBeGreaterThan(0);
  let started = 0;
  let elapsed = 0;
  let killed = false;
  const w = watch(() => {
    elapsed += STEP_MS;
    if (elapsed > timeoutMs) { killed = true; throw new Error('killed: past the timeout of the callable'); }
  });
  if (accountDeletion.deletionClock) accountDeletion.deletionClock.now = () => started + elapsed;
  const outcomes: string[] = [];
  let result: any = null;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt++) {
      started = Date.now();
      elapsed = 0;
      killed = false;
      try {
        result = await deleteMine.run(asGone());
        outcomes.push(`finished after ${elapsed / STEP_MS} round trips`);
      } catch (e: any) {
        outcomes.push(killed ? 'killed' : `stopped: ${e?.code} after ${elapsed / STEP_MS} round trips`);
      }
    }
    return { outcomes, result, fieldPages: w.fieldPages() };
  } finally {
    vi.restoreAllMocks();
    if (accountDeletion.deletionClock) accountDeletion.deletionClock.now = realNow;
  }
}

/** Finished, and no attempt killed: each one that did not finish said so, in time. */
function expectFinishedInTime(outcomes: string[], result: any) {
  expect(outcomes.filter((o) => o === 'killed'), outcomes.join(' | ')).toEqual([]);
  expect(result, outcomes.join(' | ')).toMatchObject({ ok: true, authDeleted: true });
  for (const o of outcomes.slice(0, -1)) expect(o).toMatch(/^stopped: deadline-exceeded/);
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const index = (await import('../src/index')) as unknown as Record<string, Callable>;
  deleteMine = index.deleteMyAccount;
  accountDeletion = await import('../src/accountDeletion');
  db = admin.firestore();
  bucket = admin.storage().bucket();
  expect(bucket.name.startsWith('demo-'), `bucket "${bucket.name}" is not a demo bucket`).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await bucket.deleteFiles({ force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (accountDeletion?.deletionClock) accountDeletion.deletionClock.now = realNow;
});

describe('a deletion over what other people piled up', () => {
  // Kept: what Ana's events show of what Gina uploaded INTO them, early, in the middle and late in the
  // group's order, so that different attempts find them; and Gina's own event, which Ana inherits.
  const KEPT = [`checklists/${GONE}/k10.png`, `checklists/${GONE}/k1000.png`, `checklists/${GONE}/k1990.png`, `events/${GONE}/mine.png`];
  // Gone: nothing shows them; and her wallet card, which Ana's event points at (that does not keep it).
  const GONE_FILES = [`events/${GONE}/stray.png`, `checklists/${GONE}/old.png`, `assets/${GONE}/card.png`];

  it(`${N} events of a group she is in: finishes across attempts, each continuing, none killed`, async () => {
    await seedPeople();
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < N; i++) {
      const ev: Record<string, unknown> = { ownerId: ANA, groupId: G, title: 't' };
      if (i % 2) ev.rsvps = { [GONE]: 'yes', [ANA]: 'no' };
      if (i === 10 || i === 1000 || i === 1990) {
        ev.checklistItems = [{ id: 'c', text: 'x', isCompleted: false, assetUrl: url(`checklists/${GONE}/k${i}.png`) }];
      }
      if (i === 1500) ev.imageUrl = url(`assets/${GONE}/card.png`);
      docs.push([`events/${evId(i)}`, ev]);
    }
    docs.push(['events/zz-mine', { ownerId: GONE, groupId: G, title: 'mine', imageUrl: url(`events/${GONE}/mine.png`) }]);
    await writeAll(docs);
    await Promise.all([...KEPT, ...GONE_FILES].map((p) => bucket.file(p).save(Buffer.from('x'))));

    const { outcomes, result, fieldPages } = await deleteUnderTheTimeLimit();
    console.log(`DELETION_RESUME ${JSON.stringify({ N, outcomes, fieldPagesOfGroupEvents: fieldPages })}`);
    expectFinishedInTime(outcomes, result);
    // Each attempt continued: the group's events were read with their fields about once in all, not
    // once more per attempt.
    expect(fieldPages).toBeLessThanOrEqual(Math.ceil((N + 1) / PAGE) + 2);

    // And it did all of it: what stays still shows its files, the rest went; no answer of hers is left;
    // the group let her go and Ana inherited her event; the record keeps no list of her files.
    for (const p of KEPT) expect(await fileExists(p), p).toBe(true);
    for (const p of GONE_FILES) expect(await fileExists(p), p).toBe(false);
    expect((await db.collection('events').where(`rsvps.${GONE}`, '==', 'yes').count().get()).data().count).toBe(0);
    expect((await db.collection('events').where(`rsvps.${ANA}`, '==', 'no').count().get()).data().count).toBe(N / 2);
    expect((await db.doc(`groups/${G}`).get()).data()).toMatchObject({ ownerId: ANA, members: [ANA] });
    expect((await db.doc('events/zz-mine').get()).data()).toMatchObject({ ownerId: ANA });
    const rec = (await db.doc(`accountDeletions/${GONE}`).get()).data() || {};
    expect(rec).toMatchObject({ filesDone: true });
    expect(rec.keep).toBeUndefined();
  }, 600_000);

  it('a stranger\'s friend requests: deleted across attempts, none killed', async () => {
    const F = 30_000;
    await seedPeople();
    await writeAll(Array.from({ length: F }, (_, i) => [`friend_requests/fr${String(i).padStart(6, '0')}`, { fromId: STRANGER, toId: GONE, status: 'pending' }]));
    const { outcomes, result } = await deleteUnderTheTimeLimit();
    console.log(`FRIEND_REQUESTS ${JSON.stringify({ F, outcomes })}`);
    expectFinishedInTime(outcomes, result);
    expect((await db.collection('friend_requests').where('toId', '==', GONE).count().get()).data().count).toBe(0);
  }, 600_000);
});

describe('the keep list', () => {
  const K = 20; // Ana's events, each with a checklist of links to files Gina never had
  const M = 240;
  const LONG = 'x'.repeat(4000);

  it('names only files that are in the person\'s folders, whatever the links point at', async () => {
    await seedPeople();
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < K; i++) {
      docs.push([`events/${evId(i)}`, {
        ownerId: ANA, groupId: G, title: 't',
        checklistItems: Array.from({ length: M }, (_, j) => ({ id: `${j}`, text: '', isCompleted: false, assetUrl: url(`checklists/${GONE}/${i}-${j}-${LONG}`) })),
      }]);
    }
    docs.push([`events/${evId(K)}`, { ownerId: ANA, groupId: G, title: 't', checklistItems: [{ id: 'r', text: '', isCompleted: false, assetUrl: url(`checklists/${GONE}/real.png`) }] }]);
    // One at a time: each is just under the 1 MiB a document may hold.
    for (const [path, d] of docs) await db.doc(path).set(d);
    await bucket.file(`checklists/${GONE}/real.png`).save(Buffer.from('x'));
    await bucket.file(`checklists/${GONE}/stray.png`).save(Buffer.from('x'));

    const files = accountDeletion.accountFiles;
    const real = files.deleteExcept;
    let keptNames: string[] = [];
    vi.spyOn(files, 'deleteExcept').mockImplementation(async (...a: any[]) => {
      keptNames = [...(a[1] as Set<string>)];
      return real(...a);
    });
    const r = await deleteMine.run(asGone());
    const chars = keptNames.reduce((s, p) => s + p.length, 0);
    console.log(`KEEP_LIST ${JSON.stringify({ events: K, linksEach: M, kept: keptNames.length, keptChars: chars })}`);
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(keptNames).toEqual([`checklists/${GONE}/real.png`]);
    expect(await fileExists(`checklists/${GONE}/real.png`)).toBe(true);
    expect(await fileExists(`checklists/${GONE}/stray.png`)).toBe(false);
  }, 300_000);

  it('does not read the group\'s events when nothing of theirs there could be kept', async () => {
    await seedPeople();
    const n = 1000;
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < n; i++) docs.push([`events/${evId(i)}`, { ownerId: ANA, groupId: G, title: 't', ...(i % 2 ? { rsvps: { [GONE]: 'maybe' } } : {}) }]);
    // Her only file is a wallet card, which her own event in the group shows: Ana inherits it, so it stays.
    docs.push(['events/zz-mine', { ownerId: GONE, groupId: G, title: 'mine', imageUrl: url(`assets/${GONE}/card.png`) }]);
    await writeAll(docs);
    await bucket.file(`assets/${GONE}/card.png`).save(Buffer.from('x'));

    const w = watch();
    const r = await deleteMine.run(asGone());
    const pages = w.fieldPages();
    console.log(`NO_CANDIDATES ${JSON.stringify({ events: n, fieldPagesOfGroupEvents: pages })}`);
    expect(r).toMatchObject({ ok: true, authDeleted: true, files: { deleted: 0, kept: 1 } });
    expect(await fileExists(`assets/${GONE}/card.png`)).toBe(true);
    expect((await db.collection('events').where(`rsvps.${GONE}`, '==', 'maybe').count().get()).data().count).toBe(0);
    expect(pages).toBe(0);
  }, 300_000);
});

describe('the run budget', () => {
  // Both doors run the same deletion. Its own stop must come well before either is stopped from outside:
  // what may run after the stop (a page, a group's hand-over, a listing) needs that margin.
  it('ends a run at least a minute before either callable that runs it would be stopped', async () => {
    const index = (await import('../src/index')) as unknown as Record<string, Callable>;
    const budget = accountDeletion.RUN_BUDGET_MS;
    expect(typeof budget, 'accountDeletion.ts states its budget').toBe('number');
    for (const name of ['deleteMyAccount', 'adminModerateUser']) {
      const timeoutMs = (index[name]?.__endpoint?.timeoutSeconds ?? 0) * 1000;
      expect(budget, name).toBeLessThanOrEqual(timeoutMs - 60_000);
    }
  });
});
