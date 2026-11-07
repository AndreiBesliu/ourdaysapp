// functions/test/roadmap.test.ts
//
// Admin → Roadmap (07.11.2026): the two callables, through the real functions, on the Firestore emulator.
// Admins only; what the server keeps, and how; a stale tab cannot write over a newer change; a move touches only the
// lane and the rank; a lane's fresh ranks land all at once; a proposal becomes one item however often it is added, and
// comes back to Dismissed when its item is deleted; the cap and the cut of the list.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { ROADMAP_MAX_ITEMS, ROADMAP_RANK_MAX, ROADMAP_READ_MAX } from '../src/roadmapCore';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Fn = { run: (arg: unknown) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice'; // an admin
const BOB = 'uid-bob'; // a member, not an admin
const CAROL = 'uid-carol'; // a second admin

function call(name: string, uid: string | null, data: unknown) {
  return fn[name].run({
    data,
    ...(uid ? { auth: { uid, token: { uid, email: `${uid}@example.test`, email_verified: true } } } : {}),
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}
const edit = (data: unknown, uid: string = ALICE) => call('adminEditRoadmap', uid, data);
const list = (uid: string = ALICE) => call('adminGetRoadmap', uid, {});
const doc = async (id: string) => (await db.doc(`roadmap/${id}`).get()).data()!;
/** The version a screen would have been shown: the item's `updatedAt`, as the list gives it. */
const seenOf = async (id: string) => ((await db.doc(`roadmap/${id}`).get()).get('updatedAt') as admin.firestore.Timestamp | undefined)?.toMillis() ?? null;
const later = () => new Promise((r) => setTimeout(r, 15));

const item = { title: 'Shared lists', note: 'For the shop', area: 'calendar', lane: 'next', rank: 0 };

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  await db.doc(`admins/${ALICE}`).set({ email: `${ALICE}@example.test` });
  await db.doc(`admins/${CAROL}`).set({ email: `${CAROL}@example.test` });
});

describe('who may', () => {
  it.each(['adminGetRoadmap', 'adminEditRoadmap'])('%s: a member who is not an admin is refused, and so is nobody signed in', async (name) => {
    const data = name === 'adminEditRoadmap' ? { op: 'create', fields: item } : {};
    await expect(call(name, BOB, data)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call(name, null, data)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect((await db.collection('roadmap').get()).size).toBe(0);
  });
});

describe('an item', () => {
  it('created: kept cleaned, stamped, with who made it; listed as kept', async () => {
    const { id } = await edit({ op: 'create', fields: { ...item, title: '  Shared   lists ' } });
    const d = await doc(id);
    expect(d).toMatchObject({ title: 'Shared lists', note: 'For the shop', area: 'calendar', lane: 'next', rank: 0, createdBy: ALICE, updatedBy: ALICE, doneAt: null });
    expect(d.createdAt).toBeInstanceOf(admin.firestore.Timestamp);
    const read = await list();
    expect(read).toMatchObject({ truncated: false, proposals: {} });
    expect(read.items).toEqual([expect.objectContaining({ id, title: 'Shared lists', lane: 'next', proposalId: null, doneAt: null })]);
    expect(read.items[0].updatedAt).toBe(await seenOf(id));
  });

  it('updated: the fields change; who made it, when, and from which proposal stay; who changed it is kept', async () => {
    const { id } = await edit({ op: 'create', fields: item, proposalId: 'p-keep' });
    const before = await doc(id);
    await later();
    await edit({ op: 'update', id, seen: await seenOf(id), fields: { ...item, title: 'Lists', area: 'wallet' } }, CAROL);
    const after = await doc(id);
    expect(after).toMatchObject({ title: 'Lists', area: 'wallet', createdBy: ALICE, updatedBy: CAROL, proposalId: 'p-keep' });
    expect((after.createdAt as admin.firestore.Timestamp).isEqual(before.createdAt)).toBe(true);
    expect((after.updatedAt as admin.firestore.Timestamp).toMillis()).toBeGreaterThan((before.updatedAt as admin.firestore.Timestamp).toMillis());
  });

  it('done: stamped when it arrives, kept while it stays, cleared when it leaves', async () => {
    const { id } = await edit({ op: 'create', fields: item });
    await edit({ op: 'move', id, seen: await seenOf(id), lane: 'done', rank: 0 });
    const first = (await doc(id)).doneAt as admin.firestore.Timestamp;
    expect(first).toBeInstanceOf(admin.firestore.Timestamp);
    await later();
    await edit({ op: 'update', id, seen: await seenOf(id), fields: { ...item, lane: 'done', title: 'Shared lists, shipped' } });
    expect(((await doc(id)).doneAt as admin.firestore.Timestamp).isEqual(first)).toBe(true);
    await edit({ op: 'move', id, seen: await seenOf(id), lane: 'later', rank: 3 });
    expect((await doc(id)).doneAt).toBeNull();
  });

  it('created straight into Done is stamped too', async () => {
    const { id } = await edit({ op: 'create', fields: { ...item, lane: 'done' } });
    expect((await doc(id)).doneAt).toBeInstanceOf(admin.firestore.Timestamp);
  });

  it('a save after another admin deleted it is refused, and does not bring it back', async () => {
    const { id } = await edit({ op: 'create', fields: item });
    const seen = await seenOf(id);
    await edit({ op: 'delete', id }, CAROL);
    await expect(edit({ op: 'update', id, seen, fields: item })).rejects.toMatchObject({ code: 'not-found' });
    await expect(edit({ op: 'move', id, seen, lane: 'now', rank: 0 })).rejects.toMatchObject({ code: 'not-found' });
    expect((await db.doc(`roadmap/${id}`).get()).exists).toBe(false);
  });

  it('bad fields, an id that is a path, or no version seen: refused before anything is written', async () => {
    await expect(edit({ op: 'create', fields: { ...item, area: 'shop' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(edit({ op: 'update', id: 'groups/g1', seen: null, fields: item })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(edit({ op: 'delete', id: '..' })).rejects.toMatchObject({ code: 'invalid-argument' });
    const { id } = await edit({ op: 'create', fields: item });
    await expect(edit({ op: 'update', id, fields: { ...item, title: 'x' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await doc(id)).title).toBe('Shared lists');
  });

  it('a document written by hand in the console is listed in shape, and that shape is accepted back', async () => {
    await db.doc('roadmap/hand').set({ title: 42, area: 'shop', lane: 'someday', rank: 1e20, note: ['n'] });
    const read = await list();
    expect(read.items).toEqual([{
      id: 'hand', title: '(untitled)', note: '', area: 'other', lane: 'later', rank: ROADMAP_RANK_MAX,
      createdAt: null, updatedAt: null, doneAt: null, proposalId: null,
    }]);
    const shown = read.items[0];
    await edit({ op: 'update', id: 'hand', seen: shown.updatedAt, fields: { title: 'Fixed', note: shown.note, area: shown.area, lane: shown.lane, rank: shown.rank } });
    expect(await doc('hand')).toMatchObject({ title: 'Fixed', area: 'other', lane: 'later', rank: ROADMAP_RANK_MAX });
  });
});

describe('two admins, or two tabs, at once', () => {
  it('a tab that saw an older version cannot write it back: refused, and the newer change stays', async () => {
    const { id } = await edit({ op: 'create', fields: item });
    const stale = await seenOf(id);
    await later();
    await edit({ op: 'update', id, seen: stale, fields: { ...item, title: 'Carol’s title' } }, CAROL);
    await expect(edit({ op: 'update', id, seen: stale, fields: { ...item, note: 'Alice’s note' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(edit({ op: 'move', id, seen: stale, lane: 'now', rank: 9 })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await doc(id)).toMatchObject({ title: 'Carol’s title', note: 'For the shop', lane: 'next', updatedBy: CAROL });
  });

  it('a move touches the lane and the rank only', async () => {
    const { id } = await edit({ op: 'create', fields: item });
    await db.doc(`roadmap/${id}`).update({ title: 'Edited in the console', note: 'kept' });
    await edit({ op: 'move', id, seen: await seenOf(id), lane: 'now', rank: 7 });
    expect(await doc(id)).toMatchObject({ title: 'Edited in the console', note: 'kept', area: 'calendar', lane: 'now', rank: 7 });
  });

  it('a lane gets fresh ranks all at once, in the order given', async () => {
    const ids: string[] = [];
    for (const r of [0, 0.0000001, 0.0000002]) ids.push((await edit({ op: 'create', fields: { ...item, rank: r } })).id);
    const other = (await edit({ op: 'create', fields: { ...item, lane: 'later', rank: 5 } })).id;
    await edit({ op: 'reorder', lane: 'next', ids: [ids[2], ids[0], ids[1]] });
    expect([(await doc(ids[2])).rank, (await doc(ids[0])).rank, (await doc(ids[1])).rank]).toEqual([0, 1, 2]);
    expect((await doc(other)).rank).toBe(5);
  });

  it('a hand-made item whose lane is not one is shown under Later, and counted there by a reorder', async () => {
    await db.doc('roadmap/hand').set({ title: 'Hand made', lane: 'someday', rank: 1 });
    const later = (await edit({ op: 'create', fields: { ...item, lane: 'later', rank: 2 } })).id;
    expect((await list()).items.find((i: { id: string }) => i.id === 'hand').lane).toBe('later');
    await expect(edit({ op: 'reorder', lane: 'later', ids: [later] })).rejects.toMatchObject({ code: 'failed-precondition' });
    await edit({ op: 'reorder', lane: 'later', ids: [later, 'hand'] });
    expect([(await doc(later)).rank, (await doc('hand')).rank]).toEqual([0, 1]);
  });

  it('an order that does not name exactly the lane as it is now is refused, and nothing moves', async () => {
    const a = (await edit({ op: 'create', fields: { ...item, rank: 0 } })).id;
    const b = (await edit({ op: 'create', fields: { ...item, rank: 1 } })).id;
    const c = (await edit({ op: 'create', fields: { ...item, lane: 'now', rank: 4 } })).id;
    await expect(edit({ op: 'reorder', lane: 'next', ids: [b] })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(edit({ op: 'reorder', lane: 'next', ids: [b, a, c] })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(edit({ op: 'reorder', lane: 'next', ids: [b, 'gone1'] })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([(await doc(a)).rank, (await doc(b)).rank, (await doc(c)).rank]).toEqual([0, 1, 4]);
  });
});

describe('Claude’s proposals', () => {
  const P = 'storage-messaging-on-demand';

  it('added twice (two tabs, a retried call): ONE item, and the proposal says which', async () => {
    const [a, b] = await Promise.all([
      edit({ op: 'create', fields: item, proposalId: P }),
      edit({ op: 'create', fields: item, proposalId: P }),
    ]);
    expect(a.id).toBe(b.id);
    const again = await edit({ op: 'create', fields: item, proposalId: P });
    expect(again.id).toBe(a.id);
    expect((await db.collection('roadmap').get()).size).toBe(1);
    expect((await db.doc(`roadmapProposals/${P}`).get()).data()).toMatchObject({ status: 'added', itemId: a.id, by: ALICE });
    expect((await list()).proposals).toEqual({ [P]: 'added' });
    expect((await doc(a.id)).proposalId).toBe(P);
  });

  it('its item deleted: the proposal goes to Dismissed, can be restored, and added again as a new item', async () => {
    const first = await edit({ op: 'create', fields: item, proposalId: P });
    await edit({ op: 'delete', id: first.id }, CAROL);
    expect((await list()).proposals).toEqual({ [P]: 'dismissed' });
    expect((await db.doc(`roadmapProposals/${P}`).get()).data()).toMatchObject({ status: 'dismissed', by: CAROL });
    await edit({ op: 'restore', proposalId: P });
    expect((await list()).proposals).toEqual({});
    const second = await edit({ op: 'create', fields: item, proposalId: P });
    expect(second.id).not.toBe(first.id);
    expect((await db.doc(`roadmapProposals/${P}`).get()).get('itemId')).toBe(second.id);
  });

  it('deleting an item the proposal no longer points at leaves the proposal alone', async () => {
    await db.doc('roadmap/old').set({ ...item, proposalId: P });
    const current = await edit({ op: 'create', fields: item, proposalId: P });
    await edit({ op: 'delete', id: 'old' });
    expect((await db.doc(`roadmapProposals/${P}`).get()).data()).toMatchObject({ status: 'added', itemId: current.id });
  });

  it('dismissed, then restored; an added one is neither dismissed nor restored', async () => {
    await edit({ op: 'dismiss', proposalId: P });
    expect((await list()).proposals).toEqual({ [P]: 'dismissed' });
    await edit({ op: 'restore', proposalId: P });
    expect((await list()).proposals).toEqual({});
    await edit({ op: 'create', fields: item, proposalId: P });
    await edit({ op: 'dismiss', proposalId: P });
    await edit({ op: 'restore', proposalId: P });
    expect((await list()).proposals).toEqual({ [P]: 'added' });
  });
});

describe('the cap and the cut', () => {
  async function fill(n: number) {
    for (let start = 0; start < n; start += 400) {
      const batch = db.batch();
      for (let i = start; i < Math.min(n, start + 400); i++) batch.set(db.doc(`roadmap/i${String(i).padStart(4, '0')}`), { ...item, title: `Item ${i}`, rank: i });
      await batch.commit();
    }
  }

  it(`one short of ${ROADMAP_MAX_ITEMS}, one more is accepted; at ${ROADMAP_MAX_ITEMS}, refused, with nothing written`, async () => {
    await fill(ROADMAP_MAX_ITEMS - 1);
    await edit({ op: 'create', fields: item });
    expect((await db.collection('roadmap').count().get()).data().count).toBe(ROADMAP_MAX_ITEMS);
    await expect(edit({ op: 'create', fields: item })).rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(edit({ op: 'create', fields: item, proposalId: 'p-x' })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect((await db.collection('roadmap').count().get()).data().count).toBe(ROADMAP_MAX_ITEMS);
    expect((await db.doc('roadmapProposals/p-x').get()).exists).toBe(false);
  });

  it('past the cap (two creates at once can pass it): every item is still listed, and the list is whole', async () => {
    await fill(ROADMAP_MAX_ITEMS + 3);
    const read = await list();
    expect(read.items).toHaveLength(ROADMAP_MAX_ITEMS + 3);
    expect(read.truncated).toBe(false);
  });

  it(`more than the list reads (${ROADMAP_READ_MAX}): the first ones, and it says so`, async () => {
    await fill(ROADMAP_READ_MAX);
    expect((await list()).truncated).toBe(false);
    await db.doc('roadmap/zzzz').set({ ...item, title: 'One more' });
    const read = await list();
    expect(read.items).toHaveLength(ROADMAP_READ_MAX);
    expect(read.truncated).toBe(true);
  });
});
