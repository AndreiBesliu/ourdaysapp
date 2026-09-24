// rules-tests/admins.test.ts
//
// Each person may read their OWN admin record, and nothing else. It replaces a hard-coded email
// deciding who saw the Admin entry (audit C, 24.09.2026). It tells them only what the server's
// `assertAdmin` already acts on.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { ALICE, BOB, as, anon, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(() => startEnv('demo-admins'));
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'admins', ALICE), { email: 'alice@example.test', addedBy: 'bootstrap' });
  });
});

describe('an admin record', () => {
  it('can be read by the person it is about', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'admins', ALICE)));
    // Including when there is none: "am I an admin?" has to be answerable with "no".
    await assertSucceeds(getDoc(doc(as(BOB), 'admins', BOB)));
  });

  it('by nobody else, and never listed', async () => {
    await assertFails(getDoc(doc(as(BOB), 'admins', ALICE)));
    await assertFails(getDocs(collection(as(ALICE), 'admins')));
    await assertFails(getDoc(doc(anon(), 'admins', ALICE)));
  });

  it('and never written from a browser — not even your own', async () => {
    await assertFails(setDoc(doc(as(BOB), 'admins', BOB), { addedBy: 'me' }));
    await assertFails(setDoc(doc(as(ALICE), 'admins', ALICE), { addedBy: 'me' }, { merge: true }));
    await assertFails(deleteDoc(doc(as(ALICE), 'admins', ALICE)));
  });
});
