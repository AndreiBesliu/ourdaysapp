// rules-tests/personal.test.ts
//
// The collections that hold a PERSON — and the ones that hold power.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────
//
// Measured on 19.09: `firestore.rules` governs 28 collections and the rules tests named 11 of
// them. Among the seventeen nobody had ever probed were `users` (email, fcm tokens, preferences),
// `profiles` (the public mirror everybody can read), `notifications`, `friend_requests` (names and
// e-mail addresses), and `admins` — the list that decides who is an admin.
//
// A rule that is wrong on a collection nobody probes is a rule nobody finds until it leaks. These
// are asserted the same way as the wallet's: every capability as a PAIR, someone who may and
// someone who may not, because a suite of only-allowed assertions passes just as happily against a
// rule that allows everything.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { ALICE, BOB, CAROL, EMAIL, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-personal'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', ALICE), {
      name: 'Alice', email: EMAIL[ALICE], fcmTokens: ['token-a'], walletCategories: ['Vehicles'],
    });
    await setDoc(doc(db, 'users', BOB), { name: 'Bob', email: EMAIL[BOB], fcmTokens: ['token-b'] });
    await setDoc(doc(db, 'profiles', ALICE), { name: 'Alice', photoURL: null, birthday: '1990-04-01' });
    await setDoc(doc(db, 'profiles', BOB), { name: 'Bob', photoURL: null, birthday: null });

    await setDoc(doc(db, 'notifications', 'n-alice'), {
      userId: ALICE, title: 'A reminder', body: 'Milk', read: false,
    });
    await setDoc(doc(db, 'notifications', 'n-bob'), { userId: BOB, title: 'Hello', body: 'Hi', read: false });

    await setDoc(doc(db, 'admins', ALICE), { email: EMAIL[ALICE] });
    await setDoc(doc(db, 'errorLogs', 'e1'), { message: 'boom', uid: ALICE });

    await setDoc(doc(db, 'friend_requests', 'fr-uid'), {
      fromId: ALICE, fromName: 'Alice', toId: BOB, toEmail: null, status: 'pending',
    });
    await setDoc(doc(db, 'friend_requests', 'fr-email'), {
      fromId: ALICE, fromName: 'Alice', toId: null, toEmail: EMAIL[CAROL], status: 'pending',
    });
  });
});

describe('the user document, which holds the sensitive half', () => {
  it('the owner reads their own', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'users', ALICE)));
  });

  it('nobody else does — this doc holds the e-mail and the push tokens', async () => {
    await assertFails(getDoc(doc(as(BOB), 'users', ALICE)));
  });

  it('and a signed-out reader certainly does not', async () => {
    await assertFails(getDoc(doc(anon(), 'users', ALICE)));
  });

  it('the owner writes their own', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users', ALICE), { walletCategories: ['Financial'] }));
  });

  it('nobody else writes it — a push token is a place to send things', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'users', ALICE), { fcmTokens: ['token-of-bobs'] }));
  });

  it('the whole collection cannot be listed by anybody', async () => {
    // A list is validated WITHOUT reading documents, so an unconstrained one is refused whole.
    await assertFails(getDocs(collection(as(ALICE), 'users')));
  });
});

describe('the public profile mirror', () => {
  it('any signed-in person may read anybody’s profile', async () => {
    // This is the whole point of the mirror: names, avatars and birthdays render for group
    // members without anybody reading the sensitive document beside it.
    await assertSucceeds(getDoc(doc(as(BOB), 'profiles', ALICE)));
  });

  it('but a signed-out reader may not', async () => {
    await assertFails(getDoc(doc(anon(), 'profiles', ALICE)));
  });

  it('the roster IS enumerable by any signed-in account — recorded, not accidental', async () => {
    // Worth knowing rather than discovering: anybody signed in can list every profile in the app.
    // That is the price of a public mirror, and the reason the mirror must stay non-sensitive.
    await assertSucceeds(getDocs(collection(as(BOB), 'profiles')));
  });

  it('extra fields are refused, whatever they are', async () => {
    // `allow write: if isOwner(userId)` had no whitelist, on a document EVERY signed-in account
    // reads and five screens bulk-fetch. The same collection's neighbour `warlordPlayers` has had
    // a shape check for weeks, for the reason written there.
    await assertFails(setDoc(doc(as(ALICE), 'profiles', ALICE), {
      name: 'Alice', beacon: 'https://attacker.example/x.png',
    }, { merge: true }));
  });

  it('and a name long enough to be a message is refused', async () => {
    // This string is handed to `createWarlordChallenge` as the body of a PUSH NOTIFICATION that
    // may be sent to any uid with no relationship at all.
    await assertFails(setDoc(doc(as(ALICE), 'profiles', ALICE), {
      name: 'x'.repeat(200),
    }, { merge: true }));
    await assertFails(setDoc(doc(as(ALICE), 'profiles', ALICE), {
      photoURL: 'https://e.test/' + 'y'.repeat(600),
    }, { merge: true }));
  });

  it('but the three real writes still work, one field at a time', async () => {
    // Exactly what Login.tsx and Settings.tsx send, with { merge: true }.
    await assertSucceeds(setDoc(doc(as(ALICE), 'profiles', ALICE), { name: 'Alice B' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as(ALICE), 'profiles', ALICE), { photoURL: 'https://e.test/a.png' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as(ALICE), 'profiles', ALICE), { birthday: '1990-04-01' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as(ALICE), 'profiles', ALICE), { birthday: null }, { merge: true }));
  });

  it('and nobody else may write mine', async () => {
    await assertFails(setDoc(doc(as(BOB), 'profiles', ALICE), { name: 'not Alice' }, { merge: true }));
  });

  it('only the owner writes their own profile', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'profiles', ALICE), { name: 'Alice A.' }));
    await assertFails(updateDoc(doc(as(BOB), 'profiles', ALICE), { name: 'Not Alice' }));
  });
});

describe('notifications: the recipient owns them, and nobody creates them from a browser', () => {
  it('the recipient reads their own', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'notifications', 'n-alice')));
  });

  it('somebody else does not', async () => {
    await assertFails(getDoc(doc(as(BOB), 'notifications', 'n-alice')));
  });

  it('a client cannot create one, not even for itself', async () => {
    // The whole reason: `notifyUsers` (Admin SDK) restricts you to people you share a group with
    // and rate-limits per sender. A browser that could write this collection could spam anybody.
    await assertFails(addDoc(collection(as(ALICE), 'notifications'), {
      userId: ALICE, title: 'Mine', body: 'x', read: false,
    }));
  });

  it('the recipient marks their own as read, and deletes it', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'notifications', 'n-alice'), { read: true }));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'notifications', 'n-alice')));
  });

  it('somebody else neither updates nor deletes it', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'notifications', 'n-alice'), { read: true }));
    await assertFails(deleteDoc(doc(as(BOB), 'notifications', 'n-alice')));
  });

  it('and cannot be re-pointed at another person’s inbox', async () => {
    // The `assets` rule already carries a comment about this exact shape: a rule that checks only
    // the document as it STANDS lets the owner rewrite the field that decides ownership. Creation
    // is closed here, so the way in would be to take a notification you legitimately own, rewrite
    // its title and body, and hand it to somebody else's list.
    await assertFails(updateDoc(doc(as(ALICE), 'notifications', 'n-alice'), {
      userId: BOB, title: 'Your account needs attention', body: 'Follow this link',
    }));
  });

  it('nor rewritten in place, even while it stays in my own list', async () => {
    // Half of the same trick: the payload. Marking as read is the only thing a browser does
    // to this collection, so that is the only thing the rule permits.
    await assertFails(updateDoc(doc(as(ALICE), 'notifications', 'n-alice'), {
      title: 'Your account needs attention', body: 'Follow this link',
    }));
  });
});

describe('the collections no client may touch at all', () => {
  it('the admin list is invisible and unwritable', async () => {
    // Being able to add yourself here is being able to make yourself an admin.
    await assertFails(setDoc(doc(as(BOB), 'admins', BOB), { email: EMAIL[BOB] }));
    // Invisible to everybody else. Since 24.09.2026 each person may read their OWN record — it
    // replaced a hard-coded email deciding who saw the Admin entry, and tells them only what the
    // server already acts on. That read is pinned in admins.test.ts; this line used to assert the
    // opposite, and was changed deliberately, not loosened by accident.
    await assertFails(getDoc(doc(as(BOB), 'admins', ALICE)));
  });

  it('the error log is invisible and unwritable', async () => {
    // It carries whatever a thrown error carried, which is why nothing reads it from a browser.
    await assertFails(getDoc(doc(as(ALICE), 'errorLogs', 'e1')));
    await assertFails(setDoc(doc(as(ALICE), 'errorLogs', 'e2'), { message: 'mine' }));
  });

  it('`if false` really refuses — there is no catch-all above it', async () => {
    // An `allow: if false` under a matching `match /{document=**}` is decoration, and this project
    // has shipped a shadowed rule before. The only `{sub=**}` in the file is nested and also false.
    await assertFails(getDocs(collection(as(ALICE), 'admins')));
    await assertFails(getDocs(collection(as(ALICE), 'errorLogs')));
  });
});

describe('friend requests', () => {
  it('a sender may send one, naming themselves honestly', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'friend_requests'), {
      fromId: BOB, fromName: 'Bob', toId: CAROL, toEmail: null, status: 'pending',
    }));
  });

  it('but not in somebody else’s name', async () => {
    await assertFails(addDoc(collection(as(BOB), 'friend_requests'), {
      fromId: ALICE, fromName: 'Alice', toId: CAROL, toEmail: null, status: 'pending',
    }));
  });

  it('and not one that arrives already accepted', async () => {
    // Otherwise the friendship is made by the asker rather than by the answerer.
    await assertFails(addDoc(collection(as(BOB), 'friend_requests'), {
      fromId: BOB, fromName: 'Bob', toId: CAROL, toEmail: null, status: 'accepted',
    }));
  });

  it('sender and recipient read it; a bystander does not', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'friend_requests', 'fr-uid')));
    await assertSucceeds(getDoc(doc(as(BOB), 'friend_requests', 'fr-uid')));
    await assertFails(getDoc(doc(as(CAROL), 'friend_requests', 'fr-uid')));
  });

  it('a request addressed to an e-mail reaches the owner of that e-mail', async () => {
    // The invitation path for somebody whose uid the sender cannot know yet.
    await assertSucceeds(getDoc(doc(as(CAROL), 'friend_requests', 'fr-email')));
    await assertFails(getDoc(doc(as(BOB), 'friend_requests', 'fr-email')));
  });

  it('nobody answers it from a browser — that write touches BOTH friend lists', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'friend_requests', 'fr-uid'), { status: 'accepted' }));
    await assertFails(updateDoc(doc(as(ALICE), 'friend_requests', 'fr-uid'), { status: 'accepted' }));
  });

  it('the sender may cancel; the recipient may not delete it out from under them', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'friend_requests', 'fr-uid')));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'friend_requests', 'fr-uid')));
  });

  it('a query for what was sent to me is served; one for everything is not', async () => {
    const db = as(BOB);
    await assertSucceeds(getDocs(query(collection(db, 'friend_requests'), where('toId', '==', BOB))));
    await assertFails(getDocs(collection(db, 'friend_requests')));
  });
});
