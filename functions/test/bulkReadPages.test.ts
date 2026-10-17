// functions/test/bulkReadPages.test.ts
//
// What a page may bring once a megabyte stored is not a megabyte decoded (17.10.2026). A list of a
// million nulls fits in a document and is about 100 MB decoded (review of 17.10.2026). The rules now
// bound every field read ten a page (rules-tests/bulk-read-fields.test.ts), except three of an event: a
// checklist (its items are maps, which the rules cannot look into), `hiddenFrom` and the picture (an edit
// of an event has no room left under the rules' 1000 expressions). Only the account deletion reads those.
// Pinned here, on the emulators:
//   1. the account deletion brings those three at most ten events a page, and still keeps every file
//      they show and hands every event over as before;
//   2. a notification reads only the language and the push tokens of its recipients, never the rest of
//      a document its owner fills as they like;
//   3. the server's own door for events writes each assignee once, whatever the request repeats;
//   4. both doors to the deletion have the memory ten such events need (2 GiB: one decodes to ~100 MB).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { DocumentSnapshot, Firestore, Query } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any>; __endpoint?: { availableMemoryMb?: number } };
let index: Record<string, Callable>;
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const G = 'aaaaaaaaaaaaaaaaaaa1';
const N = 12;
const ids = (prefix: string) => Array.from({ length: N }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`);
const nowS = () => Math.floor(Date.now() / 1000);
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=t`;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  index = (await import('../src/index')) as unknown as Record<string, Callable>;
  db = admin.firestore();
  bucket = admin.storage().bucket();
  expect(bucket.name.startsWith('demo-'), `bucket "${bucket.name}" is not a demo bucket`).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await bucket.deleteFiles({ force: true });
});

afterEach(() => { vi.restoreAllMocks(); });

/** For each field, the most documents carrying it that one query page brought, and how many pages did. */
async function pagesBringing(fields: string[], call: () => Promise<unknown>): Promise<Record<string, { most: number; pages: number }>> {
  const realGet = Query.prototype.get;
  const realData = DocumentSnapshot.prototype.data;
  const out: Record<string, { most: number; pages: number }> = Object.fromEntries(fields.map((f) => [f, { most: 0, pages: 0 }]));
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    for (const f of fields) {
      const n = snap.docs.filter((d) => Object.prototype.hasOwnProperty.call(realData.call(d) || {}, f)).length;
      if (n > 0) out[f].pages++;
      out[f].most = Math.max(out[f].most, n);
    }
    return snap;
  } as never);
  try { await call(); } finally { vi.restoreAllMocks(); }
  return out;
}

describe('a checklist, hiddenFrom and the picture are read at most ten events a page', () => {
  it('by the account deletion, which still keeps every file they show and hands every event over', async () => {
    await admin.auth().createUser({ uid: GONE, email: 'gone@example.test', emailVerified: true });
    await admin.auth().createUser({ uid: ANA });
    const b = db.batch();
    b.set(db.doc(`users/${GONE}`), { name: 'Gina' });
    b.set(db.doc(`groups/${G}`), { name: 'Family', ownerId: ANA, members: [ANA, GONE] });
    // Ana's events in their group: their checklist shows the person's uploads.
    for (const id of ids('ana')) {
      b.set(db.doc(`events/${id}`), {
        ownerId: ANA, groupId: G, title: id, hiddenFrom: [],
        checklistItems: [{ id: 'i', text: 'x', isCompleted: false, assetUrl: url(`checklists/${GONE}/${id}.png`), assetId: null }],
      });
    }
    // Their own events in the group, which Ana inherits with their pictures (step 1 and step 4).
    for (const id of ids('mine')) {
      b.set(db.doc(`events/${id}`), { ownerId: GONE, groupId: G, title: id, hiddenFrom: [], imageUrl: url(`events/${GONE}/${id}.png`) });
    }
    await b.commit();
    await Promise.all([
      ...ids('ana').map((id) => bucket.file(`checklists/${GONE}/${id}.png`).save(Buffer.from('x'))),
      ...ids('mine').map((id) => bucket.file(`events/${GONE}/${id}.png`).save(Buffer.from('x'))),
    ]);

    const req = { data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>;
    let result: any;
    const seen = await pagesBringing(['checklistItems', 'hiddenFrom', 'imageUrl'], async () => { result = await index.deleteMyAccount.run(req); });
    for (const f of ['checklistItems', 'hiddenFrom', 'imageUrl']) {
      expect(seen[f].most, f).toBeLessThanOrEqual(10);
      expect(seen[f].pages, f).toBeGreaterThan(0);
    }
    expect(result).toMatchObject({ ok: true, authDeleted: true, files: { deleted: 0, kept: 2 * N }, counts: { eventsHandedOver: N } });
    for (const id of ids('mine')) expect((await db.doc(`events/${id}`).get()).data()?.ownerId, id).toBe(ANA);
  }, 120_000);
});

describe('a notification reads only what it uses of its recipients', () => {
  it('the language and the push tokens, never the rest of the document', async () => {
    const { notify } = await import('../src/notify');
    const people = ['uid-r1', 'uid-r2', 'uid-r3'];
    for (const [i, uid] of people.entries()) {
      await db.doc(`users/${uid}`).set({ name: uid, language: i === 0 ? 'ro-RO' : 'en-US', pad: 'x'.repeat(64), friends: [{ uid: 'a' }] });
    }
    const realGetAll = Firestore.prototype.getAll;
    const realData = DocumentSnapshot.prototype.data;
    const fetched: string[][] = [];
    vi.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (this: Firestore, ...args: unknown[]) {
      const snaps = await (realGetAll as (...a: unknown[]) => Promise<DocumentSnapshot[]>).apply(this, args);
      for (const s of snaps) if (s.ref.path.startsWith('users/')) fetched.push(Object.keys(realData.call(s) || {}).sort());
      return snaps;
    } as never);
    // No tokens anywhere and no push: nothing leaves the machine.
    const r = await notify({ userIds: people, createdBy: '', type: 'reminder', titleKey: 'notifReminder', titleParam: 'Dinner', push: false });
    vi.restoreAllMocks();
    expect(r.rows).toBe(3);
    expect(fetched).toHaveLength(3);
    for (const keys of fetched) expect(keys.every((k) => k === 'language' || k === 'fcmTokens'), keys.join(',')).toBe(true);
    // And the language still reaches the bell: the Romanian recipient's row is not the English one's.
    const rows = (await db.collection('notifications').get()).docs.map((d) => d.data());
    const titleOf = (uid: string) => rows.find((x) => x.userId === uid)?.title;
    expect(titleOf('uid-r1')).not.toBe(titleOf('uid-r2'));
    expect(titleOf('uid-r2')).toBe(titleOf('uid-r3'));
  }, 60_000);
});

describe('the server’s own door for events writes each assignee once', () => {
  it('an occurrence of a group series, asked for with the caller named three hundred times', async () => {
    await db.doc(`groups/${G}`).set({ name: 'Family', ownerId: ANA, members: [ANA, GONE] });
    await db.doc('events/series').set({
      title: 'Walk', ownerId: ANA, groupId: G, date: '2026-09-20T00:00:00.000Z', recurrenceRule: { frequency: 'daily' }, assigneeIds: [ANA],
    });
    const { id } = await index.createEventOverride.run({
      data: { parentId: 'series', overrideDate: '2026-09-22', data: { title: 'Walk', assigneeIds: new Array(300).fill(GONE).concat([ANA]) } },
      auth: { uid: GONE, token: { uid: GONE } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>);
    expect((await db.doc(`events/${id}`).get()).data()?.assigneeIds).toEqual([GONE, ANA]);
  }, 60_000);
});

describe('the deletion has the memory ten such events a page need', () => {
  it('both doors: the person’s own and an admin’s', () => {
    expect(index.deleteMyAccount.__endpoint?.availableMemoryMb).toBeGreaterThanOrEqual(2048);
    expect(index.adminModerateUser.__endpoint?.availableMemoryMb).toBeGreaterThanOrEqual(2048);
  });
});
