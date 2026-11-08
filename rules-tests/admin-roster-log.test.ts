// rules-tests/admin-roster-log.test.ts
//
// The roster log (`adminRosterLog`, 07.11.2026) is written only by the admin callables, in the transaction of each change,
// and read only through `adminListAdmins` (functions/src/adminRoles.ts). No rule matches the collection, so the browser
// may do nothing with it: not read who changed the admins, and above all not write a row that was never a change, or
// rewrite one that was. An ADMIN is refused too: an admin-gated rule would pass a member test and fail this one.

import { assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { ALICE, BOB, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-rosterlog'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    // ALICE is an owner: the most the browser could claim.
    await setDoc(doc(db, 'admins', ALICE), { email: 'alice@example.com', role: 'owner' });
    await setDoc(doc(db, 'adminRosterLog', 'r1'), { schema: 1, by: ALICE, via: 'adminSetAdmin', target: BOB, from: null, to: 'admin' });
  });
});

describe('adminRosterLog is closed to the browser', () => {
  it('refuses an owner every operation', async () => {
    const db = as(ALICE);
    await assertFails(getDoc(doc(db, 'adminRosterLog', 'r1')));
    await assertFails(getDocs(collection(db, 'adminRosterLog')));
    await assertFails(setDoc(doc(db, 'adminRosterLog', 'forged'), { schema: 1, by: ALICE, target: ALICE, from: null, to: 'owner' }));
    await assertFails(updateDoc(doc(db, 'adminRosterLog', 'r1'), { to: 'owner' }));
    await assertFails(deleteDoc(doc(db, 'adminRosterLog', 'r1')));
  });

  it('refuses a member and nobody signed in', async () => {
    for (const db of [as(BOB), anon()]) {
      await assertFails(getDoc(doc(db, 'adminRosterLog', 'r1')));
      await assertFails(getDocs(collection(db, 'adminRosterLog')));
      await assertFails(setDoc(doc(db, 'adminRosterLog', 'forged'), { schema: 1 }));
    }
  });
});
