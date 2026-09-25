// functions/test/deleteGroupCascade.test.ts
//
// Deleting a group, through the real handler, on the Firestore AND Storage emulators. Until
// 25.09.2026 this callable had no test, and reading it found:
//   * the group's chat photos and voice notes stayed in Storage for good (and clients cannot delete
//     them — storage.rules);
//   * messages past ~3,200 and events past 12,000 were left behind under a deleted group;
//   * a sweep keyed on the group id alone would have let a stranger wipe somebody's DIRECT messages,
//     because a direct chat's id is `<uid>__<uid>` and group create does not constrain ids.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let cascade: Callable;
let groupMedia: { sweep: (id: string) => Promise<void> };
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
// Shaped like what addDoc makes: 20 characters of [A-Za-z0-9].
const G = 'aaaaaaaaaaaaaaaaaaa1';
const G2 = 'bbbbbbbbbbbbbbbbbbb2';
const DM = `${ALICE}__${BOB}`;

const call = (uid: string, data: Record<string, unknown>) =>
  cascade.run({ data, auth: { uid, token: { uid } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

const exists = async (path: string) => (await bucket.file(path).exists())[0];
const put = (path: string) => bucket.file(path).save(Buffer.from('x'));
const docExists = async (path: string) => (await db.doc(path).get()).exists;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  cascade = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteGroupCascade;
  groupMedia = (await import('../src/groupMedia')).groupMedia;
  db = admin.firestore();
  bucket = admin.storage().bucket();
  expect(bucket.name.startsWith('demo-'), `bucket "${bucket.name}" is not a demo bucket`).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  await bucket.deleteFiles({ force: true });
  await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
  await db.doc(`groups/${G2}`).set({ ownerId: CAROL, members: [CAROL], name: 'Other' });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting a group', () => {
  it('takes its events (the owner’s), frees everyone else’s, and leaves other groups alone', async () => {
    await db.doc('events/e-mine').set({ ownerId: ALICE, groupId: G });
    await db.doc('events/e-kept').set({ ownerId: ALICE, groupId: G });
    await db.doc('events/e-bob').set({ ownerId: BOB, groupId: G });
    await db.doc('events/e-other').set({ ownerId: CAROL, groupId: G2 });
    await db.doc('group_invites/inv-g').set({ fromId: ALICE, groupId: G, status: 'pending' });
    await db.doc('group_invites/inv-g2').set({ fromId: CAROL, groupId: G2, status: 'pending' });
    for (const m of ['m1', 'm2', 'm3']) await db.doc(`groups/${G}/messages/${m}`).set({ senderId: BOB, text: m });
    await db.doc(`groups/${G}/typing/${BOB}`).set({ at: 1 });

    const r = await call(ALICE, { groupId: G, keepEventIds: ['e-kept', 'e-bob'] });
    expect(r).toMatchObject({ deleted: 1, freed: 2, invites: 1, messages: 3 });
    expect(await docExists('events/e-mine')).toBe(false);
    expect((await db.doc('events/e-kept').get()).data()).toMatchObject({ groupId: null, sharedWithFamily: false });
    expect((await db.doc('events/e-bob').get()).data()).toMatchObject({ ownerId: BOB, groupId: null });
    expect((await db.doc('events/e-other').get()).data()).toMatchObject({ groupId: G2 });
    expect(await docExists('group_invites/inv-g')).toBe(false);
    expect(await docExists('group_invites/inv-g2')).toBe(true);
    expect(await docExists(`groups/${G}`)).toBe(false);
    expect((await db.collection(`groups/${G}/messages`).get()).size).toBe(0);
    expect((await db.collection(`groups/${G}/typing`).get()).size).toBe(0);
  });

  it('takes its chat media — and nothing that merely starts like it', async () => {
    const mine = [`chat-images/${G}/${BOB}_1_p.png`, `chat-images/${G}/1758000000000_old.png`, `chat-audio/${G}/${BOB}_1.webm`];
    const theirs = [`chat-images/${G}x/keep.png`, `chat-images/${G2}/${CAROL}_1_p.png`, `assets/${ALICE}/1_card.png`, `chat-images/${DM}/${BOB}_1_dm.png`];
    for (const p of [...mine, ...theirs]) await put(p);
    for (const p of mine) expect(await exists(p)).toBe(true);

    const r = await call(ALICE, { groupId: G });
    expect(r.media).toBe('deleted');
    for (const p of mine) expect(await exists(p), p).toBe(false);
    for (const p of theirs) expect(await exists(p), p).toBe(true);
  });

  it('revokes the group’s invitation links', async () => {
    await db.doc('invite_links/L1').set({ groupId: G, createdBy: ALICE, revoked: false, uses: 0, maxUses: 1 });
    await db.doc('invite_links/L2').set({ groupId: G2, createdBy: CAROL, revoked: false, uses: 0, maxUses: 1 });
    const r = await call(ALICE, { groupId: G });
    expect(r.links).toBe(1);
    expect((await db.doc('invite_links/L1').get()).data()?.revoked).toBe(true);
    expect((await db.doc('invite_links/L2').get()).data()?.revoked).toBe(false);
  });

  it('takes every message, not the first ~3,200', async () => {
    const w = db.bulkWriter();
    for (let i = 0; i < 3500; i++) void w.set(db.doc(`groups/${G}/messages/m${i}`), { senderId: BOB, text: 'x' });
    await w.close();
    expect((await db.collection(`groups/${G}/messages`).count().get()).data().count).toBe(3500);
    const r = await call(ALICE, { groupId: G });
    expect(r.messages).toBe(3500);
    expect((await db.collection(`groups/${G}/messages`).count().get()).data().count).toBe(0);
  }, 120_000);
});

describe('who may, and what is refused', () => {
  it('only the owner — and a refused call touches nothing', async () => {
    await put(`chat-images/${G}/${BOB}_1_p.png`);
    await expect(call(BOB, { groupId: G })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await docExists(`groups/${G}`)).toBe(true);
    expect(await exists(`chat-images/${G}/${BOB}_1_p.png`)).toBe(true);
  });

  it('a group named like a direct chat cannot wipe that conversation', async () => {
    // Carol creates groups/<alice>__<bob> (group create does not constrain the id) and owns it.
    await db.doc(`groups/${DM}`).set({ ownerId: CAROL, members: [CAROL], name: 'x' });
    await put(`chat-images/${DM}/${BOB}_1_dm.png`);
    const r = await call(CAROL, { groupId: DM });
    expect(r.media).toBe('skipped');
    expect(await exists(`chat-images/${DM}/${BOB}_1_dm.png`)).toBe(true);
    expect(await docExists(`groups/${DM}`)).toBe(false);
  });

  it('nor one with an auto-shaped id that IS a direct chat', async () => {
    const odd = 'cccccccccccccccccccc';
    await db.doc(`groups/${odd}`).set({ ownerId: CAROL, members: [CAROL], name: 'x' });
    await db.doc(`chats/${odd}`).set({ members: [ALICE, BOB] });
    await put(`chat-images/${odd}/${BOB}_1_dm.png`);
    expect((await call(CAROL, { groupId: odd })).media).toBe('skipped');
    expect(await exists(`chat-images/${odd}/${BOB}_1_dm.png`)).toBe(true);
  });

  it('a path is not a group id', async () => {
    await expect(call(ALICE, { groupId: `${G}/typing/${BOB}` })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(ALICE, { groupId: 42 })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('when the media cannot be removed', () => {
  it('the group stays, so a retry can finish — and the retry does', async () => {
    await put(`chat-images/${G}/${BOB}_1_p.png`);
    vi.spyOn(groupMedia, 'sweep').mockRejectedValueOnce(new Error('storage down'));
    await expect(call(ALICE, { groupId: G })).rejects.toMatchObject({ code: 'unavailable' });
    expect(await docExists(`groups/${G}`)).toBe(true);
    expect(await exists(`chat-images/${G}/${BOB}_1_p.png`)).toBe(true);

    const r = await call(ALICE, { groupId: G });
    expect(r.media).toBe('deleted');
    expect(await docExists(`groups/${G}`)).toBe(false);
    expect(await exists(`chat-images/${G}/${BOB}_1_p.png`)).toBe(false);
  });
});

describe('deleteStoragePrefixes says whether it worked', () => {
  // adminModerateUser reports `storageDeleted` from this. It swallowed every prefix's failure and
  // returned true regardless, so the admin was told the files were gone when nothing had been deleted.
  it('false when any prefix fails, true only when all succeed', async () => {
    const { deleteStoragePrefixes } = (await import('../src/index')) as unknown as {
      deleteStoragePrefixes: (p: string[], b: () => { deleteFiles(o: { prefix: string }): Promise<unknown> }) => Promise<boolean>;
    };
    const failing = () => ({ deleteFiles: async (o: { prefix: string }) => { if (o.prefix === 'events/u/') throw [new Error('denied')]; } });
    const fine = () => ({ deleteFiles: async () => undefined });
    expect(await deleteStoragePrefixes(['assets/u/', 'events/u/'], failing)).toBe(false);
    expect(await deleteStoragePrefixes(['assets/u/', 'events/u/'], fine)).toBe(true);
  });
});
