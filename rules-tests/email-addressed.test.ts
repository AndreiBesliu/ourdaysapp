// rules-tests/email-addressed.test.ts
//
// An invitation can be addressed two ways, and only one of them is a fact.
//
// A uid cannot be spoofed. An EMAIL address is a claim until somebody checks it — and until
// 20.09.2026 nobody checked it on the way IN.
//
// ── The four months in between ────────────────────────────────────────────────────────────
//
// On 26.05 the ACCEPT path was gated on `email_verified`: `acceptGroupInvite` and
// `respondToFriendRequest` stopped honouring an email match from an unverified account. That
// closed the account takeover, and the residue was logged as LOW and deferred, with the reason
// written down: gating the READ would make the client's `where('toEmail','==',…)` listeners fail
// for unverified users, so the listeners had to learn to skip first.
//
// The residue was that somebody who registers an address they do not own could still SEE every
// pending invitation and friend request addressed to it: who invited them, at which address, to
// which group, under which display name. Not a takeover. Still a disclosure, to precisely the
// person who should not have it.
//
// ── The defect pointing the other way, found while fixing this one ────────────────────────
//
// The branch compared `request.auth.token.email` to the stored `toEmail`. The client writes
// `toEmail.toLowerCase()`; the token carries the address as REGISTERED. For anybody whose local
// part contains a capital letter the two were never equal — and a LIST query is validated against
// the rule without reading a single document, so what they lost was not one hidden row but the
// whole listener. Both sides are lowered now, and `the mixed-case recipient` below is the probe.
//
// ── Why this file exists at all ───────────────────────────────────────────────────────────
//
// `_harness.ts` hands every identity `email_verified: true`, which is the right default and is
// also exactly why no existing test could see the hole. A suite that can only express the safe
// identity proves a restriction that is not there.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  ALICE, BOB, CAROL, DAVE, EMAIL, G1,
  as, asUnverified, asEmail, asNoEmail, resetWorld, seed, startEnv, stopEnv,
} from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-email'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    // Alice (in G1) invites Dave, who is in no group, by email.
    await setDoc(doc(db, 'group_invites', 'i-to-dave'), {
      fromId: ALICE, toEmail: EMAIL[DAVE], groupId: G1, status: 'pending',
    });
    // A uid-addressed invite. `GroupSettingsModal` writes `toEmail: null` on this shape, which is
    // the value that made an unguarded `token.email == toEmail` read TRUE for an account with no
    // email claim at all.
    await setDoc(doc(db, 'group_invites', 'i-by-uid'), {
      fromId: ALICE, toId: DAVE, toEmail: null, groupId: G1, status: 'pending',
    });
    // A personal invite from somebody who shares no group with the recipient: the only fixture
    // in which the `fromId` branch is the ONLY thing that can grant access.
    await setDoc(doc(db, 'group_invites', 'i-from-carol'), {
      fromId: CAROL, toEmail: EMAIL[DAVE], groupId: null, status: 'pending',
    });
    await setDoc(doc(db, 'friend_requests', 'fr-email'), {
      fromId: ALICE, fromName: 'Alice', toId: null, toEmail: EMAIL[CAROL], status: 'pending',
    });
    await setDoc(doc(db, 'friend_requests', 'fr-uid'), {
      fromId: ALICE, fromName: 'Alice', toId: CAROL, toEmail: null, status: 'pending',
    });
  });
});

describe('a group invitation addressed to an email', () => {
  it('the verified recipient reads it', async () => {
    // The case that must keep working. Without it the rest of this file would be proving that a
    // feature is broken rather than that a hole is closed.
    await assertSucceeds(getDoc(doc(as(DAVE), 'group_invites', 'i-to-dave')));
  });

  it('the UNVERIFIED recipient cannot', async () => {
    // THE fix. Registering an address is not owning it.
    await assertFails(getDoc(doc(asUnverified(DAVE), 'group_invites', 'i-to-dave')));
  });

  it('and neither can their listener, which is how the app would ask', async () => {
    // The app never reads one invitation by id; it subscribes to a query. A LIST is validated
    // against the rule without reading documents, so this is the shape that actually matters.
    const q = query(
      collection(asUnverified(DAVE), 'group_invites'),
      where('toEmail', '==', EMAIL[DAVE]),
      where('status', '==', 'pending'),
    );
    await assertFails(getDocs(q));
  });

  it('the verified recipient’s listener still works', async () => {
    const q = query(
      collection(as(DAVE), 'group_invites'),
      where('toEmail', '==', EMAIL[DAVE]),
      where('status', '==', 'pending'),
    );
    await assertSucceeds(getDocs(q));
  });

  it('a capital letter in the address no longer excludes the recipient', async () => {
    // The defect pointing the other way. `Dave@Example.test` is the same address as the stored
    // `dave@example.test`, and before this it read NOTHING — not one row, the whole listener.
    const mixed = EMAIL[DAVE].replace('d', 'D').replace('example', 'Example');
    await assertSucceeds(getDoc(doc(asEmail(DAVE, mixed), 'group_invites', 'i-to-dave')));
  });

  it('the sender still reads it, verified or not', async () => {
    // The `fromId` branch is about a uid and must not have been caught by the change.
    await assertSucceeds(getDoc(doc(asUnverified(ALICE), 'group_invites', 'i-to-dave')));
  });

  it('a member of the target group still reads it', async () => {
    // Group-scoped cleanup on delete/leave depends on this branch.
    await assertSucceeds(getDoc(doc(asUnverified(BOB), 'group_invites', 'i-to-dave')));
  });

  it('a stranger still cannot', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'group_invites', 'i-to-dave')));
  });

  it('an account with no email claim cannot read a uid-addressed invite', async () => {
    // `null == null` was TRUE, and uid-addressed invites store `toEmail: null`. Carol is in no
    // group with Alice and is not the sender, so every other branch is already false: the only
    // thing that could let this through is the comparison this guard exists for.
    await assertFails(getDoc(doc(asNoEmail(CAROL), 'group_invites', 'i-by-uid')));
  });

  it('an account with no email claim can still read an invite it SENT', async () => {
    // A regression guard, and NOT proof of the null guard above it — which is what the comment
    // here claimed until the emulator was asked. I expected `null.lower()` in the first branch of
    // the `||` to raise and deny before the sender branch was reached; it does not. An error in
    // one branch does not poison the expression, so removing that guard changes nothing and this
    // test passes either way. What it does hold is the outcome: an odd identity still reads what
    // it sent.
    await assertSucceeds(getDoc(doc(asNoEmail(ALICE), 'group_invites', 'i-to-dave')));
  });

  it('the sender reads a UID-addressed invite they sent', async () => {
    // Same correction as above: `toEmail: null` makes the first branch compute `null.lower()`,
    // which raises, and the raise turns out not to matter. Kept as the outcome guard for the
    // commonest shape in the collection.
    await assertSucceeds(getDoc(doc(as(ALICE), 'group_invites', 'i-by-uid')));
  });

  it('a sender who is in NO group with anybody still reads what they sent', async () => {
    // Isolating the `fromId` branch, which nothing did until a mutation walked straight past the
    // suite. Every other sender in this file is also a member of the target group, so the
    // membership branch was answering for them and `fromId` could have been anything at all.
    // Carol is in G2, the invite is personal (no group), and she is not the recipient.
    await assertSucceeds(getDoc(doc(as(CAROL), 'group_invites', 'i-from-carol')));
  });

  it('an unverified recipient cannot decline it either', async () => {
    // `canAccessInvite` gates update and delete as well as read. That pairing is deliberate: an
    // invitation you may not see is not one you may answer.
    await assertFails(updateDoc(doc(asUnverified(DAVE), 'group_invites', 'i-to-dave'), { status: 'declined' }));
  });

  it('a verified recipient still can', async () => {
    await assertSucceeds(updateDoc(doc(as(DAVE), 'group_invites', 'i-to-dave'), { status: 'declined' }));
  });
});

describe('a friend request addressed to an email', () => {
  it('the verified recipient reads it', async () => {
    await assertSucceeds(getDoc(doc(as(CAROL), 'friend_requests', 'fr-email')));
  });

  it('the UNVERIFIED recipient cannot', async () => {
    // Discloses the sender's name and address to somebody who typed the recipient's.
    await assertFails(getDoc(doc(asUnverified(CAROL), 'friend_requests', 'fr-email')));
  });

  it('nor can their listener', async () => {
    const q = query(
      collection(asUnverified(CAROL), 'friend_requests'),
      where('toEmail', '==', EMAIL[CAROL]),
      where('status', '==', 'pending'),
    );
    await assertFails(getDocs(q));
  });

  it('a uid-addressed request is untouched by any of this', async () => {
    // The whole point of the split: a uid cannot be spoofed, so nothing about it needs proving.
    // This is what an unverified user keeps, and why the app still works for them.
    await assertSucceeds(getDoc(doc(asUnverified(CAROL), 'friend_requests', 'fr-uid')));
    const q = query(
      collection(asUnverified(CAROL), 'friend_requests'),
      where('toId', '==', CAROL),
      where('status', '==', 'pending'),
    );
    await assertSucceeds(getDocs(q));
  });

  it('the sender still reads their own, verified or not', async () => {
    await assertSucceeds(getDoc(doc(asUnverified(ALICE), 'friend_requests', 'fr-email')));
  });
});
