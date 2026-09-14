// rules-tests/assets.test.ts
// The wallet's sharing rule, proved against a real rules engine instead of reasoned about.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────
//
// On 14 Sep the `assets` read rule gained a second branch — a group-shared asset is readable by
// that group's members — and it went to production UNPROVEN, because this project had no way to
// run rules at all. That was the honest state, and it was not a good one: a Firestore rule can
// COMPILE and still deny every operation, `--dry-run` is not evidence, and this app has shipped
// rules defects three separate times.
//
// The blocker was Java: the Firestore emulator needs 11+ and the machine had 8. It turned out a
// JDK 21 was already present, bundled with Android Studio for the Capacitor build — so the
// harness cost an npm package and this file, not a system install. `scripts/test-rules.mjs`
// finds it.
//
// ── How to read these tests ───────────────────────────────────────────────────────────
//
// Every capability is asserted as a PAIR: someone who may, and someone who may not. A suite of
// only-allowed assertions passes just as happily against a rule that allows everything, which is
// the failure mode worth designing against here.
//
// The query cases are the ones that matter most in practice. Firestore validates a LIST query
// against the rules WITHOUT reading documents, so a listener whose constraints do not guarantee
// the rule is rejected whole — and a rejected listener renders as an empty wallet, not an error.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { ALICE, BOB, CAROL, G1, G2, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-assets'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'assets', 'a-private'), { ownerId: ALICE, name: 'Private card' });
    await setDoc(doc(db, 'assets', 'a-shared'), { ownerId: ALICE, name: 'Shared card', sharedGroupId: G1, sharedWithFamily: true });
    await setDoc(doc(db, 'assets', 'a-legacy'), { ownerId: ALICE, name: 'Old card', sharedWithFamily: true });
    await setDoc(doc(db, 'assets', 'a-foreign'), { ownerId: CAROL, name: 'Their card', sharedGroupId: G2, sharedWithFamily: true });
  });
});

describe('reading a single asset', () => {
  it('the owner reads their own private asset', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'assets', 'a-private')));
  });

  it('a group member CANNOT read an unshared asset', async () => {
    // Sharing a group with someone grants nothing on its own.
    await assertFails(getDoc(doc(as(BOB), 'assets', 'a-private')));
  });

  it('a group member CAN read an asset shared with that group', async () => {
    // The capability the whole change exists for.
    await assertSucceeds(getDoc(doc(as(BOB), 'assets', 'a-shared')));
  });

  it('someone outside the group cannot read it', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'assets', 'a-shared')));
  });

  it('a signed-out reader cannot read it', async () => {
    await assertFails(getDoc(doc(anon(), 'assets', 'a-shared')));
  });

  it('the LEGACY boolean grants nothing — it never did', async () => {
    // `sharedWithFamily: true` with no group is the entire pre-existing population. If this ever
    // starts passing, every asset anybody ever toggled has been silently published.
    await assertFails(getDoc(doc(as(BOB), 'assets', 'a-legacy')));
  });
});

describe('list queries — the shape the wallet actually uses', () => {
  it("the owner's own query is served", async () => {
    const q = query(collection(as(ALICE), 'assets'), where('ownerId', '==', ALICE));
    await assertSucceeds(getDocs(q));
  });

  it("a member's per-group query is served", async () => {
    const q = query(collection(as(BOB), 'assets'), where('sharedGroupId', '==', G1));
    await assertSucceeds(getDocs(q));
  });

  it('and it returns the shared asset, not an empty page', async () => {
    // "Allowed" and "actually returns something" are different claims, and the second is the one
    // a user would notice. A rule that permits the query but matches nothing looks identical to
    // a broken wallet.
    const q = query(collection(as(BOB), 'assets'), where('sharedGroupId', '==', G1));
    const snap = await getDocs(q);
    expect(snap.docs.map((d) => d.id)).toEqual(['a-shared']);
  });

  it('a non-member asking for that group is refused', async () => {
    const q = query(collection(as(CAROL), 'assets'), where('sharedGroupId', '==', G1));
    await assertFails(getDocs(q));
  });

  it('an unfiltered query over every asset is refused', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'assets')));
  });

  it('filtering on the legacy boolean is refused', async () => {
    // Guaranteed by no branch of the rule, so this is denied wholesale — the exact trap
    // `assetQueryRules.test.ts` guards statically. Proved here against the real engine.
    const q = query(collection(as(ALICE), 'assets'), where('sharedWithFamily', '==', true));
    await assertFails(getDocs(q));
  });
});

describe('writing', () => {
  it('the owner may share into a group they belong to', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'assets', 'a-private'), {
      sharedGroupId: G1, sharedWithFamily: true,
    }));
  });

  it('the owner may NOT share into a group they do not belong to', async () => {
    // Otherwise the wallet is a way to put an image in front of strangers.
    await assertFails(updateDoc(doc(as(ALICE), 'assets', 'a-private'), {
      sharedGroupId: G2, sharedWithFamily: true,
    }));
  });

  it('the same check applies at create, not only at update', async () => {
    const db = as(ALICE);
    await assertSucceeds(setDoc(doc(db, 'assets', 'new-ok'), { ownerId: ALICE, sharedGroupId: G1 }));
    await assertFails(setDoc(doc(db, 'assets', 'new-bad'), { ownerId: ALICE, sharedGroupId: G2 }));
  });

  it('a reader of a shared asset still cannot write it', async () => {
    // Read and write are separate grants. Bob can see Alice's card; that is all.
    await assertFails(updateDoc(doc(as(BOB), 'assets', 'a-shared'), { name: 'hijacked' }));
  });

  it('a reader of a shared asset cannot delete it', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'assets', 'a-shared')));
  });

  it('the owner cannot hand the asset to somebody else by flipping ownerId', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'assets', 'a-private'), { ownerId: BOB }));
  });

  it('a private asset may still be created and edited exactly as before', async () => {
    // The branch that was already there must be untouched: this is what every existing user's
    // wallet depends on, and the case a broken rule would take down first.
    const db = as(ALICE);
    await assertSucceeds(setDoc(doc(db, 'assets', 'plain'), { ownerId: ALICE, name: 'x' }));
    await assertSucceeds(updateDoc(doc(db, 'assets', 'a-private'), { name: 'renamed' }));
    await assertSucceeds(deleteDoc(doc(db, 'assets', 'a-private')));
  });
});

describe('revocation', () => {
  it('leaving the group takes the access with it, immediately', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'assets', 'a-shared')));

    await seed(async (db) => {
      await updateDoc(doc(db, 'groups', G1), { members: [ALICE] });
    });

    // This is the whole argument for naming a GROUP rather than keeping a list of user ids:
    // nothing had to rewrite the asset, and there is no window in which Bob still gets in.
    await assertFails(getDoc(doc(as(BOB), 'assets', 'a-shared')));
  });
});
