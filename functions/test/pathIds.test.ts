// functions/test/pathIds.test.ts
//
// An id from outside names ONE document (01.11.2026, functions/src/docId.ts).
//
// The server builds `groups/${id}` out of ids it did not choose: a callable's argument, or a field a
// client wrote on an invitation, an event or a game. `g1/typing/uid-mallory` is a valid path, to a
// document UNDER the group, and every membership check built that way asked that document for its
// `members`. The rules refuse to let a member shape such a document today (since 08.10); the day one
// subcollection forgets, each check below would have let a stranger in. So the shape is planted here
// with the Admin SDK, exactly as an attacker would want it, and every reader is walked past it, on the
// emulators, through the real functions.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Fn = { run: (arg: unknown) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const DAVE = 'uid-dave';
const MALLORY = 'uid-mallory';
const PEOPLE: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob', [DAVE]: 'Dave', [MALLORY]: 'Mallory' };
const emailOf = (uid: string) => `${PEOPLE[uid].toLowerCase()}@example.test`;

/** A document under the group that names Mallory a member: what each check used to trust. */
const PLANTED = `g1/typing/${MALLORY}`;

function call(name: string, uid: string, data: Record<string, unknown>) {
  return fn[name].run({
    data,
    auth: { uid, token: { uid, email: emailOf(uid), email_verified: true } },
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}

const members = async () => ((await db.doc('groups/g1').get()).data()?.members ?? []) as string[];
const planted = async () => (await db.doc(`groups/${PLANTED}`).get()).data();

/** FCM is not emulated: a recorder, so a push that should not happen is seen, and none leaves. */
let pushed: string[][];

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running (scripts/test-rules.mjs starts it)').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  // The link callables too: index.ts exports them.
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  for (const [uid, name] of Object.entries(PEOPLE)) {
    await admin.auth().createUser({ uid, email: emailOf(uid), emailVerified: true });
    await db.doc(`profiles/${uid}`).set({ name });
    await db.doc(`users/${uid}`).set({ name, language: 'en-US', fcmTokens: [`tok-${uid}`] });
  }
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
  await db.doc(`groups/${PLANTED}`).set({ ownerId: MALLORY, members: [MALLORY, ALICE, BOB], name: 'Planted' });
  pushed = [];
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'sendEachForMulticast').mockImplementation((async (msg: { tokens: string[] }) => {
    pushed.push(msg.tokens);
    return { successCount: msg.tokens.length, failureCount: 0, responses: msg.tokens.map(() => ({ success: true })) };
  }) as never);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('a group id a client wrote is read as ONE document, or not at all', () => {
  it('an occurrence of Alice’s series filed under the planted path: Mallory may not edit it', async () => {
    await db.doc('events/e1').set({
      title: 'Walk', ownerId: ALICE, groupId: PLANTED, date: '2026-09-20T00:00:00.000Z',
      recurrenceRule: { frequency: 'daily' }, assigneeIds: [],
    });
    await expect(call('createEventOverride', MALLORY, {
      parentId: 'e1', overrideDate: '2026-09-22', data: { title: 'Mine now' },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection('events').where('overrideOfParent', '==', 'e1').get()).size).toBe(0);
  });

  it('Alice’s own occurrence of it names nobody the planted document lists', async () => {
    await db.doc('events/e1').set({
      title: 'Walk', ownerId: ALICE, groupId: PLANTED, date: '2026-09-20T00:00:00.000Z',
      recurrenceRule: { frequency: 'daily' }, assigneeIds: [MALLORY],
    });
    const { id } = await call('createEventOverride', ALICE, {
      parentId: 'e1', overrideDate: '2026-09-22', data: { title: 'Walk', assigneeIds: [MALLORY] },
    });
    expect((await db.doc(`events/${id}`).get()).data()?.assigneeIds).toEqual([]);
  });

  it('an invitation to the planted path: accepting it adds nobody anywhere', async () => {
    await db.doc('group_invites/i1').set({
      fromId: MALLORY, toId: DAVE, toEmail: null, groupId: PLANTED, status: 'pending', createdAt: new Date().toISOString(),
    });
    await expect(call('acceptGroupInvite', DAVE, { inviteId: 'i1' })).rejects.toMatchObject({ code: 'not-found' });
    expect(await members()).toEqual([ALICE, BOB]);
    expect((await planted())?.members).toEqual([MALLORY, ALICE, BOB]);
    expect((await db.doc('group_invites/i1').get()).data()?.status).toBe('pending');
  });

  it('the stamp on such an invitation names no group: the planted name is not vouched for', async () => {
    const ref = db.doc('group_invites/i2');
    await ref.set({ fromId: MALLORY, toId: DAVE, toEmail: null, groupId: PLANTED, status: 'pending' });
    await fn.onGroupInviteCreated.run({ data: await ref.get(), params: { inviteId: 'i2' } });
    const stamped = (await ref.get()).data() ?? {};
    expect(stamped.sender).toMatchObject({ name: 'Mallory' });
    expect(stamped.verifiedGroupName).toBeUndefined();
    expect(JSON.stringify(stamped)).not.toContain('Planted');
  });

  it('a game filed under the planted path is announced to nobody, and says why', async () => {
    const ref = db.doc('games/game-1');
    await ref.set({ groupId: PLANTED, createdBy: MALLORY, gameType: 'tic-tac-toe', status: 'waiting', state: {}, winner: null });
    await fn.onGameCreated.run({ data: await ref.get(), params: { gameId: 'game-1' } });
    expect(pushed).toEqual([]);
    expect((await db.collection('notifications').get()).size).toBe(0);
    const rows = (await db.collection('errorLogs').get()).docs.map((d) => d.data());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ context: 'games:onGameCreated', uid: MALLORY, source: 'server' });
    expect(rows[0].message).toContain('its group id is not a document id');
  });

  it('a link Dave used, now filed under the planted path, does not welcome him in by the planted list', async () => {
    const { code } = await call('createGroupInviteLink', ALICE, { groupId: 'g1' });
    await call('redeemGroupInviteLink', DAVE, { code });
    await db.doc(`invite_links/${code}`).update({ groupId: PLANTED });
    await db.doc(`groups/${PLANTED}`).update({ members: [MALLORY, DAVE] });
    // "You used this one" means "you are in" only while you are; the planted list says he is.
    expect(await call('peekGroupInviteLink', DAVE, { code })).toMatchObject({ valid: false, reason: 'spent' });
  });

  it('a Warlord battle filed under the planted path cannot be accepted on its list', async () => {
    const army = {
      unitIds: ['u1'],
      combatants: [{ unitId: 'u1', type: 'LIGHT_INF_SWORD', hp: 10, morale: 50, buckets: [{ r: 'NOVICE', count: 10, avgXP: 0 }] }],
    };
    const { gameId } = await call('createWarlordChallenge', ALICE, { groupId: 'g1', opponentUid: BOB, ...army });
    await db.doc(`games/${gameId}`).update({ groupId: PLANTED });
    await expect(call('acceptWarlordChallenge', BOB, { gameId, ...army })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc(`games/${gameId}`).get()).data()?.status).toBe('waiting');
  });

  it('Alice deleting her account: her event filed under the planted path is hers alone, and goes with her', async () => {
    // The planted list would have named Mallory the heir, and kept the files the event shows.
    const card = `assets/${ALICE}/card.jpg`;
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${admin.storage().bucket().name}/o/${encodeURIComponent(card)}?alt=media&token=t`;
    await db.doc('events/e1').set({ title: 'Walk', ownerId: ALICE, groupId: PLANTED, date: '2026-09-20T00:00:00.000Z', imageUrl });
    const acc = await import('../src/accountDeletion');
    vi.spyOn(acc.accountFiles, 'list').mockResolvedValue(new Set([card]) as never);
    const files = vi.spyOn(acc.accountFiles, 'deleteExcept').mockResolvedValue({ ok: true, deleted: 1, kept: 0 } as never);
    await acc.deleteAccountData(ALICE, 'self');
    expect((await db.doc('events/e1').get()).exists).toBe(false);
    expect((await planted())?.ownerId).toBe(MALLORY);
    // Her card's file goes with her: no event that stays shows it.
    expect(files).toHaveBeenCalled();
    expect([...(files.mock.calls[0][1] as ReadonlySet<string>)]).not.toContain(card);
  });

  it('a link whose group is the planted path (an old one, say) is redeemed into nothing', async () => {
    const { code } = await call('createGroupInviteLink', ALICE, { groupId: 'g1' });
    await db.doc(`invite_links/${code}`).update({ groupId: PLANTED });
    await expect(call('redeemGroupInviteLink', DAVE, { code })).rejects.toMatchObject({ code: 'not-found' });
    expect(await members()).toEqual([ALICE, BOB]);
    expect((await planted())?.members).toEqual([MALLORY, ALICE, BOB]);
  });
});

describe('a callable’s id argument names ONE document', () => {
  it('Mallory cannot mint a link for the planted path', async () => {
    await expect(call('createGroupInviteLink', MALLORY, { groupId: PLANTED })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await db.collection('invite_links').get()).size).toBe(0);
  });

  it('nor tag a Warlord challenge with it', async () => {
    await expect(call('createWarlordChallenge', MALLORY, { groupId: PLANTED, opponentUid: ALICE }))
      .rejects.toMatchObject({ code: 'invalid-argument', message: 'Invalid group id.' });
  });

  it('an owner’s broadcast goes to "all" or to a group, never to a document under one', async () => {
    // An owner: since 07.11.2026 a plain admin is refused before the target is read (adminRoster.test.ts).
    await db.doc(`admins/${ALICE}`).set({ email: emailOf(ALICE), role: 'owner' });
    await expect(call('adminBroadcast', ALICE, { target: PLANTED, title: 'Hello' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(pushed).toEqual([]);
    expect((await db.collection('notifications').get()).size).toBe(0);
  });

  // Each of these became one segment of a path, unchecked. None has a writable subcollection today;
  // the check is what keeps that from mattering.
  const SLASHED: [string, Record<string, unknown>][] = [
    ['createEventOverride', { parentId: 'e1/x/y', overrideDate: '2026-09-22', data: { title: 'x' } }],
    ['transferAssetCopy', { assetId: 'a1/x/y', recipientId: BOB }],
    ['transferAssetCopy', { assetId: 'a1', recipientId: `${BOB}/x/y` }],
    ['respondToFriendRequest', { requestId: 'r1/x/y', accept: true }],
    ['removeFriend', { friendUid: `${BOB}/x/y` }],
    ['openDirectChat', { otherUid: `${BOB}/x/y` }],
    // Two segments: a path to a collection, which used to throw inside the callable ("internal").
    ['openDirectChat', { otherUid: 'a/b' }],
    ['acceptGroupInvite', { inviteId: 'i1/x/y' }],
    ['peekGroupInviteLink', { code: 'c1/x/y' }],
    ['redeemGroupInviteLink', { code: 'c1/x/y' }],
    ['revokeGroupInviteLink', { code: 'c1/x/y' }],
  ];
  it.each(SLASHED)('%s refuses %j', async (name, data) => {
    await expect(call(name, MALLORY, data)).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
