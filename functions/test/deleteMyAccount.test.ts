// functions/test/deleteMyAccount.test.ts
//
// A person deleting their own account (functions/src/accountDeletion.ts, 04.10.2026), through the real
// callable, on the Firestore, Auth and Storage emulators. Andrei's four decisions are the four first
// tests: groups pass on (or go, when nobody else is in them), group events stay with whoever inherits,
// messages stay under the name, and it is immediate but only after a recent sign-in. The rest came from
// three independent reviews of the first version (04.10).

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
type FilesOutcome = { ok: boolean; deleted: number; kept: number };
let deleteMine: Callable;
let moderate: Callable;
let logClientError: Callable;
let directMessage: { run: (e: unknown) => Promise<unknown> };
let groupMedia: { sweep: (id: string) => Promise<void> };
let accountFiles: { deleteExcept: (...a: any[]) => Promise<FilesOutcome> };
let filesHelper: typeof import('../src/batchDelete');
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
const ADMIN = 'uid-admin';
const GHOST = 'uid-ghost'; // an owner deleted before 04.10, who never left the group's ownerId
const EMAIL = 'gone@example.test';
// Shaped like what addDoc makes, in the order the query returns them: the group they owned with
// others, the one they were a member of, the ones with nobody else in them last. G_LEFT they had left
// earlier; G_OWNED_OUT they own without being in it.
const G_OWNED = 'aaaaaaaaaaaaaaaaaaa1';
const G_MEMBER = 'bbbbbbbbbbbbbbbbbbb2';
const G_LEFT = 'ccccccccccccccccccc3';
const G_GHOST = 'ddddddddddddddddddd4';
const G_OWNED_OUT = 'eeeeeeeeeeeeeeeeeee5';
const G_LEGACY = 'yyyyyyyyyyyyyyyyyyy8'; // from before `ownerId`, with only them in it
const G_ALONE = 'zzzzzzzzzzzzzzzzzzz9';
const DM = [ANA, GONE].sort().join('__');
const DM_BOTH = [GONE, 'uid-gone-earlier'].sort().join('__'); // the other one deleted earlier

const nowS = () => Math.floor(Date.now() / 1000);
const asGone = (authTime = nowS()) => ({
  data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: authTime } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const put = (path: string) => bucket.file(path).save(Buffer.from('x'));
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const data = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;
const authExists = async (uid: string) => admin.auth().getUser(uid).then(() => true, () => false);

const KEPT_FILES = [
  `events/${GONE}/owned-group.png`, // their event in a group that continues: passes to the new owner
  `checklists/${GONE}/member-item.png`, // a checklist photo on their event in a group they were in
  `events/${GONE}/edited.png`, // they edited Ana's event and attached it
  `checklists/${GONE}/ana-item.png`, // a checklist photo on Ana's event
  `checklists/${GONE}/left-item.png`, // on their event in a group they had left: it passes to that owner
  `assets/${GONE}/gift.png`, // a wallet card they gave Bob: the copy points at their file
  `chat-images/${G_OWNED}/${GONE}_1_p.png`, // what they sent in chat stays with the messages
  `events/${ANA}/ana.png`, // somebody else's
];
const GONE_FILES = [
  `events/${GONE}/personal.png`,
  `events/${GONE}/alone.png`,
  `events/${GONE}/orphan.png`,
  // Bob's personal copy of an event shows it, but nothing proves where that link came from.
  `events/${GONE}/copied.png`,
  // Their card. Ana's group event and Bob's own card point at it too, which anybody who saw the link
  // could do: neither keeps it.
  `assets/${GONE}/card.png`,
  // Nothing that stays shows a profile photo; Bob's event pointing at it does not keep it.
  `profiles/${GONE}_1.png`,
  `backgrounds/${GONE}_1.png`,
  `chat-images/${G_ALONE}/${GONE}_1_x.png`, // the group nobody else was in takes its media
  `chat-images/${DM_BOTH}/${GONE}_1_y.png`, // a direct chat with nobody left in it
];

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const index = (await import('../src/index')) as unknown as Record<string, any>;
  deleteMine = index.deleteMyAccount;
  moderate = index.adminModerateUser;
  logClientError = index.logClientError;
  directMessage = index.onDirectMessageCreated;
  groupMedia = (await import('../src/groupMedia')).groupMedia;
  accountFiles = (await import('../src/accountDeletion')).accountFiles;
  filesHelper = await import('../src/batchDelete');
  db = admin.firestore();
  bucket = admin.storage().bucket();
  expect(bucket.name.startsWith('demo-'), `bucket "${bucket.name}" is not a demo bucket`).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await bucket.deleteFiles({ force: true });

  await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true, displayName: 'Old Auth Name' });
  for (const uid of [ANA, BOB, CAROL]) await admin.auth().createUser({ uid });

  await db.doc(`users/${GONE}`).set({ name: 'Gina', email: EMAIL, friends: [{ uid: ANA, name: 'Ana' }] });
  await db.doc(`profiles/${GONE}`).set({ name: 'Gina', photoURL: url(`profiles/${GONE}_1.png`) });
  await db.doc(`users/${ANA}`).set({ name: 'Ana', friends: [{ uid: GONE, name: 'Gina' }, { uid: BOB, name: 'Bob' }] });

  await db.doc(`groups/${G_OWNED}`).set({ name: 'Family', ownerId: GONE, members: [GONE, ANA, BOB] });
  await db.doc(`groups/${G_MEMBER}`).set({ name: 'Friends', ownerId: BOB, members: [BOB, GONE, CAROL] });
  // Its owner is not its first member (somebody handed it over once): the heir is the OWNER.
  await db.doc(`groups/${G_LEFT}`).set({ name: 'Old club', ownerId: CAROL, members: [BOB, CAROL] });
  await db.doc(`groups/${G_GHOST}`).set({ name: 'Orphaned', ownerId: GHOST, members: [GONE, ANA] });
  await db.doc(`groups/${G_OWNED_OUT}`).set({ name: 'Theirs, from outside', ownerId: GONE, members: [ANA, BOB] });
  await db.doc(`groups/${G_LEGACY}`).set({ name: 'Ancient', members: [GONE] });
  await db.doc(`groups/${G_ALONE}`).set({ name: 'Mine', ownerId: GONE, members: [GONE] });
  await db.doc(`groups/${G_OWNED}/messages/m1`).set({ senderId: GONE, text: 'hello', seenBy: [GONE, ANA] });
  await db.doc(`groups/${G_OWNED}/typing/${GONE}`).set({ updatedAt: 1 });
  await db.doc(`groups/${G_ALONE}/messages/m1`).set({ senderId: GONE, text: 'note to self' });

  await db.doc('events/e-personal').set({ ownerId: GONE, groupId: null, imageUrl: url(`events/${GONE}/personal.png`) });
  await db.doc('events/e-owned-group').set({ ownerId: GONE, groupId: G_OWNED, imageUrl: url(`events/${GONE}/owned-group.png`) });
  // Their own event that stays, which a member edited to show their profile photo: that does not keep it.
  await db.doc('events/e-owned-profile').set({ ownerId: GONE, groupId: G_OWNED, imageUrl: url(`profiles/${GONE}_1.png`) });
  await db.doc('events/e-member-group').set({
    ownerId: GONE, groupId: G_MEMBER,
    checklistItems: [{ id: 'i1', text: 'x', isCompleted: false, assetUrl: url(`checklists/${GONE}/member-item.png`) }],
  });
  await db.doc('events/e-alone').set({ ownerId: GONE, groupId: G_ALONE, imageUrl: url(`events/${GONE}/alone.png`) });
  await db.doc('events/e-left').set({
    ownerId: GONE, groupId: G_LEFT,
    checklistItems: [{ id: 'i3', text: 'z', isCompleted: false, assetUrl: url(`checklists/${GONE}/left-item.png`) }],
  });
  await db.doc('events/e-ghost').set({ ownerId: GONE, groupId: G_GHOST });
  await db.doc('events/e-orphan').set({ ownerId: GONE, groupId: 'a-group-deleted-long-ago', imageUrl: url(`events/${GONE}/orphan.png`) });
  // A surprise for Bob, who owns the group: it must not land in his calendar.
  await db.doc('events/e-surprise').set({ ownerId: GONE, groupId: G_MEMBER, hiddenFrom: [BOB] });
  // Hidden from everybody else in the group: nobody may inherit it.
  await db.doc('events/e-secret').set({ ownerId: GONE, groupId: G_MEMBER, hiddenFrom: [BOB, CAROL] });
  await db.doc('events/e-ana').set({
    ownerId: ANA, groupId: G_OWNED, assigneeIds: [GONE, ANA], assigneeId: GONE,
    rsvps: { [GONE]: 'yes', [ANA]: 'no' }, imageUrl: url(`events/${GONE}/edited.png`),
  });
  await db.doc('events/e-ana2').set({
    ownerId: ANA, groupId: G_OWNED,
    checklistItems: [{ id: 'i2', text: 'y', isCompleted: false, assetUrl: url(`checklists/${GONE}/ana-item.png`) }],
  });
  // Ana points a group event of hers at Gina's wallet card, whose link she has seen.
  await db.doc('events/e-ana-card').set({ ownerId: ANA, groupId: G_OWNED, imageUrl: url(`assets/${GONE}/card.png`) });
  await db.doc('events/e-bob-legacy').set({ ownerId: BOB, groupId: G_MEMBER, assigneeId: GONE, assigneeIds: [BOB] });
  await db.doc('events/e-bob-copy').set({ ownerId: BOB, groupId: null, imageUrl: url(`events/${GONE}/copied.png`) });
  await db.doc('events/e-bob-profile').set({ ownerId: BOB, groupId: G_MEMBER, imageUrl: url(`profiles/${GONE}_1.png`) });
  // Anybody may put any answers in an event of their own; those are nobody else's business.
  await db.doc('events/e-bob-rsvp').set({ ownerId: BOB, groupId: null, rsvps: { [GONE]: 'yes' } });

  await db.doc('assets/a-gone').set({ ownerId: GONE, imageUrl: url(`assets/${GONE}/card.png`), sharedGroupId: G_OWNED });
  await db.doc('assets/a-gift').set({ ownerId: BOB, transferredFrom: GONE, imageUrl: url(`assets/${GONE}/gift.png`) });
  await db.doc('assets/a-bob-forged').set({ ownerId: BOB, imageUrl: url(`assets/${GONE}/card.png`) });

  await db.doc(`chats/${DM}`).set({ members: [ANA, GONE].sort(), createdBy: ANA });
  await db.doc(`chats/${DM}/messages/d1`).set({ senderId: GONE, text: 'bye' });
  await db.doc(`chats/${DM}/typing/${GONE}`).set({ updatedAt: 1 });
  await db.doc(`chats/${DM_BOTH}`).set({ members: [GONE, 'uid-gone-earlier'].sort(), formerMembers: { 'uid-gone-earlier': { name: 'Earlier' } } });
  await db.doc(`chats/${DM_BOTH}/messages/x1`).set({ senderId: GONE, text: 'hello?' });

  await db.doc('group_invites/from-gone').set({ fromId: GONE, toEmail: 'x@example.test', groupId: G_OWNED, status: 'pending' });
  await db.doc('group_invites/to-gone').set({ fromId: ANA, toId: GONE, toEmail: 'other@example.test', groupId: G_LEFT, status: 'pending' });
  await db.doc('group_invites/to-address').set({ fromId: CAROL, toId: null, toEmail: EMAIL, groupId: G_LEFT, status: 'pending' });
  await db.doc('group_invites/unrelated').set({ fromId: ANA, toId: BOB, toEmail: 'bob@example.test', groupId: G_OWNED, status: 'pending' });
  await db.doc('invite_links/L1').set({ groupId: G_OWNED, createdBy: GONE, createdByName: 'Gina', revoked: false });
  await db.doc('invite_links/L2').set({ groupId: G_OWNED, createdBy: ANA, createdByName: 'Ana', revoked: false });
  await db.doc('invite_links/L3').set({ groupId: G_OWNED, createdBy: GONE, createdByName: 'Gina', revoked: true });

  await db.doc('friend_requests/fr1').set({ fromId: GONE, toId: CAROL });
  await db.doc('friend_requests/fr2').set({ fromId: BOB, toId: GONE });
  await db.doc('friend_requests/fr3').set({ fromId: CAROL, toId: null, toEmail: EMAIL, status: 'pending' });
  await db.doc('expenses/x1').set({ ownerId: GONE, paidBy: GONE, groupId: G_OWNED, amount: 10 });
  await db.doc('expenses/x2').set({ ownerId: ANA, paidBy: ANA, groupId: G_OWNED, amount: 12 });
  await db.doc('notifications/n1').set({ userId: GONE, createdBy: ANA });
  await db.doc('notifications/n2').set({ userId: ANA, createdBy: GONE });
  await db.doc('games/gm1').set({ createdBy: GONE, groupId: G_OWNED });
  await db.doc('warlordDeploys/gm1').set({ challengerUid: GONE, unitIds: [] });
  await db.doc('warlordPlayers/' + GONE).set({ name: 'Gina' });
  await db.doc('warlordDomains/' + GONE).set({ rev: 1 });
  await db.doc('aiLedger/r1').set({ uid: GONE, feature: 'digest', costUsd: 0.01 });
  await db.doc('aiLedger/r2').set({ uid: ANA, feature: 'digest', costUsd: 0.02 });
  await db.doc('aiSpendDaily/2026-10-01').set({ date: '2026-10-01', calls: 2 });
  await db.doc(`aiSpendDaily/2026-10-01/users/${GONE}`).set({ calls: 1 });
  await db.doc(`aiSpendDaily/2026-10-01/users/${ANA}`).set({ calls: 1 });
  await db.doc(`ai_budget/${GONE}`).set({ microUsd: 5 });
  await db.doc(`ai_preview_usage/${GONE}`).set({ count: 1 });
  await db.collection('errorLogs').add({ uid: GONE, email: EMAIL, message: 'm', source: 'client' });

  for (const p of [...KEPT_FILES, ...GONE_FILES]) await put(p);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Andrei’s decisions (04.10.2026)', () => {
  it('a group they own passes to the member who has been in it longest; one with nobody else in it goes', async () => {
    await deleteMine.run(asGone());
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: ANA, members: [ANA, BOB] });
    expect(await data(`groups/${G_MEMBER}`)).toMatchObject({ ownerId: BOB, members: [BOB, CAROL] });
    expect(await exists(`groups/${G_ALONE}`)).toBe(false);
    expect((await db.collection(`groups/${G_ALONE}/messages`).get()).size).toBe(0);
    expect(await exists('events/e-alone')).toBe(false);
  });

  it('their events in a group stay with the group’s owner as it is now; their personal ones go', async () => {
    await deleteMine.run(asGone());
    expect(await data('events/e-owned-group')).toMatchObject({ ownerId: ANA, groupId: G_OWNED });
    expect(await data('events/e-member-group')).toMatchObject({ ownerId: BOB, groupId: G_MEMBER });
    expect(await data('events/e-left')).toMatchObject({ ownerId: CAROL, groupId: G_LEFT });
    expect(await exists('events/e-personal')).toBe(false);
    expect(await exists('events/e-orphan')).toBe(false);
  });

  it('their messages stay, and every conversation they were in keeps their name, marked deleted', async () => {
    await deleteMine.run(asGone());
    expect(await data(`groups/${G_OWNED}/messages/m1`)).toMatchObject({ senderId: GONE, text: 'hello' });
    expect(await data(`chats/${DM}/messages/d1`)).toMatchObject({ senderId: GONE, text: 'bye' });
    // The public name, not the Auth one, and never the address.
    for (const path of [`groups/${G_OWNED}`, `groups/${G_MEMBER}`, `groups/${G_GHOST}`, `chats/${DM}`]) {
      const fm = (await data(path))?.formerMembers;
      expect(fm?.[GONE]?.name, path).toBe('Gina');
      expect(fm?.[GONE]?.deletedAt, path).toBeTruthy();
    }
    // A direct chat keeps both people: that is what names it for the one still reading it.
    expect((await data(`chats/${DM}`))?.members).toEqual([ANA, GONE].sort());
    expect(await exists(`chats/${DM}/typing/${GONE}`)).toBe(false);
    expect(await exists(`groups/${G_OWNED}/typing/${GONE}`)).toBe(false);
  });

  it('only after a recent sign-in, and a refusal touches nothing', async () => {
    await expect(deleteMine.run(asGone(nowS() - 6 * 60))).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'recent-sign-in-required' },
    });
    await expect(deleteMine.run({ ...asGone(), auth: { uid: GONE, token: { uid: GONE } } } as unknown as CallableRequest<unknown>))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(deleteMine.run({ data: {}, rawRequest: {} } as unknown as CallableRequest<unknown>))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await exists(`users/${GONE}`)).toBe(true);
    expect(await authExists(GONE)).toBe(true);
    expect(await exists('accountDeletions/' + GONE)).toBe(false);
    for (const p of GONE_FILES) expect(await fileExists(p), p).toBe(true);
  });
});

describe('who inherits', () => {
  it('an event hidden from the owner goes to the first member who may see it; hidden from all, it goes', async () => {
    await deleteMine.run(asGone());
    expect(await data('events/e-surprise')).toMatchObject({ ownerId: CAROL });
    expect(await exists('events/e-secret')).toBe(false);
  });

  it('an owner who is not in the group (deleted long ago) does not inherit; the first member does', async () => {
    await deleteMine.run(asGone());
    expect(await data('events/e-ghost')).toMatchObject({ ownerId: ANA });
    expect(await data(`groups/${G_GHOST}`)).toMatchObject({ ownerId: GHOST, members: [ANA] });
  });

  it('a group they own without being in it passes on too, and keeps their name for what they wrote', async () => {
    await deleteMine.run(asGone());
    expect(await data(`groups/${G_OWNED_OUT}`)).toMatchObject({ ownerId: ANA, members: [ANA, BOB], formerMembers: { [GONE]: { name: 'Gina' } } });
  });

  it('a group from before owners, with only them in it, goes instead of staying empty', async () => {
    await deleteMine.run(asGone());
    expect(await exists(`groups/${G_LEGACY}`)).toBe(false);
  });

  it('the hand-over reads the group as it is THEN: somebody who left meanwhile is not made owner', async () => {
    const real = accountFiles.deleteExcept;
    vi.spyOn(accountFiles, 'deleteExcept').mockImplementationOnce(async (...a: any[]) => {
      // Ana leaves Family while the files are being deleted.
      await db.doc(`groups/${G_OWNED}`).update({ members: admin.firestore.FieldValue.arrayRemove(ANA) });
      return real(...a);
    });
    await deleteMine.run(asGone());
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: BOB, members: [BOB] });
    expect(await data('events/e-owned-group')).toMatchObject({ ownerId: BOB });
  });

  it('and a group handed over late in the run is read again too, not taken from the list read before', async () => {
    // Deleting a group with nobody else in it takes a while (its media, its messages). Ana leaves the
    // group Gina owns from outside, which comes last, during the first such deletion.
    const realSweep = groupMedia.sweep;
    vi.spyOn(groupMedia, 'sweep').mockImplementationOnce(async (id: string) => {
      await db.doc(`groups/${G_OWNED_OUT}`).update({ members: admin.firestore.FieldValue.arrayRemove(ANA) });
      return realSweep(id);
    });
    await deleteMine.run(asGone());
    expect(await data(`groups/${G_OWNED_OUT}`)).toMatchObject({ ownerId: BOB, members: [BOB] });
  });
});

describe('everything else', () => {
  it('the account, the profile and what is only theirs are gone; the record says who asked', async () => {
    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(await authExists(GONE)).toBe(false);
    for (const path of [
      `users/${GONE}`, `profiles/${GONE}`, 'assets/a-gone', 'expenses/x1', 'notifications/n1', 'games/gm1',
      'warlordDeploys/gm1', `warlordPlayers/${GONE}`, `warlordDomains/${GONE}`, `ai_budget/${GONE}`,
      `ai_preview_usage/${GONE}`, 'friend_requests/fr1', 'friend_requests/fr2', 'friend_requests/fr3',
      `aiSpendDaily/2026-10-01/users/${GONE}`,
    ]) expect(await exists(path), path).toBe(false);
    for (const path of ['expenses/x2', 'notifications/n2', 'assets/a-gift', `aiSpendDaily/2026-10-01/users/${ANA}`, 'aiSpendDaily/2026-10-01'])
      expect(await exists(path), path).toBe(true);
    expect((await db.collection('errorLogs').where('uid', '==', GONE).get()).size).toBe(0);
    expect(await data('accountDeletions/' + GONE)).toMatchObject({ by: 'self', filesDone: true });
    expect((await data('accountDeletions/' + GONE))?.finishedAt).toBeTruthy();
  });

  it('the cost ledger keeps its rows, without them', async () => {
    await deleteMine.run(asGone());
    expect(await data('aiLedger/r1')).toMatchObject({ uid: null, costUsd: 0.01 });
    expect(await data('aiLedger/r2')).toMatchObject({ uid: ANA });
  });

  it('they come off events in their groups: assignee, the older single field, their answer — and only there', async () => {
    await deleteMine.run(asGone());
    const ev = await data('events/e-ana');
    expect(ev).toMatchObject({ ownerId: ANA, assigneeIds: [ANA], assigneeId: ANA, rsvps: { [ANA]: 'no' } });
    expect(ev?.rsvps).not.toHaveProperty(GONE);
    expect(await data('events/e-bob-legacy')).toMatchObject({ assigneeId: BOB, assigneeIds: [BOB] });
    expect((await data('events/e-bob-rsvp'))?.rsvps).toEqual({ [GONE]: 'yes' });
  });

  it('invitations and friend requests to and from them go; their links are revoked and lose the name', async () => {
    await deleteMine.run(asGone());
    for (const id of ['from-gone', 'to-gone', 'to-address']) expect(await exists(`group_invites/${id}`), id).toBe(false);
    expect(await exists('group_invites/unrelated')).toBe(true);
    expect(await data('invite_links/L1')).toMatchObject({ revoked: true, createdByName: null });
    expect(await data('invite_links/L3')).toMatchObject({ revoked: true, createdByName: null });
    expect(await data('invite_links/L2')).toMatchObject({ revoked: false, createdByName: 'Ana' });
    expect((await data(`users/${ANA}`))?.friends).toEqual([{ uid: BOB, name: 'Bob' }]);
  });

  it('an address that was never proven theirs does not take what is waiting for it', async () => {
    await admin.auth().updateUser(GONE, { emailVerified: false });
    await deleteMine.run(asGone());
    expect(await exists('group_invites/to-address')).toBe(true);
    expect(await exists('friend_requests/fr3')).toBe(true);
    expect(await exists('group_invites/to-gone')).toBe(false);
  });

  it('a direct chat with nobody left in it goes, with its photos', async () => {
    await deleteMine.run(asGone());
    expect(await exists(`chats/${DM_BOTH}`)).toBe(false);
    expect((await db.collection(`chats/${DM_BOTH}/messages`).get()).size).toBe(0);
    expect(await exists(`chats/${DM}`)).toBe(true);
  });
});

describe('their files', () => {
  it('what something that stays still shows is kept, the rest of their folders goes', async () => {
    const r = await deleteMine.run(asGone());
    for (const p of KEPT_FILES) expect(await fileExists(p), p).toBe(true);
    for (const p of GONE_FILES) expect(await fileExists(p), p).toBe(false);
    expect(r.files).toEqual({ deleted: 7, kept: 6 });
  });
});

describe('a deletion that stops part way', () => {
  it('fails with the account still there, and the next run finishes without re-reading a shorter keep list', async () => {
    // The media of the first group with nobody else in it cannot be swept: the group they owned with
    // others has already been handed over (the query returns it first), the rest has not.
    vi.spyOn(groupMedia, 'sweep').mockRejectedValueOnce(new Error('storage down'));
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'unavailable' });
    expect(await authExists(GONE)).toBe(true);
    expect(await exists(`users/${GONE}`)).toBe(true);
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: ANA });
    expect(await exists(`groups/${G_ALONE}`)).toBe(true);
    expect(await data('accountDeletions/' + GONE)).toMatchObject({ filesDone: true });
    // They came off the events BEFORE leaving the groups: a stopped run does not leave an assignee
    // who is no longer a member, which would refuse every later edit of the event.
    expect((await data('events/e-ana'))?.assigneeIds).toEqual([ANA]);

    // A second run no longer finds them in Family, so a fresh keep list would miss Ana's checklist photo.
    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true, files: null });
    expect(await exists(`groups/${G_ALONE}`)).toBe(false);
    for (const p of KEPT_FILES) expect(await fileExists(p), p).toBe(true);
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: ANA, members: [ANA, BOB], formerMembers: { [GONE]: { name: 'Gina' } } });
  });
});

describe('when a step cannot finish, nothing claims it did', () => {
  it('files that could not all be deleted: it stops before the account goes, and a retry finishes', async () => {
    vi.spyOn(accountFiles, 'deleteExcept').mockResolvedValueOnce({ ok: false, deleted: 0, kept: 0 });
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'unavailable' });
    expect(await authExists(GONE)).toBe(true);
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: GONE });
    expect((await data('accountDeletions/' + GONE))?.filesDone).toBeUndefined();
    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    for (const p of GONE_FILES) expect(await fileExists(p), p).toBe(false);
  });

  it('a sign-in account that could not be removed: refused as unfinished, not reported done', async () => {
    vi.spyOn(admin.auth(), 'deleteUser').mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'auth/internal-error' }));
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({ code: 'unavailable' });
    expect(await authExists(GONE)).toBe(true);
    expect((await data('accountDeletions/' + GONE))?.finishedAt).toBeUndefined();
    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect(await authExists(GONE)).toBe(false);
  });

  it('the finish mark failing after everything is gone does not turn the deletion into a failure', async () => {
    const proto = Object.getPrototypeOf(db.doc('x/y')) as { set: (...a: any[]) => Promise<unknown> };
    const realSet = proto.set;
    vi.spyOn(proto, 'set').mockImplementation(function (this: admin.firestore.DocumentReference, ...a: any[]) {
      if (this.path === `accountDeletions/${GONE}` && a[0] && 'finishedAt' in a[0]) return Promise.reject(new Error('write failed'));
      return realSet.apply(this, a);
    });
    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(await authExists(GONE)).toBe(false);
  });
});

describe('who may', () => {
  it('not an admin account', async () => {
    await db.doc(`admins/${GONE}`).set({ addedBy: 'test' });
    await expect(deleteMine.run(asGone())).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'admin-account' },
    });
    expect(await exists(`users/${GONE}`)).toBe(true);
  });

  it('an admin deleting somebody runs the same deletion', async () => {
    await db.doc(`admins/${ADMIN}`).set({ addedBy: 'test' });
    const r = await moderate.run({
      data: { uid: GONE, action: 'delete' }, auth: { uid: ADMIN, token: { uid: ADMIN } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>);
    expect(r).toMatchObject({ ok: true, deleted: true, authDeleted: true });
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: ANA, members: [ANA, BOB] });
    expect(await data('events/e-owned-group')).toMatchObject({ ownerId: ANA });
    expect(await data('accountDeletions/' + GONE)).toMatchObject({ by: `admin:${ADMIN}` });
  });
});

describe('after', () => {
  it('a message sent into a direct chat with a deleted account tells nobody who no longer exists', async () => {
    await deleteMine.run(asGone());
    const ref = db.doc(`chats/${DM}/messages/late`);
    await ref.set({ senderId: ANA, text: 'are you there?' });
    await directMessage.run({ data: await ref.get(), params: { chatId: DM, messageId: 'late' } });
    expect((await db.collection('notifications').where('userId', '==', GONE).get()).size).toBe(0);
  });

  it('what a leftover session reports does not put back the rows the deletion removed', async () => {
    await deleteMine.run(asGone());
    const r = await logClientError.run({
      data: { message: 'after the deletion' }, auth: { uid: GONE, token: { uid: GONE, email: EMAIL } },
      rawRequest: { headers: { 'user-agent': 'x' } },
    } as unknown as CallableRequest<unknown>);
    expect(r).toMatchObject({ ok: false });
    expect((await db.collection('errorLogs').where('uid', '==', GONE).get()).size).toBe(0);
    expect(await exists(`error_usage/${GONE}`)).toBe(false);
    // Somebody else's report still goes through.
    const other = await logClientError.run({
      data: { message: 'theirs' }, auth: { uid: ANA, token: { uid: ANA } }, rawRequest: { headers: {} },
    } as unknown as CallableRequest<unknown>);
    expect(other).toMatchObject({ ok: true });
  });
});

describe('deleteFilesExcept says whether it worked', () => {
  // Its predecessor swallowed every failure and reported the files gone (25.09.2026).
  it('false when a listing or a delete fails, true only when everything went', async () => {
    const del = () => Promise.resolve();
    const failingList = () => ({ getFiles: async () => { throw new Error('denied'); } });
    const failingDelete = () => ({ getFiles: async () => [[{ name: 'a/1', delete: () => Promise.reject(new Error('denied')) }]] as any });
    const fine = () => ({ getFiles: async () => [[{ name: 'a/1', delete: del }, { name: 'a/2', delete: del }]] as any });
    expect((await filesHelper.deleteFilesExcept(['a/'], new Set(), failingList as any)).ok).toBe(false);
    expect((await filesHelper.deleteFilesExcept(['a/'], new Set(), failingDelete)).ok).toBe(false);
    expect(await filesHelper.deleteFilesExcept(['a/'], new Set(['a/2']), fine)).toEqual({ ok: true, deleted: 1, kept: 1 });
  });
});
