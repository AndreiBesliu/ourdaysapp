// rules-tests/server-stamp.test.ts
//
// The server stamps WHO sent a request, from Firebase Auth, and the recipient's screen shows only
// that stamp (functions/src/senderIdentity.ts). A stamp a client could write first would be the
// very forgery it replaced — "Mama <mama@…>" — so neither create may carry one.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, DAVE, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

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

// ── 08.10.2026: what the installed APK prints on an invitation ──────────────────────────────
// "<fromEmail> invited you to <groupName>", at every launch, for whoever it is addressed to. A map
// in either crashed it onto a white screen — and an invitation needs no group, so anybody signed
// in could do it to any address.
describe('an invitation\u2019s group name and sender address are text', () => {
  const POISON = { toString: 0 };
  const base = {
    fromId: BOB, fromEmail: 'bob@example.test', toId: null, toEmail: 'someone@example.test', groupId: G1,
    groupName: 'Family', status: 'pending', createdAt: '2026-10-08T09:00:00.000Z',
  };
  const send = (extra: Record<string, unknown>) => addDoc(collection(as(BOB), 'group_invites'), { ...base, ...extra });

  it('a map, a number or too long a text is refused, and so is an `id`', async () => {
    for (const extra of [
      { groupName: { a: 1 } }, { groupName: POISON }, { groupName: 5 }, { groupName: 'x'.repeat(61) },
      { fromEmail: { a: 1 } }, { fromEmail: POISON }, { fromEmail: `${'x'.repeat(248)}@x.test` }, // 255
      { id: 'another' }, { id: POISON },
    ]) {
      await assertFails(send(extra));
    }
  });

  it('a stranger in no group cannot plant one on anybody\u2019s address either', async () => {
    const stranger = { fromId: DAVE, fromEmail: 'dave@example.test', toId: null, toEmail: 'victim@example.test', groupId: null, status: 'pending' };
    await assertFails(addDoc(collection(as(DAVE), 'group_invites'), { ...stranger, groupName: { a: 1 } }));
    await assertFails(addDoc(collection(as(DAVE), 'group_invites'), { ...stranger, fromEmail: POISON }));
    // Control: the same personal invitation, with text where text belongs.
    await assertSucceeds(addDoc(collection(as(DAVE), 'group_invites'), { ...stranger, groupName: null }));
  });

  it('what both clients write passes: text, an empty name, or nothing', async () => {
    for (const extra of [{}, { groupName: null }, { groupName: '' }, { groupName: 'y'.repeat(60) }, { fromEmail: null }, { fromEmail: `${'x'.repeat(247)}@x.test` } /* 254 */]) {
      await assertSucceeds(send(extra));
    }
    const { groupName: _g, fromEmail: _f, ...bare } = base;
    await assertSucceeds(addDoc(collection(as(BOB), 'group_invites'), bare));
  });
});
