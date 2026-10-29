// functions/test/adminReadBounds.test.ts
//
// What the Admin callables bring of what members write (29.10.2026, functions/src/adminRead.ts). The
// counted fields could be made large — a personal event's `isTask` or category, a game's status, a
// notification's `read`, a person's name — so those numbers come from the index (`count()`) and no
// such document is fetched; what must still be read comes ten a page, only fields the rules keep to one
// value or the server writes, and stops at a time budget, saying so. Pinned here on the emulator,
// through the real callables, by watching every document any query or `getAll` brings.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Firestore, Query } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { ADMIN_READ } from '../src/adminRead';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';
const ADMIN = 'uid-bounds-admin';
const U1 = 'uid-bounds-one';
const U2 = 'uid-bounds-two';
const NULLS = new Array(1000).fill(null);
const BUDGET = ADMIN_READ.budgetMs;

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
type Name = 'adminGetStats' | 'adminListProfiles' | 'adminGetGrowth' | 'adminGetUser' | 'notifyUsers';
let db: admin.firestore.Firestore;
let fns: Record<Name, Callable>;
const ask = (f: Callable, data: unknown = {}, uid = ADMIN) =>
  f.run({ data, auth: { uid, token: { uid } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

/** One answer a query or a `getAll` brought: its collection, and each document's fields. */
interface Fetch { collection: string; docs: string[][] }

/** Every document fetched during `call`, by a query or by `getAll`, with the fields it came with. */
async function fetched(call: () => Promise<unknown>): Promise<Fetch[]> {
  const out: Fetch[] = [];
  const keysOf = (d: admin.firestore.DocumentSnapshot) => Object.keys(d.data() ?? {}).sort();
  const realGet = Query.prototype.get;
  const realGetAll = Firestore.prototype.getAll;
  const spies = [
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
      const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
      if (snap.size > 0) out.push({ collection: snap.docs[0].ref.parent.id, docs: snap.docs.map(keysOf) });
      return snap;
    } as never),
    vi.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (this: Firestore, ...args: unknown[]) {
      const snaps = await (realGetAll as (...a: unknown[]) => Promise<admin.firestore.DocumentSnapshot[]>).apply(this, args);
      for (const s of snaps) if (s.exists) out.push({ collection: s.ref.parent.id, docs: [keysOf(s)] });
      return snaps;
    } as never),
  ];
  try {
    await call();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return out;
}

/** Every field name any fetched document of `collection` came with. */
const fieldsOf = (f: Fetch[], collection: string) =>
  [...new Set(f.filter((x) => x.collection === collection).flatMap((x) => x.docs.flat()))].sort();
/** The largest page fetched of `collection`, counting only documents that came with fields. */
const largestPage = (f: Fetch[], collection: string) =>
  Math.max(0, ...f.filter((x) => x.collection === collection).map((x) => x.docs.filter((d) => d.length > 0).length));

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running (scripts/test-rules.mjs starts it)').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fns = (await import('../src/index')) as never;
  db = admin.firestore();
});
afterEach(() => { vi.restoreAllMocks(); ADMIN_READ.budgetMs = BUDGET; });

beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await admin.auth().createUser({ uid: ADMIN, email: 'admin@example.test' });
  await admin.auth().createUser({ uid: U1, email: 'one@example.test' });
  const iso = new Date().toISOString();
  const b = db.batch();
  b.set(db.doc(`admins/${ADMIN}`), { email: 'admin@example.test' });
  // A person's own document, with what they could write there besides the fields the Admin reads.
  b.set(db.doc(`users/${U1}`), {
    name: 'One', email: 'one@example.test', birthday: '2000-02-03', photoURL: 'https://example.test/1.png',
    fcmTokens: ['t-1'], friends: [{ uid: ADMIN, name: 'Admin', email: 'admin@example.test' }],
    walletCategories: NULLS, theme: { pad: NULLS },
  });
  b.set(db.doc(`users/${ADMIN}`), { name: 'Admin', fcmTokens: [], friends: [{ uid: U1, name: 'One', email: null }] });
  // The controls: set but empty, so a looser count (`!= null`) is a wrong number, not the same one.
  b.set(db.doc('users/uid-bounds-empty'), { friends: [], fcmTokens: [], birthday: '', photoURL: '' });
  b.set(db.doc('groups/g1'), { name: 'Family', ownerId: ADMIN, members: [ADMIN, U1] });
  // Personal events: the rules type none of the counted fields, so each holds what a person could write.
  b.set(db.doc('events/e1'), { ownerId: U1, groupId: null, isTask: true, taskStatus: 'completed', categoryId: 'chores', recurrenceRule: { frequency: 'weekly', pad: NULLS }, reminderMinutes: 30, rsvpEnabled: true, title: 'A', date: '2026-10-10', createdAt: iso });
  b.set(db.doc('events/e2'), { ownerId: U1, groupId: 'g1', isTask: NULLS, taskStatus: NULLS, categoryId: NULLS, recurrenceRule: NULLS, reminderMinutes: NULLS, rsvpEnabled: NULLS, title: 'B', date: '2026-10-11', createdAt: iso });
  b.set(db.doc('events/e3'), { ownerId: U1, groupId: '', isTask: true, taskStatus: 'started', categoryId: 'x'.repeat(5000), title: 'C', createdAt: iso });
  // A task turned back into an event keeps its state (AddEventModal): completed, but not a task.
  b.set(db.doc('events/e4'), { ownerId: ADMIN, isTask: false, taskStatus: 'completed', categoryId: 'work', title: 'D', createdAt: iso });
  b.set(db.doc('games/x1'), { groupId: 'g1', gameType: 'connect-4', status: NULLS, finalized: true, createdAt: admin.firestore.Timestamp.now(), createdBy: U1 });
  b.set(db.doc('games/x2'), { groupId: 'g1', gameType: 'memory-match', status: 'waiting', createdAt: admin.firestore.Timestamp.now(), createdBy: U1 });
  b.set(db.doc('games/x3'), { groupId: null, gameType: 'warlord-battle', status: 'playing', players: [U1, ADMIN], createdAt: admin.firestore.Timestamp.now() });
  b.set(db.doc('friend_requests/f1'), { status: NULLS });
  b.set(db.doc('friend_requests/f2'), { status: 'accepted' });
  b.set(db.doc('group_invites/i1'), { status: 'declined', pad: NULLS });
  b.set(db.doc('assets/a1'), { ownerId: U1, category: 'Cards', sharedGroupId: 'g1' });
  b.set(db.doc('assets/a2'), { ownerId: U1, category: 'y'.repeat(500) });
  b.set(db.doc('notifications/n1'), { userId: U1, read: NULLS, type: 'reminder' });
  b.set(db.doc('notifications/n2'), { userId: U1, read: true, type: 'reminder' });
  await b.commit();
});

describe('the statistics', () => {
  it('fetch nothing of the events, games, requests or invitations, and of the rest only bounded fields', async () => {
    const f = await fetched(() => ask(fns.adminGetStats));
    for (const c of ['events', 'games', 'friend_requests', 'group_invites']) expect(f.filter((x) => x.collection === c), c).toEqual([]);
    expect(fieldsOf(f, 'users')).toEqual(['friends']);
    expect(fieldsOf(f, 'assets')).toEqual(['category']);
    expect(fieldsOf(f, 'notifications')).toEqual(['type']);
    expect(fieldsOf(f, 'groups')).toEqual(['members']);
  });

  it('count each number from the values the app writes, and put the rest where it always went', async () => {
    const r = await ask(fns.adminGetStats);
    expect(r.truncated).toBe(false);
    expect(r.users).toMatchObject({ withBirthday: 1, withPhoto: 1, pushEnabled: 1, withFriends: 2, friendships: 1 });
    expect(r.events).toMatchObject({
      total: 4, tasks: 2, completedTasks: 1, pendingTasks: 1, plainEvents: 2, recurring: 1, withReminder: 2,
      sharedWithFamily: 1, withRsvp: 1, byCategory: { chores: 1, work: 1, other: 2 },
    });
    expect(r.games).toEqual({
      total: 3, byType: { 'connect-4': 1, 'memory-match': 1, 'warlord-battle': 1 }, byStatus: { waiting: 1, playing: 1, unknown: 1 }, finalized: 1,
    });
    expect(r.assets).toEqual({ total: 2, shared: 1, byCategory: { Cards: 1, ['y'.repeat(100)]: 1 } });
    expect(r.social).toEqual({ friendRequests: { accepted: 1, pending: 1 }, groupInvites: { declined: 1 } });
    expect(r.notifications).toEqual({ total: 2, unread: 1, byType: { reminder: 2 } });
  });

  it('read the friends lists and the categories ten a page, all of them', async () => {
    const b = db.batch();
    for (let i = 0; i < 23; i++) b.set(db.doc(`assets/p${String(i).padStart(2, '0')}`), { ownerId: U1, category: 'Cards' });
    for (let i = 0; i < 12; i++) b.set(db.doc(`users/uid-many-${i}`), { friends: [{ uid: `uid-many-${(i + 1) % 12}` }, { uid: `uid-many-${(i + 11) % 12}` }] });
    await b.commit();
    let r: any;
    const f = await fetched(async () => { r = await ask(fns.adminGetStats); });
    expect(largestPage(f, 'assets')).toBe(10);
    expect(largestPage(f, 'users')).toBe(10);
    expect(r.assets.byCategory).toMatchObject({ Cards: 24 });
    expect(r.users.friendships).toBe(13);
    expect(r.truncated).toBe(false);
  });

  it('raise the banner when another panel reads only the first of them: 2000 groups', async () => {
    for (let k = 0; k < 4; k++) {
      const b = db.batch();
      for (let i = 0; i < 500; i++) b.set(db.doc(`groups/many-${k}-${i}`), { name: 'G', ownerId: U1, members: [U1] });
      await b.commit();
    }
    expect((await ask(fns.adminGetStats)).truncated).toBe(true);
  });

  it('out of time, say the reads stopped and keep every count exact', async () => {
    ADMIN_READ.budgetMs = -1;
    const r = await ask(fns.adminGetStats);
    expect(r.truncated).toBe(true);
    expect(r.assets).toEqual({ total: 2, shared: 1, byCategory: {} });
    expect(r.users).toMatchObject({ withFriends: 2, friendships: 0 });
    expect(r.events).toMatchObject({ total: 4, tasks: 2 });
  });
});

describe('the list of people', () => {
  it('reads each person’s document ten a page, only the fields it shows, and cuts what it keeps', async () => {
    const b = db.batch();
    for (let i = 0; i < 14; i++) b.set(db.doc(`users/uid-page-${i}`), { name: `P${i}` });
    await b.commit();
    await db.doc(`users/${U1}`).update({ name: 'n'.repeat(5000) });
    let r: any;
    const f = await fetched(async () => { r = await ask(fns.adminListProfiles); });
    expect(largestPage(f, 'users')).toBe(10);
    expect(fieldsOf(f, 'users')).toEqual(['birthday', 'email', 'fcmTokens', 'friends', 'name', 'photoURL']);
    expect(r.truncated).toBe(false);
    expect(r.profiles.find((p: { uid: string }) => p.uid === U1)).toMatchObject({ name: 'n'.repeat(100), friends: 1, pushEnabled: true });
    expect(r.profiles.find((p: { uid: string }) => p.uid === ADMIN)).toMatchObject({ friends: 1, pushEnabled: false });
  });

  it('out of time, still lists everybody from sign-in, and says the rest stopped', async () => {
    ADMIN_READ.budgetMs = -1;
    const r = await ask(fns.adminListProfiles);
    expect(r.truncated).toBe(true);
    expect(r.profiles.map((p: { uid: string }) => p.uid).sort()).toEqual([U1, ADMIN].sort());
    expect(r.profiles.find((p: { uid: string }) => p.uid === U1)).toMatchObject({ email: 'one@example.test', friends: 0 });
  });
});

describe('a person’s fields that are not text', () => {
  it('come back as nothing, in the list and in one person’s page', async () => {
    // Stored before the rule, or by the server: a time, bytes, a number, a place.
    await admin.auth().createUser({ uid: 'uid-bounds-odd' });
    await db.doc('users/uid-bounds-odd').set({
      name: admin.firestore.Timestamp.now(), email: Buffer.from('x'.repeat(100)), photoURL: 7,
      birthday: new admin.firestore.GeoPoint(1, 2), friends: [{ uid: 5, name: { a: 1 }, email: 'f@example.test' }],
    });
    const list = await ask(fns.adminListProfiles);
    expect(list.profiles.find((p: { uid: string }) => p.uid === 'uid-bounds-odd'))
      .toMatchObject({ name: null, email: null, photoURL: null, birthday: null, friends: 1 });
    const one = await ask(fns.adminGetUser, { uid: 'uid-bounds-odd' });
    expect(one).toMatchObject({ name: null, birthday: null, friends: [{ uid: null, name: null, email: 'f@example.test' }] });
  });
});

describe('the growth chart', () => {
  it('counts the days of text times without fetching them, and reads only Firestore times in the window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db.doc('events/t1').set({ ownerId: U1, createdAt: `${today}T09:00:00.000Z${'z'.repeat(5000)}` });
    await db.doc('events/t2').set({ ownerId: U1, createdAt: admin.firestore.Timestamp.now() });
    await db.doc('events/t3').set({ ownerId: U1, createdAt: NULLS });
    await db.doc('games/old').set({ groupId: 'g1', gameType: 'connect-4', createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 864e5) });
    let r: any;
    const f = await fetched(async () => { r = await ask(fns.adminGetGrowth); });
    const sum = (s: Array<{ count: number }>) => s.reduce((a, d) => a + d.count, 0);
    expect(sum(r.events)).toBe(6);
    expect(sum(r.games)).toBe(3);
    expect(fieldsOf(f, 'events')).toEqual(['createdAt']);
    expect(f.filter((x) => x.collection === 'events').flatMap((x) => x.docs).length).toBe(1);
    expect(f.filter((x) => x.collection === 'games').flatMap((x) => x.docs).length).toBe(3);
  });
});

describe('one person', () => {
  it('counts their events, reads ten for the list with a title and a day, and asks the rest by reference', async () => {
    const b = db.batch();
    for (let i = 0; i < 12; i++) b.set(db.doc(`events/m${String(i).padStart(2, '0')}`), { ownerId: U1, title: `M${i}`, isTask: i === 0 ? NULLS : i === 1 || i === 2, taskStatus: i === 1 ? 'completed' : i === 2 ? 'not-started' : NULLS });
    await b.commit();
    let r: any;
    const f = await fetched(async () => { r = await ask(fns.adminGetUser, { uid: U1 }); });
    expect(r.counts.events).toBe(15);
    expect(r.recentEvents).toHaveLength(10);
    expect(largestPage(f, 'events')).toBe(10);
    expect(fieldsOf(f, 'events')).toEqual(['date', 'title']);
    expect(fieldsOf(f, 'users')).toEqual(['birthday', 'fcmTokens', 'friends', 'name']);
    expect(r.recentEvents).toEqual(expect.arrayContaining([
      { id: 'e1', title: 'A', date: '2026-10-10', isTask: true, taskStatus: 'completed' },
      { id: 'e2', title: 'B', date: '2026-10-11', isTask: false, taskStatus: null },
      { id: 'e3', title: 'C', date: null, isTask: true, taskStatus: 'started' },
      { id: 'm00', title: 'M0', date: null, isTask: false, taskStatus: null },
      { id: 'm01', title: 'M1', date: null, isTask: true, taskStatus: 'completed' },
      { id: 'm02', title: 'M2', date: null, isTask: true, taskStatus: 'not-started' },
    ]));
    expect(r).toMatchObject({ name: 'One', birthday: '2000-02-03', pushEnabled: true, friends: [{ uid: ADMIN, name: 'Admin', email: 'admin@example.test' }] });
  });
});

describe('a notification’s type', () => {
  it('is kept to 60 characters, and an empty one is "info"', async () => {
    await admin.auth().createUser({ uid: U2, email: 'two@example.test' });
    await db.doc('groups/g2').set({ name: 'Two', ownerId: U1, members: [U1, U2] });
    await ask(fns.notifyUsers, { recipientIds: [U2], type: 't'.repeat(100), title: 'Hi' }, U1);
    await ask(fns.notifyUsers, { recipientIds: [U2], type: '', title: 'Hi' }, U1);
    const types = (await db.collection('notifications').where('userId', '==', U2).get()).docs.map((d) => d.get('type')).sort();
    expect(types).toEqual(['info', 't'.repeat(60)]);
  });
});
