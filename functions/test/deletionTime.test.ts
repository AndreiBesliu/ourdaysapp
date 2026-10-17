// functions/test/deletionTime.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// k-time.test.ts (mutation killers, label m-deletion, commit 5f8f0c2)
//
// An account deletion that runs out of its budget (RUN_BUDGET_MS) stops where it is and says "try again"
// (deadline-exceeded), whatever step it is in. Pinned here, on the emulators, through the real callable,
// with the deletion's clock moved past the budget at a chosen moment:
//   1. while the files are being deleted: deadline-exceeded, no file deleted after the stop, and the
//      files are not marked done;
//   2. while it takes them off events other people assigned them to (others decide how many): the
//      drain stops at the page under way;
//   3. while it deletes their error rows, the last step that can stop: the account is NOT deleted with
//      rows left behind.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentReference, WriteBatch } from 'firebase-admin/firestore';
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
const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({ data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>);
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const realNow = () => Date.now();
const authExists = (uid: string) => admin.auth().getUser(uid).then(() => true, () => false);

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

async function seedPerson() {
  await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
  await admin.auth().createUser({ uid: ANA });
  await writeAll([[`users/${GONE}`, { name: 'Gina', email: EMAIL }], [`profiles/${GONE}`, { name: 'Gina' }]]);
}

/** From the moment `jump()` is called, the deletion's clock is an hour later: past any run's budget. */
function clockJump(): () => void {
  let jumped = false;
  accountDeletion.deletionClock.now = () => (jumped ? realNow() + 3_600_000 : realNow());
  return () => { jumped = true; };
}

/** Calls `then` after the first commit of a batch in which `marks(op, ref, data)` held for a write. */
function afterFirstCommitOf(marks: (op: 'update' | 'delete', ref: DocumentReference, data: unknown) => boolean, then: () => void) {
  const marked = new WeakSet<WriteBatch>();
  let done = false;
  const realUpdate = WriteBatch.prototype.update;
  const realDelete = WriteBatch.prototype.delete;
  const realCommit = WriteBatch.prototype.commit;
  vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
    if (marks('update', ref, a[0])) marked.add(this);
    return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
  } as never);
  vi.spyOn(WriteBatch.prototype, 'delete').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
    if (marks('delete', ref, undefined)) marked.add(this);
    return (realDelete as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
  } as never);
  vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(async function (this: WriteBatch, ...a: unknown[]) {
    const res = await (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    if (!done && marked.has(this)) { done = true; then(); }
    return res;
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

describe('a run out of time stops where it is and says try again', () => {
  it('while deleting the files: deadline-exceeded, no file deleted after the stop, files not marked done', async () => {
    await seedPerson();
    const FILES = [`events/${GONE}/a.png`, `events/${GONE}/b.png`, `assets/${GONE}/c.png`];
    await Promise.all(FILES.map((p) => bucket.file(p).save(Buffer.from('x'))));

    const jump = clockJump();
    const files = accountDeletion.accountFiles;
    const real = files.deleteExcept;
    vi.spyOn(files, 'deleteExcept').mockImplementationOnce(async (...a: any[]) => { jump(); return real(...a); });
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;
    for (const p of FILES) expect(await fileExists(p), p).toBe(true);
    expect((await db.doc(`accountDeletions/${GONE}`).get()).data()?.filesDone).toBeUndefined();

    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    for (const p of FILES) expect(await fileExists(p), p).toBe(false);
  }, 120_000);

  it('while taking them off events others assigned them to: the drain stops at the page under way', async () => {
    await seedPerson();
    const E = 1200; // four pages of references
    await writeAll(Array.from({ length: E }, (_, i) => [`events/as-${String(i).padStart(5, '0')}`, { ownerId: ANA, groupId: null, title: 't', assigneeIds: [GONE, ANA] }]));
    const assigned = async () => (await db.collection('events').where('assigneeIds', 'array-contains', GONE).count().get()).data().count;

    const jump = clockJump();
    afterFirstCommitOf((op, ref, data) => op === 'update' && !!ref?.path?.startsWith('events/') && !!data && typeof data === 'object' && 'assigneeIds' in (data as object), jump);
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;
    const left = await assigned();
    console.log(`K-ASSIGNED ${JSON.stringify({ E, leftAfterStop: left })}`);
    expect(left).toBeGreaterThan(0);
    expect(await authExists(GONE)).toBe(true);

    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect(await assigned()).toBe(0);
  }, 180_000);

  it('while deleting their error rows: the account is not deleted with rows left behind', async () => {
    await seedPerson();
    const R = 1000;
    await writeAll(Array.from({ length: R }, (_, i) => [`errorLogs/er-${String(i).padStart(5, '0')}`, { uid: GONE, message: 'm', source: 'client' }]));
    const rows = async () => (await db.collection('errorLogs').where('uid', '==', GONE).count().get()).data().count;

    const jump = clockJump();
    afterFirstCommitOf((op, ref) => op === 'delete' && !!ref?.path?.startsWith('errorLogs/'), jump);
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    accountDeletion.deletionClock.now = realNow;
    const left = await rows();
    console.log(`K-ERRORS ${JSON.stringify({ R, leftAfterStop: left })}`);
    expect(left).toBeGreaterThan(0);
    expect(await authExists(GONE)).toBe(true);
    expect((await db.doc(`users/${GONE}`).get()).exists).toBe(true);

    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect(await rows()).toBe(0);
  }, 180_000);
});
