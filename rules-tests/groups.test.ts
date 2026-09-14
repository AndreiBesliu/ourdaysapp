// rules-tests/groups.test.ts
// Group membership, and the chat inside it.
//
// The update rule here used to be `update, delete: if uid in members`, which let ANY member eject
// any other member — the owner included — and delete the whole group with its events. The screen
// had always intended owner-only; the rule simply was not enforcing what the buttons promised.
//
// What replaced it has three branches, and the third is easy to get wrong: a member may edit the
// group, may NOT change who is in it, EXCEPT to remove themselves, which is leaving. Those are
// exactly the cases below.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, CAROL, DAVE, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-groups'); });
afterAll(stopEnv);
beforeEach(resetWorld);

describe('reading a group', () => {
  it('members read it, outsiders do not', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', G1)));
    await assertFails(getDoc(doc(as(DAVE), 'groups', G1)));
  });
});

describe('creating a group', () => {
  it('you must own it and be in it', async () => {
    await assertSucceeds(setDoc(doc(as(DAVE), 'groups', 'g-new'), {
      name: 'Mine', ownerId: DAVE, members: [DAVE],
    }));
  });

  it('you cannot create a group you are not in', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'groups', 'g-absent'), {
      name: 'Theirs', ownerId: DAVE, members: [ALICE],
    }));
  });

  it('you cannot create one owned by somebody else', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'groups', 'g-spoof'), {
      name: 'x', ownerId: ALICE, members: [DAVE, ALICE],
    }));
  });
});

describe('updating a group — the three branches', () => {
  it('the owner may change anything, including the member list', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1), { members: [ALICE] }));
  });

  it('a plain member may edit the group while leaving membership alone', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1), { name: 'The Family' }));
  });

  it('a plain member may NOT eject somebody else — the defect this rule was rewritten for', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { members: [BOB] }));
  });

  it('a plain member may not add somebody either', async () => {
    // Joining goes through acceptGroupInvite on the Admin SDK, which these rules do not constrain.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { members: [ALICE, BOB, DAVE] }));
  });

  it('but a plain member MAY remove themselves, because that is leaving', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1), { members: [ALICE] }));
  });

  it('an outsider may not touch it at all', async () => {
    await assertFails(updateDoc(doc(as(DAVE), 'groups', G1), { name: 'x' }));
  });
});

describe('deleting a group', () => {
  it('only the owner', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'groups', G1)));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'groups', G1)));
  });

  it('a group with no ownerId cannot be deleted by anyone — the safe direction to fail', async () => {
    // Groups created before `ownerId` existed. Members can still edit and still leave; nobody can
    // destroy it from the UI. That is deliberate, not an oversight.
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', 'g-legacy'), { name: 'Old', members: [ALICE, BOB] });
    });
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', 'g-legacy')));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', 'g-legacy'), { name: 'Old, renamed' }));
  });
});

describe('chat messages inside a group', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm1'), {
        senderId: ALICE, text: 'hello', seenBy: [ALICE], reactions: {}, isPinned: false,
      });
    });
  });

  it('members read them, outsiders do not', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1')));
    await assertFails(getDoc(doc(as(CAROL), 'groups', G1, 'messages', 'm1')));
  });

  it('a member may post as themselves', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'groups', G1, 'messages', 'm2'), {
      senderId: BOB, text: 'hi',
    }));
  });

  it('a member may NOT post as somebody else', async () => {
    await assertFails(setDoc(doc(as(BOB), 'groups', G1, 'messages', 'm3'), {
      senderId: ALICE, text: 'a thing Alice never said',
    }));
  });

  it('an outsider may not post at all', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'groups', G1, 'messages', 'm4'), {
      senderId: DAVE, text: 'x',
    }));
  });

  it('a member may mark somebody else’s message seen, react, or pin it', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      seenBy: [ALICE, BOB],
    }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      isPinned: true,
    }));
  });

  it('but may not rewrite what somebody else said', async () => {
    // The `hasOnly` list is the whole protection: without it, "any member may update" would mean
    // any member may put words in anyone's mouth.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      text: 'something else entirely',
    }));
  });

  it('editing your own message is fine', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1'), {
      text: 'hello (edited)',
    }));
  });

  it('nobody deletes a message — soft-delete only', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1')));
  });
});
