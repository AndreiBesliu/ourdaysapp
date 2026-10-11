// functions/test/adminReads.test.ts
//
// The Admin callables read whole collections — up to 5000 games, 8000 events, 8000 notifications —
// and until 10.10.2026 every document whole, each up to 1 MiB. Anybody can pad their own documents,
// so a few hundred of them could run the Admin panel out of memory. Each read now takes only the
// fields it counts (`select`). Two things are pinned here, on the emulator, through the real callables:
//   1. no field a callable does not count reaches it (a field `pad` on every document, watched on
//      every document any query fetches during the call — also those it only counts);
//   2. every number is still right: each counted field holds a value that is not the default, so a
//      field left out of a `select` shows up as a wrong number, not as a quiet 0.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentSnapshot, Query } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';
const ADMIN = 'uid-reads-admin';
const U1 = 'uid-reads-one';
const PAD = { pad: 'x'.repeat(64) };

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
type Name = 'adminGetStats' | 'adminListProfiles' | 'adminListGroups' | 'adminGetGrowth' | 'adminGetUser' | 'adminBackfillExpenses';
let db: admin.firestore.Firestore;
let fns: Record<Name, Callable>;
const ask = (f: Callable, data: unknown = {}) =>
  f.run({ data, auth: { uid: ADMIN, token: { uid: ADMIN } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

/**
 * The paths of every document a QUERY fetched with its `pad` during `call` — whether or not the code
 * then read it: a read that only counts (`snap.size`) fetches whole documents all the same. A single
 * document read by its path (the person's own two, in adminGetUser) is not a query, and is whole on purpose.
 */
async function padsSeen(call: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const realGet = Query.prototype.get;
  const realData = DocumentSnapshot.prototype.data;
  const spy = vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    for (const doc of snap.docs) {
      const d = realData.call(doc);
      if (d && Object.prototype.hasOwnProperty.call(d, 'pad')) seen.push(doc.ref.path);
    }
    return snap;
  } as never);
  try {
    await call();
  } finally {
    spy.mockRestore();
  }
  return [...new Set(seen)].sort();
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running (scripts/test-rules.mjs starts it)').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fns = (await import('../src/index')) as never;
  db = admin.firestore();
});
afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await admin.auth().createUser({ uid: ADMIN, email: 'admin@example.test' });
  await admin.auth().createUser({ uid: U1, email: 'one@example.test' });
  const now = admin.firestore.Timestamp.now();
  const iso = new Date().toISOString();
  const b = db.batch();
  b.set(db.doc(`admins/${ADMIN}`), { email: 'admin@example.test', ...PAD });
  b.set(db.doc('admins/uid-reads-other-admin'), { email: 'other@example.test', ...PAD });
  b.set(db.doc(`users/${U1}`), {
    email: 'one@example.test', name: 'One', photoURL: 'https://example.test/one.png', birthday: '2000-02-03',
    fcmTokens: ['token-1'], friends: [{ uid: ADMIN, name: 'Admin', email: 'admin@example.test' }], ...PAD,
  });
  b.set(db.doc(`users/${ADMIN}`), { email: 'admin@example.test', ...PAD });
  b.set(db.doc(`profiles/${U1}`), { name: 'Profile One', photoURL: 'https://example.test/p.png', birthday: '1999-01-01', ...PAD });
  b.set(db.doc('profiles/uid-no-user-doc'), { name: 'Only Profile', ...PAD });
  b.set(db.doc('groups/g1'), { name: 'Family', ownerId: ADMIN, members: [ADMIN, U1], ...PAD });
  b.set(db.doc('groups/g2'), { name: 'Solo', ownerId: U1, members: [U1], ...PAD });
  b.set(db.doc('events/e1'), {
    ownerId: U1, groupId: 'g1', isTask: true, taskStatus: 'completed', recurrenceRule: { freq: 'daily' },
    reminderMinutes: 0, rsvpEnabled: true, categoryId: 'chores', createdAt: iso, title: 'Clean', date: '2026-10-10', ...PAD,
  });
  b.set(db.doc('events/e2'), { ownerId: U1, isTask: true, taskStatus: 'pending', categoryId: 'chores', createdAt: iso, title: 'Shop', ...PAD });
  b.set(db.doc('events/e3'), { ownerId: ADMIN, createdAt: iso, ...PAD });
  b.set(db.doc('games/x1'), { groupId: 'g1', gameType: 'tic-tac-toe', status: 'playing', finalized: true, createdAt: now, createdBy: U1, ...PAD });
  b.set(db.doc('games/x2'), { groupId: 'g1', gameType: 'rummy-45', status: 'finished', createdAt: now, createdBy: ADMIN, ...PAD });
  b.set(db.doc('assets/a1'), { ownerId: U1, sharedGroupId: 'g1', category: 'Cards', ...PAD });
  b.set(db.doc('assets/a2'), { ownerId: U1, category: 'Cards', ...PAD });
  b.set(db.doc('friend_requests/f1'), { status: 'accepted', ...PAD });
  b.set(db.doc('group_invites/i1'), { status: 'declined', ...PAD });
  b.set(db.doc('group_invites/i2'), { status: 'declined', ...PAD });
  b.set(db.doc('notifications/n1'), { read: false, type: 'reminder', ...PAD });
  b.set(db.doc('notifications/n2'), { read: true, type: 'reminder', ...PAD });
  b.set(db.doc('expenses/s1'), { paidBy: U1, ...PAD });
  b.set(db.doc('expenses/s2'), { paidBy: ADMIN, ownerId: ADMIN, ...PAD });
  await b.commit();
});

describe('the statistics', () => {
  it('read no field they do not count', async () => {
    expect(await padsSeen(() => ask(fns.adminGetStats))).toEqual([]);
  });

  it('every number, from the field that makes it', async () => {
    const r = await ask(fns.adminGetStats);
    expect(r.users).toMatchObject({ withBirthday: 1, withPhoto: 1, pushEnabled: 1, withFriends: 1, friendships: 0 });
    expect(r.groups).toMatchObject({ memberships: 3, largest: 2, shared: 1 });
    expect(r.events).toMatchObject({
      tasks: 2, completedTasks: 1, recurring: 1, withReminder: 1, sharedWithFamily: 1, withRsvp: 1,
      byCategory: { chores: 2, other: 1 },
    });
    expect(r.games).toMatchObject({ byType: { 'tic-tac-toe': 1, 'rummy-45': 1 }, byStatus: { playing: 1, finished: 1 }, finalized: 1 });
    expect(r.assets).toMatchObject({ shared: 1, byCategory: { Cards: 2 } });
    expect(r.social).toEqual({ friendRequests: { accepted: 1 }, groupInvites: { declined: 2 } });
    expect(r.notifications).toMatchObject({ unread: 1, byType: { reminder: 2 } });
    expect(r.admins).toEqual({ total: 2 });
  });
});

describe('the list of people', () => {
  it('reads no field it does not show or count', async () => {
    expect(await padsSeen(() => ask(fns.adminListProfiles))).toEqual([]);
  });

  it('every column, from the field that makes it', async () => {
    const r = await ask(fns.adminListProfiles);
    const one = r.profiles.find((p: { uid: string }) => p.uid === U1);
    expect(one).toMatchObject({
      email: 'one@example.test', name: 'One', photoURL: 'https://example.test/one.png', birthday: '2000-02-03',
      friends: 1, groups: 2, events: 2, pushEnabled: true, isAdmin: false,
    });
    expect(r.profiles.find((p: { uid: string }) => p.uid === ADMIN)).toMatchObject({ groups: 1, events: 1, isAdmin: true });
  });

  it('a person whose sign-in has no email is shown with the one in their user document', async () => {
    await admin.auth().createUser({ uid: 'uid-reads-no-email' });
    await db.doc('users/uid-reads-no-email').set({ email: 'doc@example.test', ...PAD });
    const r = await ask(fns.adminListProfiles);
    expect(r.profiles.find((p: { uid: string }) => p.uid === 'uid-reads-no-email')).toMatchObject({ email: 'doc@example.test' });
  });

  it('a person with no user document is shown from their profile', async () => {
    await db.doc(`users/${U1}`).delete();
    const r = await ask(fns.adminListProfiles);
    expect(r.profiles.find((p: { uid: string }) => p.uid === U1)).toMatchObject({
      name: 'Profile One', photoURL: 'https://example.test/p.png', birthday: '1999-01-01',
    });
  });
});

describe('the list of groups and the growth chart', () => {
  it('read no field they do not count', async () => {
    expect(await padsSeen(() => ask(fns.adminListGroups))).toEqual([]);
    expect(await padsSeen(() => ask(fns.adminGetGrowth))).toEqual([]);
  });

  it('every column and every day, from the field that makes it', async () => {
    const g = await ask(fns.adminListGroups);
    expect(g.groups.find((x: { id: string }) => x.id === 'g1')).toMatchObject({
      name: 'Family', ownerId: ADMIN, members: 2, memberUids: [ADMIN, U1], events: 1, games: 2,
    });
    const growth = await ask(fns.adminGetGrowth);
    const sum = (s: Array<{ count: number }>) => s.reduce((a, d) => a + d.count, 0);
    expect(sum(growth.events)).toBe(3);
    expect(sum(growth.games)).toBe(2);
  });
});

describe('one person', () => {
  it('reads no field of their groups, events, games or cards it does not show or count', async () => {
    expect(await padsSeen(() => ask(fns.adminGetUser, { uid: U1 }))).toEqual([]);
  });

  it('every line, from the field that makes it', async () => {
    const r = await ask(fns.adminGetUser, { uid: U1 });
    expect(r.counts).toEqual({ groups: 2, events: 2, games: 1, assets: 2 });
    expect(r.groups).toEqual(expect.arrayContaining([{ id: 'g1', name: 'Family', members: 2 }, { id: 'g2', name: 'Solo', members: 1 }]));
    expect(r.recentEvents).toEqual(expect.arrayContaining([
      { id: 'e1', title: 'Clean', date: '2026-10-10', isTask: true, taskStatus: 'completed' },
      { id: 'e2', title: 'Shop', date: null, isTask: true, taskStatus: 'pending' },
    ]));
  });
});

describe('the expense backfill', () => {
  it('reads no field it does not use, and still sorts every expense', async () => {
    let r: any;
    expect(await padsSeen(async () => { r = await ask(fns.adminBackfillExpenses, {}); })).toEqual([]);
    expect(r).toMatchObject({ dryRun: true, total: 2, alreadyScoped: 1, wouldSetOwnerAndGroup: 0, wouldSetOwnerOnly: 1 });
    expect(r.ambiguous).toEqual([{ id: 's1', paidBy: U1, groups: 2 }]);
  });

  it('and applies to the documents it read', async () => {
    await db.doc('groups/g2').delete();
    const r = await ask(fns.adminBackfillExpenses, { apply: true });
    expect(r).toMatchObject({ applied: 1, wouldSetOwnerAndGroup: 1 });
    expect((await db.doc('expenses/s1').get()).data()).toMatchObject({ paidBy: U1, ownerId: U1, groupId: 'g1', pad: PAD.pad });
  });
});
