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

  it('a plain member may NOT make themselves the owner', async () => {
    // THE hole, and it made owner-only delete a formality. `members` is untouched, so the "does
    // not touch who is in it" branch is satisfied; only the pin on `ownerId` refuses this.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { ownerId: BOB }));
  });

  it('and cannot smuggle it in beside a legitimate edit', async () => {
    // The shape somebody would actually use: rename the group AND take it.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { name: 'Ours now', ownerId: BOB }));
  });

  it('not even the owner hands it to somebody else through this path', async () => {
    // There is no transfer feature. If one is ever built it goes through a Cloud Function, where
    // the other side can be told; a silent rewrite of one field is not a transfer.
    await assertFails(updateDoc(doc(as(ALICE), 'groups', G1), { ownerId: BOB }));
  });

  it('a legacy group with no ownerId can still be edited', async () => {
    // The pin compares `.get('ownerId', null)` on both sides rather than reading the field,
    // because reading a missing one RAISES — which would have refused every edit to these groups
    // in the name of protecting them.
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', 'g-legacy'), { name: 'Old', members: [ALICE, BOB] });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', 'g-legacy'), { name: 'Old renamed' }));
    // …and still cannot be claimed.
    await assertFails(updateDoc(doc(as(BOB), 'groups', 'g-legacy'), { ownerId: BOB }));
  });

  it('a group of one is the only group you may create', async () => {
    // THE hole. `uid in members` is membership, not equality, so a stranger could mint a group
    // with any victim already inside — and uids are public (`warlordPlayers` is keyed by uid and
    // readable by anyone signed in). Every client lists groups by `members array-contains uid`
    // with no acceptance flag, so it appeared at once in the victim's calendar, chat and wallet,
    // with an attacker-chosen name, and made `usersShareGroup` true for three callables.
    await assertFails(setDoc(doc(as(DAVE), 'groups', 'g-forced'), {
      name: 'See message', ownerId: DAVE, members: [DAVE, ALICE],
    }));
    // Everyone at once was the same request with a longer array.
    await assertFails(setDoc(doc(as(DAVE), 'groups', 'g-forced-all'), {
      name: 'See message', ownerId: DAVE, members: [DAVE, ALICE, BOB, CAROL],
    }));
    // And the legitimate thing still works: CreateGroupModal writes exactly this.
    await assertSucceeds(setDoc(doc(as(DAVE), 'groups', 'g-mine'), {
      name: 'Mine', ownerId: DAVE, members: [DAVE],
    }));
  });

  it('nobody ADDS a member from a client, the owner included', async () => {
    // The same attack one step later: mint a group of one, then add victims to it. Joining is
    // `acceptGroupInvite` only — Admin SDK, which these rules do not constrain.
    await assertFails(updateDoc(doc(as(ALICE), 'groups', G1), { members: [ALICE, BOB, DAVE] }));
  });

  it('but the owner may still eject, and anyone may still leave', async () => {
    // The half that must not break. Removal is untouched.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1), { members: [ALICE] }));
  });

  it('the conversation preview is not a member\u2019s to write', async () => {
    // `lastMessageText` / `lastMessageBy` are written by `onMessageCreated` on the Admin SDK.
    // Left client-writable, any member could put words into every other member's group list,
    // attributed to whoever they chose. The `chats` block already says why, and concluded
    // `allow update: if false` there.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { lastMessageText: 'I quit' }));
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), { lastMessageBy: ALICE }));
    // And not smuggled beside a legitimate rename.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1), {
      name: 'Family', lastMessageText: 'I quit',
    }));
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

  it('only a member says they are typing', async () => {
    // The write rule proved only that the writer owned the document id, never that they belonged
    // here — unlike the read one line above. So a stranger could make every member's screen say
    // somebody was typing, in a group they have nothing to do with.
    await assertFails(setDoc(doc(as(DAVE), 'groups', G1, 'typing', DAVE), { at: 1 }));
    await assertSucceeds(setDoc(doc(as(BOB), 'groups', G1, 'typing', BOB), { at: 1 }));
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

  it('a member may NOT rewrite the author of a message afterwards', async () => {
    // "A member may NOT post as somebody else" was enforced on CREATE only, so it bought
    // nothing: post as yourself, then edit and set `senderId` to another member. Everyone in the
    // group reads the message, so what they see is something that person appears to have said.
    //
    // This had no test at all until a mutation that removed the pin walked past the whole suite —
    // the direct-chat twin was covered and this one was not.
    await assertFails(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1'), { senderId: BOB }));
    // Nor alongside a legitimate edit, which is the shape somebody would actually send.
    await assertFails(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1'), {
      text: 'a thing Bob never said', senderId: BOB,
    }));
  });

  it('but may still edit their own text, and others may still react', async () => {
    // The two paths that must not break.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1'), { text: 'hi' }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      reactions: { up: [BOB] },
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

  // ── A read receipt is a claim about who SAW something ──────────────────────────────────
  //
  // The update rule constrained which KEYS a non-sender may touch and said nothing about the
  // VALUES, so `seenBy` was rewritable wholesale by anybody in the group.

  it('a member may not mark a message seen on somebody else behalf', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      seenBy: [ALICE, CAROL],
    }));
  });

  it('a member may not remove anybody from seenBy', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm5'), {
        senderId: ALICE, text: 'seen by both', seenBy: [ALICE, BOB], reactions: {}, isPinned: false,
      });
    });
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm5'), { seenBy: [BOB] }));
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm5'), { seenBy: [] }));
  });

  it('not even the sender may forge a receipt on their own message', async () => {
    // The sender branch of the `||` lets them change anything but `senderId`. Whose message it
    // is does not make somebody else having read it theirs to assert.
    await assertFails(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm1'), {
      seenBy: [ALICE, BOB],
    }));
  });

  it('but a member marking THEMSELVES still works, which is the whole feature', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      seenBy: [ALICE, BOB],
    }));
  });

  it('including on a message stored before seenBy existed', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm6'), { senderId: ALICE, text: 'old' });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm6'), { seenBy: [BOB] }));
  });

  it('and a no-op re-add is not an error', async () => {
    // `arrayUnion` of a uid already present is a real write the client makes. `hasOnly` rather
    // than `==` is what lets an empty difference through.
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm7'), {
        senderId: ALICE, text: 'x', seenBy: [ALICE, BOB], reactions: {}, isPinned: false,
      });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm7'), {
      seenBy: [ALICE, BOB],
    }));
  });

  it('pinning and reacting still pass, since they leave seenBy alone', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), { isPinned: true }));
  });


  // ── The two holes the first version of this guard had ─────────────────────────────────

  it('a member cannot pad somebody else receipts with duplicates', async () => {
    // The first version compared only SETS, so a set-identical but arbitrarily LONGER array
    // passed. The chat renders `users.length`, so this put Alice name on screen 400 times.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      seenBy: [...Array(400).fill(ALICE), BOB],
    }));
    // …and he could do it without adding himself at all.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm1'), {
      seenBy: Array(400).fill(ALICE),
    }));
  });

  it('a member cannot plant a message whose seenBy is not a list', async () => {
    // `.toSet()` RAISES on a non-list, and the guard sits outside the `||`, so such a document
    // could never be updated again by anybody — and mark-as-seen is ONE atomic batch over every
    // unseen message, so one of these discarded every other receipt in it, on every open.
    await assertFails(setDoc(doc(as(BOB), 'groups', G1, 'messages', 'poison'), {
      senderId: BOB, text: 'x', seenBy: 'not-a-list',
    }));
    await assertFails(setDoc(doc(as(BOB), 'groups', G1, 'messages', 'poison2'), {
      senderId: BOB, text: 'x', seenBy: [BOB, BOB],
    }));
    await assertFails(setDoc(doc(as(BOB), 'groups', G1, 'messages', 'poison3'), {
      senderId: BOB, text: 'x', seenBy: [ALICE],
    }));
  });

  it('and a message ALREADY holding a bad value is repairable, not frozen', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm11'), {
        senderId: ALICE, text: 'was frozen', seenBy: 'not-a-list', reactions: {}, isPinned: false,
      });
    });
    // Its author can still edit and still soft-delete it: the guard asks FIRST whether seenBy
    // changed, so an untouched bad value is no longer re-judged on every unrelated write.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm11'), { text: 'edit' }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1, 'messages', 'm11'), { isDeleted: true }));
    // And it can be repaired — but only into a claim about yourself.
    await assertFails(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm11'), { seenBy: [ALICE, BOB] }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm11'), { seenBy: [BOB] }));
  });

  it('a padded list can be cleaned up, since removing duplicates does not change the set', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', G1, 'messages', 'm12'), {
        senderId: ALICE, text: 'padded', seenBy: [ALICE, ALICE, ALICE], reactions: {}, isPinned: false,
      });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1, 'messages', 'm12'), {
      seenBy: [ALICE, BOB],
    }));
  });

});
