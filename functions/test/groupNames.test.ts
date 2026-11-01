// functions/test/groupNames.test.ts
//
// A group's name, wherever the server reads it, goes through `stampedGroupName` (01.11.2026): text
// only, trimmed, cut. The rule has refused a name that is not text since 08.10.2026, and live holds
// none; these are for what reaches a group another way (the console, or a client while an older rule
// was the published one). Admin used to show such a name as "[object Object]" and an invite link to
// carry it. On the emulators, through the real callables.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Fn = { run: (req: CallableRequest<unknown>) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const ADMIN = 'uid-admin';
const ALICE = 'uid-alice';

function call(name: string, uid: string, data: Record<string, unknown> = {}) {
  return fn[name].run({
    data, auth: { uid, token: { uid, email: `${uid}@example.test`, email_verified: true } }, rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running (scripts/test-rules.mjs starts it)').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await admin.auth().createUser({ uid: ALICE, email: `${ALICE}@example.test`, emailVerified: true });
  await db.doc(`admins/${ADMIN}`).set({ email: `${ADMIN}@example.test` });
  await db.doc(`profiles/${ALICE}`).set({ name: 'Alice' });
  await db.doc('groups/g-text').set({ ownerId: ALICE, members: [ALICE], name: '  Family  ' });
  await db.doc('groups/g-map').set({ ownerId: ALICE, members: [ALICE], name: { evil: 1 } });
  await db.doc('groups/g-blank').set({ ownerId: ALICE, members: [ALICE], name: '   ' });
});

const byId = (groups: Array<{ id: string; name: unknown }>) => Object.fromEntries(groups.map((g) => [g.id, g.name]));

describe('a group’s name, as the server reads it', () => {
  it('Admin’s list of groups: text trimmed, anything else "Group"', async () => {
    const { groups } = await call('adminListGroups', ADMIN);
    expect(byId(groups)).toEqual({ 'g-text': 'Family', 'g-map': 'Group', 'g-blank': 'Group' });
  });

  it('Admin’s view of one person: the same', async () => {
    const r = await call('adminGetUser', ADMIN, { uid: ALICE });
    expect(byId(r.groups)).toEqual({ 'g-text': 'Family', 'g-map': 'Group', 'g-blank': 'Group' });
  });

  it('an invite link carries the name as text, or none', async () => {
    const names: Record<string, unknown> = {};
    for (const groupId of ['g-text', 'g-map', 'g-blank']) {
      const { code } = await call('createGroupInviteLink', ALICE, { groupId });
      names[groupId] = (await db.doc(`invite_links/${code}`).get()).data()?.groupName;
    }
    expect(names).toEqual({ 'g-text': 'Family', 'g-map': null, 'g-blank': null });
  });
});
