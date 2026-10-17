// functions/test/deletionKeepList.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// k-keeplist.test.ts (mutation killers, label m-deletion, commit 5f8f0c2)
//
// The keep list of an account deletion keeps its place in accountDeletions/{uid}.keep (17.10.2026).
// Pinned here, on the emulators, through the real callable, with runs stopped at chosen moments:
//   1. a read an earlier run finished is not read again by the next one;
//   2. each read continues from ITS place; a read that had not started yet starts from its beginning;
//   3. a run killed in the middle of a read (no stop of its own) loses at most `saveEvery` (25) pages;
//   4. the record names a file it found by a 16-character key, never by its name;
//   5. a listing of the person's folders that fails stops the deletion before any file goes.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentReference, DocumentSnapshot, Firestore, Query, WriteBatch } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let deleteMine: Callable;
let accountDeletion: Record<string, any>;
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const EMAIL = 'gone@example.test';
const G1 = 'aaaaaaaaaaaaaaaaaaa1';
const G2 = 'bbbbbbbbbbbbbbbbbbb2';
const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({ data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>);
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const put = (path: string) => bucket.file(path).save(Buffer.from('x'));
const realData = DocumentSnapshot.prototype.data;
const realNow = () => Date.now();
const pad = (i: number, n = 3) => String(i).padStart(n, '0');

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

async function seedPeople(groups: string[]) {
  await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
  await admin.auth().createUser({ uid: ANA });
  await writeAll([
    [`users/${GONE}`, { name: 'Gina', email: EMAIL }],
    [`profiles/${GONE}`, { name: 'Gina' }],
    ...groups.map((g) => [`groups/${g}`, { name: `Group ${g.slice(-1)}`, ownerId: ANA, members: [ANA, GONE] }] as [string, Record<string, unknown>]),
  ]);
}

/** An event of Ana's in group `g`, showing `file` (a path of Gina's) in its checklist when given. */
const anaEvent = (g: string, file?: string): Record<string, unknown> => ({
  ownerId: ANA, groupId: g, title: 't',
  ...(file ? { checklistItems: [{ id: 'c', text: 'x', isCompleted: false, assetUrl: url(file) }] } : {}),
});

/**
 * Query pages that brought, WITH fields, a document whose id matches `ids`; `after(n)` runs after the
 * n-th, and `before()` before every query page.
 */
function countFieldPages(ids: RegExp, after?: (n: number) => void, before?: () => void): () => number {
  let n = 0;
  const realGet = Query.prototype.get;
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...a: unknown[]) {
    before?.();
    const snap = await (realGet as (...x: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, a);
    if (snap.docs.some((d) => ids.test(d.id) && Object.keys(realData.call(d) || {}).length > 0)) {
      n++;
      after?.(n);
    }
    return snap;
  } as never);
  return () => n;
}

/** From the moment `jump()` is called, the deletion's clock is an hour later: past any run's budget. */
function clockJump(): () => void {
  let jumped = false;
  accountDeletion.deletionClock.now = () => (jumped ? realNow() + 3_600_000 : realNow());
  return () => { jumped = true; };
}

/** Calls `then` once a write to the deletion's record carries `field` (after that write is queued). */
function onRecordWrite(field: string, then: () => void) {
  const realUpdate = WriteBatch.prototype.update;
  vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
    const data = a[0];
    if (ref?.path === `accountDeletions/${GONE}` && data && typeof data === 'object' && field in (data as object)) then();
    return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
  } as never);
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  deleteMine = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteMyAccount;
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

describe('the keep list keeps its place', () => {
  it('a read an earlier run finished is not read again', async () => {
    await seedPeople([G1]);
    const KEPT = `checklists/${GONE}/k.png`;
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < 30; i++) docs.push([`events/ana-${pad(i)}`, anaEvent(G1, i === 5 ? KEPT : undefined)]);
    await writeAll(docs);
    await put(KEPT);
    await put(`events/${GONE}/stray.png`);

    // Run 1 stops as soon as the group's read is written down as finished.
    const jump = clockJump();
    onRecordWrite('keep.done', jump);
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;
    expect(await fileExists(`events/${GONE}/stray.png`)).toBe(true);

    // Run 2 goes on from there: the group's events are not read with their fields again.
    const pages = countFieldPages(/^ana-\d{3}$/);
    const r = await deleteMine.run(asGone());
    const n = pages();
    vi.restoreAllMocks();
    console.log(`K-DONE ${JSON.stringify({ groupFieldPagesInRun2: n })}`);
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(n).toBe(0);
    expect(await fileExists(KEPT)).toBe(true);
    expect(await fileExists(`events/${GONE}/stray.png`)).toBe(false);
  }, 120_000);

  it('each read continues from its own place; one not started yet starts from its beginning', async () => {
    await seedPeople([G1, G2]);
    // G1's events sort after G2's ('m-' > 'a-'): a place in G1 applied to G2 would skip all of G2.
    const KEPT = `checklists/${GONE}/in-g2.png`;
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < 40; i++) docs.push([`events/m-${pad(i)}`, anaEvent(G1)]);
    for (let i = 0; i < 10; i++) docs.push([`events/a-${pad(i)}`, anaEvent(G2, i === 5 ? KEPT : undefined)]);
    await writeAll(docs);
    await put(KEPT);

    // Run 1 stops after two pages of G1, the first group read.
    const jump = clockJump();
    countFieldPages(/^m-\d{3}$/, (n) => { if (n === 2) jump(); });
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;

    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    // G2's event shows the file: G2 was read from its first document.
    expect(await fileExists(KEPT)).toBe(true);
  }, 120_000);

  it('a run killed in the middle of a read loses at most 25 of its pages', async () => {
    await seedPeople([G1]);
    const KEPT = `checklists/${GONE}/k.png`;
    const N = 600; // 60 pages of ten
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < N; i++) docs.push([`events/e-${pad(i, 4)}`, anaEvent(G1, i === 3 ? KEPT : undefined)]);
    await writeAll(docs);
    await put(KEPT);

    // Run 1 is killed by the platform after 40 pages of the group: every later round trip fails.
    let killed = false;
    const die = () => { if (killed) throw new Error('killed: past the timeout of the callable'); };
    countFieldPages(/^e-\d{4}$/, (n) => { if (n === 40) killed = true; }, die);
    const realGetAll = Firestore.prototype.getAll;
    vi.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (this: Firestore, ...a: unknown[]) {
      die();
      return (realGetAll as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    } as never);
    const realCommit = WriteBatch.prototype.commit;
    vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(async function (this: WriteBatch, ...a: unknown[]) {
      die();
      return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    } as never);
    await expect(deleteMine.run(asGone())).rejects.toBeTruthy();
    vi.restoreAllMocks();
    expect(killed).toBe(true);

    const pages = countFieldPages(/^e-\d{4}$/);
    const r = await deleteMine.run(asGone());
    const n = pages();
    vi.restoreAllMocks();
    console.log(`K-KILLED ${JSON.stringify({ pagesInRun2: n, ofAll: N / 10 })}`);
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(n).toBeLessThanOrEqual(N / 10 - 25);
    expect(await fileExists(KEPT)).toBe(true);
  }, 180_000);
});

describe('what the keep list writes down', () => {
  it('names a file it found by a 16-character key, never by its name', async () => {
    await seedPeople([G1]);
    const LONG = `checklists/${GONE}/${'x'.repeat(300)}.png`;
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < 12; i++) docs.push([`events/ana-${pad(i)}`, anaEvent(G1, i === 4 ? LONG : undefined)]);
    await writeAll(docs);
    await put(LONG);

    const jump = clockJump();
    onRecordWrite('keep.done', jump);
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;

    const kept = (await db.doc(`accountDeletions/${GONE}`).get()).data()?.keep?.kept;
    console.log(`K-KEYS ${JSON.stringify({ kept: Array.isArray(kept) ? kept.map((k: unknown) => String(k).slice(0, 40)) : kept })}`);
    expect(Array.isArray(kept)).toBe(true);
    expect(kept).toHaveLength(1);
    for (const k of kept) {
      expect(typeof k).toBe('string');
      expect(k).toHaveLength(16);
      expect(k.includes('/') || LONG.includes(k)).toBe(false);
    }
    // And it still keeps the file when the deletion goes on.
    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect(await fileExists(LONG)).toBe(true);
  }, 120_000);
});

describe('a listing of their folders that fails', () => {
  it('stops the deletion before any file goes, and the next run keeps what stays', async () => {
    await seedPeople([G1]);
    // Their own event in the group, which Ana inherits with its picture.
    const KEPT = `events/${GONE}/mine.png`;
    await writeAll([['events/mine', { ownerId: GONE, groupId: G1, title: 'mine', imageUrl: url(KEPT) }]]);
    await put(KEPT);
    await put(`events/${GONE}/stray.png`);

    vi.spyOn(accountDeletion.accountFiles, 'list').mockResolvedValueOnce(null);
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'unavailable' });
    vi.restoreAllMocks();
    expect(await fileExists(KEPT)).toBe(true);
    expect(await fileExists(`events/${GONE}/stray.png`)).toBe(true);
    expect((await db.doc(`accountDeletions/${GONE}`).get()).data()?.filesDone).toBeUndefined();
    expect((await admin.auth().getUser(GONE)).uid).toBe(GONE);

    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect(await fileExists(KEPT)).toBe(true);
    expect(await fileExists(`events/${GONE}/stray.png`)).toBe(false);
  }, 120_000);
});
