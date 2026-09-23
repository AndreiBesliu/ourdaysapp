// rules-tests/chats.test.ts
// One-to-one conversations.
//
// The interesting property is what a client CANNOT do. A direct chat exists only because a server
// answered "are these two friends, or in a group together" — a question Firestore rules cannot
// ask, since `isMemberOfGroup` needs a known group id and friendship is an array of objects on a
// document only its owner may read. So creation is denied outright here, and the tests below are
// mostly about that denial holding from every angle.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ALICE, BOB, CAROL, DAVE, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

/** The id `openDirectChat` derives: sorted and joined, so both people compute the same one. */
const AB = [ALICE, BOB].sort().join('__');

beforeAll(async () => { await startEnv('demo-ourdays-chats'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'chats', AB), {
      members: [ALICE, BOB].sort(), createdBy: ALICE,
      lastMessageText: 'hello', lastMessageBy: ALICE,
    });
    await setDoc(doc(db, 'chats', AB, 'messages', 'm1'), {
      senderId: ALICE, text: 'hello', seenBy: [ALICE], reactions: {}, isPinned: false,
    });
  });
});

describe('who can see a conversation', () => {
  it('both people can', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'chats', AB)));
    await assertSucceeds(getDoc(doc(as(BOB), 'chats', AB)));
  });

  it('nobody else can, not even from the same group', async () => {
    // Carol is in a different group; Dave is in none. Neither matters — a conversation is not a
    // group and sharing one grants nothing here.
    await assertFails(getDoc(doc(as(CAROL), 'chats', AB)));
    await assertFails(getDoc(doc(as(DAVE), 'chats', AB)));
    await assertFails(getDoc(doc(anon(), 'chats', AB)));
  });

  it('my own list is served; a sweep of everybody’s is not', async () => {
    await assertSucceeds(getDocs(query(collection(as(ALICE), 'chats'), where('members', 'array-contains', ALICE))));
    await assertFails(getDocs(collection(as(ALICE), 'chats')));
  });

  it('and I cannot ask for somebody else’s list', async () => {
    await assertFails(getDocs(query(collection(as(DAVE), 'chats'), where('members', 'array-contains', ALICE))));
  });

  it('the list really returns the conversation, not an empty page', async () => {
    const snap = await getDocs(query(collection(as(BOB), 'chats'), where('members', 'array-contains', BOB)));
    expect(snap.docs.map((d) => d.id)).toEqual([AB]);
  });
});

describe('a client cannot conjure a conversation', () => {
  it('the author of a message cannot be rewritten', async () => {
    // "Sender pinned to the caller" was on CREATE only, so it bought nothing: send a message,
    // then edit it and set `senderId` to somebody else. The read rule shows the whole
    // conversation, so what everyone sees is a message another person appears to have written.
    // In a direct chat there are only two people, so the forgery is unambiguous.
    // The fixture in beforeEach already has the chat and `m1` from ALICE.
    await assertFails(updateDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1'), { senderId: BOB }));
    // Not even alongside a legitimate edit, which is the shape somebody would actually send.
    await assertFails(updateDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1'), {
      text: 'I owe you nothing', senderId: BOB,
    }));
    // Editing your own text is untouched.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1'), { text: 'hi' }));
    // And so is the reaction path, which the other person needs.
    await assertSucceeds(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1'), {
      reactions: { up: [BOB] },
    }));
  });

  it('not with somebody who never agreed to it', async () => {
    // The whole reason `openDirectChat` exists. Without this denial, anybody could open a channel
    // to any uid they could guess — and uids are enumerable in this app.
    await assertFails(setDoc(doc(as(DAVE), 'chats', [DAVE, ALICE].sort().join('__')), {
      members: [DAVE, ALICE].sort(), createdBy: DAVE,
    }));
  });

  it('not even between two people who ARE in a group together', async () => {
    // Alice and Bob share G1, so this one would be permitted by the callable. It is still refused
    // here: the rule does not try to judge, it refuses everything and lets the server judge.
    await assertFails(setDoc(doc(as(ALICE), 'chats', 'brand-new'), {
      members: [ALICE, BOB].sort(), createdBy: ALICE,
    }));
  });

  it('and cannot add themselves to one that exists', async () => {
    await assertFails(updateDoc(doc(as(DAVE), 'chats', AB), { members: [ALICE, BOB, DAVE] }));
  });

  it('nor rewrite the preview somebody else sees in their list', async () => {
    // `lastMessageText` is drawn in the other person's conversation list. A writable one is a way
    // to put words into it that were never said.
    await assertFails(updateDoc(doc(as(BOB), 'chats', AB), { lastMessageText: 'something I never sent' }));
    await assertFails(updateDoc(doc(as(ALICE), 'chats', AB), { lastMessageText: 'nor this' }));
  });

  it('nor delete the conversation', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'chats', AB)));
  });
});

describe('messages inside it', () => {
  it('both people read them', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1')));
  });

  it('an outsider reads nothing, and cannot post', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'chats', AB, 'messages', 'm1')));
    await assertFails(setDoc(doc(as(CAROL), 'chats', AB, 'messages', 'm2'), {
      senderId: CAROL, text: 'let me in',
    }));
  });

  it('a member posts as themselves', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'chats', AB, 'messages', 'm2'), {
      senderId: BOB, text: 'hi',
    }));
  });

  it('but not as the other person', async () => {
    await assertFails(setDoc(doc(as(BOB), 'chats', AB, 'messages', 'm3'), {
      senderId: ALICE, text: 'a thing Alice never said',
    }));
  });

  it('a member may mark seen, react and pin somebody else’s message', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1'), { seenBy: [ALICE, BOB] }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1'), { isPinned: true }));
  });

  it('but may not rewrite what they said', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1'), { text: 'something else' }));
  });

  it('the author may edit their own', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1'), { text: 'hello (edited)' }));
  });

  it('nobody deletes a message — soft-delete only, as in a group', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1')));
  });

  it('a message in a conversation that does not exist is refused', async () => {
    // `inChat()` checks existence before membership. Without it, the `get` on a missing document
    // returns null and `uid in null.data.members` would be an evaluation error rather than a
    // clean denial — and an erroring rule is one nobody can reason about.
    await assertFails(setDoc(doc(as(ALICE), 'chats', 'no-such-chat', 'messages', 'm1'), {
      senderId: ALICE, text: 'hello?',
    }));
  });

  // ── Read receipts, as in a group ───────────────────────────────────────────────────────
  //
  // It reads worse here: a direct chat has two people in it, so a forged receipt is
  // unambiguously a claim about the one other person.

  it('neither person may mark the message seen for the other', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm1'), {
      seenBy: [ALICE, BOB, CAROL],
    }));
    await assertFails(updateDoc(doc(as(ALICE), 'chats', AB, 'messages', 'm1'), {
      seenBy: [ALICE, BOB],
    }));
  });

  it('and nobody may take a receipt back', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'chats', AB, 'messages', 'm9'), {
        senderId: ALICE, text: 'read', seenBy: [ALICE, BOB], reactions: {}, isPinned: false,
      });
    });
    await assertFails(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm9'), { seenBy: [ALICE] }));
  });

  it('marking yourself still works on a message with no seenBy at all', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'chats', AB, 'messages', 'm10'), { senderId: ALICE, text: 'old' });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'chats', AB, 'messages', 'm10'), { seenBy: [BOB] }));
  });

});

describe('typing indicators', () => {
  it('a member may say THEY are typing', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'chats', AB, 'typing', BOB), { at: Date.now() }));
  });

  it('but not that somebody else is', async () => {
    await assertFails(setDoc(doc(as(BOB), 'chats', AB, 'typing', ALICE), { at: Date.now() }));
  });

  it('an outsider may not read them', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'chats', AB, 'typing', BOB)));
  });
});
