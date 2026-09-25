// functions/test/accountDeletion.test.ts
//
// Deleting an account (adminModerateUser, action "delete") removes that person's error rows too.
// Each carries their uid and, for client reports, their email and user agent. Until 25.09.2026 the
// cascade removed events, assets, expenses, notifications and more, but not these — they stayed
// until the 90-day expiry. Through the real handler, on the Firestore, Auth and Storage emulators.

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

let moderate: { run: (req: CallableRequest<unknown>) => Promise<any> };
let db: admin.firestore.Firestore;

const ADMIN = 'uid-admin';
const GONE = 'uid-leaving';
const OTHER = 'uid-staying';

const rowsOf = async (uid: string) => (await db.collection('errorLogs').where('uid', '==', uid).get()).size;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  moderate = ((await import('../src/index')) as any).adminModerateUser;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await admin.auth().createUser({ uid: GONE, email: 'leaving@example.test' });
  await db.doc(`admins/${ADMIN}`).set({ addedBy: 'test' });
  for (let i = 0; i < 3; i++) await db.collection('errorLogs').add({ uid: GONE, email: 'leaving@example.test', message: `m${i}`, source: 'client' });
  await db.collection('errorLogs').add({ uid: OTHER, message: 'theirs', source: 'client' });
  await db.collection('errorLogs').add({ uid: null, message: 'server, nobody\'s', source: 'server' });
});

describe('deleting an account', () => {
  it('takes that person\'s error rows with it, and nobody else\'s', async () => {
    expect(await rowsOf(GONE)).toBe(3);
    const r = await moderate.run({
      data: { uid: GONE, action: 'delete' }, auth: { uid: ADMIN, token: { uid: ADMIN } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>);
    expect(r).toMatchObject({ ok: true, deleted: true, counts: { errorLogs: 3 } });
    expect(await rowsOf(GONE)).toBe(0);
    expect(await rowsOf(OTHER)).toBe(1);
    expect((await db.collection('errorLogs').get()).size).toBe(2);
  });
});
