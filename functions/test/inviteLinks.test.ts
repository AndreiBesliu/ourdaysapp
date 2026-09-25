// functions/test/inviteLinks.test.ts
//
// Group invitation LINKS, through the real handlers, on the emulator — Firestore and Auth. These
// callables run on the Admin SDK, so no rule constrains them; until 25.09 nothing tested them.
//
// Two defects were found by reading them and are pinned here (they failed before the fix):
//   * D1 — a link you once used walked you back into the group after you were REMOVED, and forced
//     the friendship back after you were unfriended: revoked, expired or untouched, it did not
//     matter, because "you already used this" was answered before "this was withdrawn" and then
//     re-applied everything. An owner's link was a permanent back door for everyone who used it.
//   * D3 — a member already in the group spent a single-use link by tapping it (in the family
//     chat, say), and the person it was meant for got "used up".

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let fn: Record<string, Callable>;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const DAVE = 'uid-dave';
const EVE = 'uid-eve';
const PEOPLE: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob', [DAVE]: 'Dave', [EVE]: 'Eve' };
const emailOf = (uid: string) => `${PEOPLE[uid].toLowerCase()}@example.test`;

const call = (name: string, uid: string | null, data: Record<string, unknown>) =>
  fn[name].run({
    data,
    auth: uid ? { uid, token: { uid, email: emailOf(uid), email_verified: true } } : undefined,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);

const members = async (g = 'g1') => ((await db.doc(`groups/${g}`).get()).data()?.members ?? []) as string[];
const friendsOf = async (uid: string) => ((await db.doc(`users/${uid}`).get()).data()?.friends ?? []) as Array<{ uid: string; email: string | null }>;
const link = async (code: string) => (await db.doc(`invite_links/${code}`).get()).data() ?? {};
const notifications = async () => (await db.collection('notifications').get()).size;

async function mint(uid = ALICE, groupId: string | null = 'g1'): Promise<string> {
  const r = await call('createGroupInviteLink', uid, { groupId });
  expect(typeof r.code).toBe('string');
  return r.code as string;
}

/** Remove from the group the way both clients do: arrayRemove on `members`. */
async function removeFromGroup(uid: string) {
  await db.doc('groups/g1').update({ members: admin.firestore.FieldValue.arrayRemove(uid) });
  expect(await members()).not.toContain(uid);
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running (scripts/test-rules.mjs starts it)').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Callable>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  for (const [uid, name] of Object.entries(PEOPLE)) {
    await admin.auth().createUser({ uid, email: emailOf(uid), emailVerified: true });
    await db.doc(`profiles/${uid}`).set({ name });
  }
  // What a person writes about themselves is never what lands in somebody else's list.
  await db.doc(`users/${ALICE}`).set({ email: 'forged@evil.test' });
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
});

describe('redeeming a link: the ordinary cases', () => {
  it('joins the group, spends the one use, makes the two friends with Auth emails, tells the inviter', async () => {
    const code = await mint();
    const r = await call('redeemGroupInviteLink', DAVE, { code });
    expect(r).toMatchObject({ status: 'accepted', joinedGroup: true, groupId: 'g1', groupName: 'Family', invitedBy: 'Alice' });
    expect(await members()).toEqual([ALICE, BOB, DAVE]);
    expect(await link(code)).toMatchObject({ uses: 1, redeemedBy: [DAVE] });
    expect(await friendsOf(DAVE)).toEqual([{ uid: ALICE, name: 'Alice', email: 'alice@example.test' }]);
    expect(await notifications()).toBe(1);
  });

  it('a second person finds it used up', async () => {
    const code = await mint();
    await call('redeemGroupInviteLink', DAVE, { code });
    await expect(call('redeemGroupInviteLink', EVE, { code })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(await members()).not.toContain(EVE);
  });

  it('a revoked link admits nobody new', async () => {
    const code = await mint();
    await call('revokeGroupInviteLink', ALICE, { code });
    await expect(call('redeemGroupInviteLink', DAVE, { code })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await members()).toEqual([ALICE, BOB]);
  });

  it('a link whose creator was since removed admits nobody', async () => {
    const code = await mint(BOB);
    await removeFromGroup(BOB);
    await expect(call('redeemGroupInviteLink', DAVE, { code })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await members()).toEqual([ALICE]);
  });

  it('opening your own link again, while still in, is harmless', async () => {
    const code = await mint();
    await call('redeemGroupInviteLink', DAVE, { code });
    const again = await call('redeemGroupInviteLink', DAVE, { code });
    expect(again).toMatchObject({ status: 'already', joinedGroup: false });
    expect(await link(code)).toMatchObject({ uses: 1 });
    expect(await notifications()).toBe(1);
  });
});

describe('D1 — a link you once used does not walk you back in', () => {
  it.each([
    ['revoked', async (code: string) => { await call('revokeGroupInviteLink', ALICE, { code }); }],
    ['expired', async (code: string) => { await db.doc(`invite_links/${code}`).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) }); }],
    ['untouched', async () => { /* nothing: the link is exactly as Dave left it */ }],
  ] as const)('removed, then the link %s: Dave stays out', async (_label, afterRemoval) => {
    const code = await mint();
    await call('redeemGroupInviteLink', DAVE, { code });
    await removeFromGroup(DAVE);
    await afterRemoval(code);
    const r = await call('redeemGroupInviteLink', DAVE, { code }).catch((e: { code?: string }) => ({ refused: e.code }));
    expect(await members()).toEqual([ALICE, BOB]);
    expect((r as { joinedGroup?: boolean }).joinedGroup ?? false).toBe(false);
  });

  it('unfriended, the link does not force the friendship back', async () => {
    const code = await mint();
    await call('redeemGroupInviteLink', DAVE, { code });
    await removeFromGroup(DAVE);
    await call('removeFriend', ALICE, { friendUid: DAVE });
    expect((await friendsOf(ALICE)).map((f) => f.uid)).not.toContain(DAVE);
    await call('redeemGroupInviteLink', DAVE, { code }).catch(() => undefined);
    expect((await friendsOf(ALICE)).map((f) => f.uid)).not.toContain(DAVE);
  });
});

describe('peek tells the same story as redeem', () => {
  it('still in: "already joined"; removed since: spent — not a welcome into a group redeem refuses', async () => {
    const code = await mint();
    await call('redeemGroupInviteLink', DAVE, { code });
    expect(await call('peekGroupInviteLink', DAVE, { code })).toMatchObject({ valid: true, alreadyJoined: true });
    await removeFromGroup(DAVE);
    expect(await call('peekGroupInviteLink', DAVE, { code })).toMatchObject({ valid: false, reason: 'spent', alreadyJoined: false });
  });

  it('a visitor with no account still sees who invites them', async () => {
    const code = await mint();
    expect(await call('peekGroupInviteLink', null, { code })).toEqual({
      valid: true, reason: null, alreadyJoined: false, groupName: 'Family', invitedBy: 'Alice',
    });
  });
});

describe('D3 — a member tapping the link spends nothing', () => {
  it('Bob is already in: the link stays whole, nobody is told, and Dave can still use it', async () => {
    const code = await mint();
    const r = await call('redeemGroupInviteLink', BOB, { code });
    expect(r).toMatchObject({ joinedGroup: false });
    expect(await link(code)).toMatchObject({ uses: 0, redeemedBy: [] });
    expect(await notifications()).toBe(0);
    const d = await call('redeemGroupInviteLink', DAVE, { code });
    expect(d).toMatchObject({ status: 'accepted', joinedGroup: true });
  });
});

describe('a personal link (no group)', () => {
  it('makes a friendship, spends the use', async () => {
    const code = await mint(ALICE, null);
    const r = await call('redeemGroupInviteLink', DAVE, { code });
    expect(r).toMatchObject({ status: 'accepted', joinedGroup: false, groupId: null });
    expect((await friendsOf(ALICE)).map((f) => f.uid)).toEqual([DAVE]);
    expect(await link(code)).toMatchObject({ uses: 1 });
  });

  it('once used, it does not re-friend somebody who was unfriended since', async () => {
    const code = await mint(ALICE, null);
    await call('redeemGroupInviteLink', DAVE, { code });
    await call('removeFriend', ALICE, { friendUid: DAVE });
    await call('redeemGroupInviteLink', DAVE, { code }).catch(() => undefined);
    expect((await friendsOf(ALICE)).map((f) => f.uid)).not.toContain(DAVE);
  });
});

describe('who may mint and revoke', () => {
  it('only a member mints a link for a group', async () => {
    await expect(call('createGroupInviteLink', DAVE, { groupId: 'g1' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection('invite_links').get()).size).toBe(0);
  });

  it('only the creator revokes it', async () => {
    const code = await mint();
    await expect(call('revokeGroupInviteLink', BOB, { code })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await link(code)).toMatchObject({ revoked: false });
  });
});
