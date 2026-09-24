// rules-tests/server-stamp.test.ts
//
// The server stamps WHO sent a request, from Firebase Auth, and the recipient's screen shows only
// that stamp (functions/src/senderIdentity.ts). A stamp a client could write first would be the
// very forgery it replaced — "Mama <mama@…>" — so neither create may carry one.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(() => startEnv('demo-server-stamp'));
afterAll(stopEnv);
beforeEach(resetWorld);

const FORGED = { name: 'Mama', email: 'mama@example.test', emailVerified: true };

describe('a friend request', () => {
  const base = { fromId: BOB, toId: ALICE, status: 'pending' };

  it('may be sent', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'friend_requests'), base));
  });

  it('may not arrive already wearing a sender stamp', async () => {
    await assertFails(addDoc(collection(as(BOB), 'friend_requests'), { ...base, sender: FORGED }));
  });

  it('nor a verified group name', async () => {
    await assertFails(addDoc(collection(as(BOB), 'friend_requests'), { ...base, verifiedGroupName: 'Family' }));
  });
});

describe('a group invitation', () => {
  const base = {
    fromId: BOB, toId: null, toEmail: 'someone@example.test', groupId: G1,
    status: 'pending', createdAt: '2026-09-24T09:00:00.000Z',
  };

  it('may be sent', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'group_invites'), base));
  });

  it('may not arrive with the sender or the group name pre-stamped', async () => {
    await assertFails(addDoc(collection(as(BOB), 'group_invites'), { ...base, sender: FORGED }));
    await assertFails(addDoc(collection(as(BOB), 'group_invites'), { ...base, verifiedGroupName: 'Bank' }));
  });

  it('and the stamp cannot be added afterwards either', async () => {
    // Update allows `status` alone, so this was already closed. Pinned, because the stamp is now
    // load-bearing and a later widening of that rule would reopen it silently.
    await seed(async (db) => {
      await setDoc(doc(db, 'group_invites', 'i1'), { ...base, toId: ALICE });
    });
    await assertFails(updateDoc(doc(as(ALICE), 'group_invites', 'i1'), { sender: FORGED }));
    await assertFails(updateDoc(doc(as(BOB), 'group_invites', 'i1'), { verifiedGroupName: 'Bank' }));
  });
});
