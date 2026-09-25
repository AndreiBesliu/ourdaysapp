// functions/test/acceptGroupInvite.test.ts
//
// Accepting an emailed or uid-addressed group invitation, through the real handler, on the
// emulator (Firestore + Auth). The handler runs on the Admin SDK, so no rule constrains it.
//
// D2 (found 25.09 by reading, pinned here, failed before the fix): an invitation could be
// accepted TWICE. `status` is client-writable (the rule let it move in any direction), and the
// handler treated any falsy status as pending. So: accept, get removed from the group, set your
// own invitation back to 'pending' (or null), accept again — and you were back in, and
// re-befriended. The server now keeps its own record of the acceptance (`acceptedBy`, which no
// client can write), honours only 'pending', and the rule lets an invitation move only from
// pending to an answer (rules-tests/expenses-invites.test.ts).

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
const CAROL = 'uid-carol';
const DAVE = 'uid-dave';
const EVE = 'uid-eve';
const PEOPLE: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob', [CAROL]: 'Carol', [DAVE]: 'Dave', [EVE]: 'Eve' };
const emailOf = (uid: string) => `${PEOPLE[uid].toLowerCase()}@example.test`;

function accept(uid: string, inviteId: string, token: Record<string, unknown> = {}) {
  return fn.acceptGroupInvite.run({
    data: { inviteId },
    auth: { uid, token: { uid, email: emailOf(uid), email_verified: true, ...token } },
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}

const members = async () => ((await db.doc('groups/g1').get()).data()?.members ?? []) as string[];
const friendsOf = async (uid: string) => ((await db.doc(`users/${uid}`).get()).data()?.friends ?? []) as Array<{ uid: string; name: string; email: string | null }>;
const invite = async (id = 'i1') => (await db.doc(`group_invites/${id}`).get()).data() ?? {};

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
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
  // Bob invites dave@… — and writes a forged address about himself, which must go nowhere.
  await db.doc(`users/${BOB}`).set({ email: 'forged@evil.test' });
  await db.doc('group_invites/i1').set({
    fromId: BOB, fromEmail: 'forged@evil.test', toId: null, toEmail: 'dave@example.test',
    groupId: 'g1', status: 'pending', createdAt: new Date().toISOString(),
  });
});

describe('accepting an invitation', () => {
  it('joins, records the acceptance, and befriends the two with emails from Auth', async () => {
    const r = await accept(DAVE, 'i1', { email: 'Dave@Example.test' });
    expect(r).toEqual({ status: 'accepted', groupId: 'g1' });
    expect(await members()).toEqual([ALICE, BOB, DAVE]);
    expect(await invite()).toMatchObject({ status: 'accepted', toId: DAVE, acceptedBy: DAVE });
    expect(await friendsOf(DAVE)).toEqual([{ uid: BOB, name: 'Bob', email: 'bob@example.test' }]);
  });

  it('an unverified address does not claim an invitation sent to it', async () => {
    await expect(accept(DAVE, 'i1', { email_verified: false })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await members()).toEqual([ALICE, BOB]);
    expect(await invite()).toMatchObject({ status: 'pending' });
  });

  it('a bystander cannot accept somebody else’s invitation', async () => {
    await expect(accept(EVE, 'i1')).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('an invitation whose sender has left admits nobody', async () => {
    await db.doc('group_invites/i1').update({ fromId: CAROL });
    await expect(accept(DAVE, 'i1')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await members()).toEqual([ALICE, BOB]);
  });

  it('a declined invitation stays declined, and writes nothing', async () => {
    await db.doc('group_invites/i1').update({ status: 'declined' });
    expect(await accept(DAVE, 'i1')).toEqual({ status: 'declined', groupId: 'g1' });
    expect(await members()).toEqual([ALICE, BOB]);
    expect(await friendsOf(DAVE)).toEqual([]);
  });

  it('a personal invitation (no group) makes a friendship both ways', async () => {
    await db.doc('group_invites/i1').update({ groupId: null });
    expect(await accept(DAVE, 'i1')).toEqual({ status: 'accepted', groupId: null });
    expect((await friendsOf(BOB)).map((f) => f.uid)).toEqual([DAVE]);
    expect((await friendsOf(DAVE)).map((f) => f.uid)).toEqual([BOB]);
  });
});

describe('D2 — an invitation is accepted once', () => {
  async function acceptedThenRemoved() {
    await accept(DAVE, 'i1');
    await db.doc('groups/g1').update({ members: admin.firestore.FieldValue.arrayRemove(DAVE) });
    await db.doc(`users/${DAVE}`).set({ friends: [] }, { merge: true });
    await db.doc(`users/${BOB}`).set({ friends: [] }, { merge: true });
    expect(await members()).toEqual([ALICE, BOB]);
  }

  it.each([['pending'], [null], ['']])('re-opened to %j after removal: Dave stays out, nobody is re-befriended', async (reopened) => {
    await acceptedThenRemoved();
    // The Admin SDK stands in for the client write the rule used to allow; the rule is tested on
    // its own. What is tested HERE is that the server does not trust `status` alone.
    await db.doc('group_invites/i1').update({ status: reopened });
    const r = await accept(DAVE, 'i1');
    expect(await members()).toEqual([ALICE, BOB]);
    expect(await friendsOf(BOB)).toEqual([]);
    expect(r.status).toBe('accepted');
  });

  it('an invitation written with no status at all is not pending', async () => {
    await db.doc('group_invites/i1').update({ status: admin.firestore.FieldValue.delete() });
    const r = await accept(DAVE, 'i1');
    expect(r.status).toBe('invalid');
    expect(await members()).toEqual([ALICE, BOB]);
  });
});
