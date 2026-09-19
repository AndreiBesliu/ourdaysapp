// rules-tests/events.test.ts
// The calendar's rules — the collection this app has got wrong most often.
//
// Three separate defects have shipped against `events`:
//   * a LIST query whose constraints did not guarantee the rule, three times over, each one
//     rendering as an empty calendar rather than an error;
//   * a `sharedWithFamily == true` read branch with no other condition, which let ANY signed-in
//     account read and ENUMERATE every event carrying the flag;
//   * a create rule that pinned only `ownerId`, so anyone could write an event naming a stranger
//     in `assigneeIds` and have arbitrary text appear in that stranger's calendar.
//
// All three are closed in the rules. None of them was provable until now.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ALICE, BOB, CAROL, DAVE, G1, G2, anon, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-events'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'events', 'e-personal'), { ownerId: ALICE, title: 'Dentist', groupId: null });
    await setDoc(doc(db, 'events', 'e-group'), { ownerId: ALICE, title: 'Dinner', groupId: G1 });
    await setDoc(doc(db, 'events', 'e-assigned'), { ownerId: ALICE, title: 'Bins', groupId: null, assigneeIds: [CAROL] });
    // A legacy document still carrying the flag whose read branch was removed.
    await setDoc(doc(db, 'events', 'e-legacy-shared'), { ownerId: ALICE, title: 'Old', groupId: null, sharedWithFamily: true });
  });
});

describe('reading one event', () => {
  it('the owner reads their own', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'events', 'e-personal')));
  });

  it('a group member reads a group event', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'events', 'e-group')));
  });

  it('a group member cannot read the owner’s PERSONAL event', async () => {
    await assertFails(getDoc(doc(as(BOB), 'events', 'e-personal')));
  });

  it('somebody named as an assignee reads it, even with no group', async () => {
    await assertSucceeds(getDoc(doc(as(CAROL), 'events', 'e-assigned')));
  });

  it('a stranger reads nothing', async () => {
    await assertFails(getDoc(doc(as(DAVE), 'events', 'e-group')));
    await assertFails(getDoc(doc(anon(), 'events', 'e-group')));
  });

  it('the OLD sharedWithFamily flag grants nothing any more', async () => {
    // The branch that made every flagged event world-readable. If this starts passing, it is back.
    await assertFails(getDoc(doc(as(DAVE), 'events', 'e-legacy-shared')));
  });
});

describe('list queries — where the calendar broke three times', () => {
  it('by owner is served', async () => {
    await assertSucceeds(getDocs(query(collection(as(ALICE), 'events'), where('ownerId', '==', ALICE))));
  });

  it('by group is served for a member and refused for everyone else', async () => {
    await assertSucceeds(getDocs(query(collection(as(BOB), 'events'), where('groupId', '==', G1))));
    await assertFails(getDocs(query(collection(as(DAVE), 'events'), where('groupId', '==', G1))));
  });

  it('by assignee is served', async () => {
    await assertSucceeds(getDocs(query(collection(as(CAROL), 'events'), where('assigneeIds', 'array-contains', CAROL))));
  });

  it('by overrideOfParent alone is REFUSED — the exact bug that shipped three times', async () => {
    // Nothing in this query proves the results belong to the caller, so Firestore rejects it
    // before reading a document. Every time it shipped, the destructive half of a delete ran and
    // the reconciling half did not, with `console.error` the only witness.
    await assertFails(getDocs(query(collection(as(ALICE), 'events'), where('overrideOfParent', '==', 'e-group'))));
  });

  it('but overrideOfParent WITH an owner term is served', async () => {
    // The shape the fix has to take: keep the filter you wanted, add one the rule guarantees.
    await assertSucceeds(getDocs(query(
      collection(as(ALICE), 'events'),
      where('overrideOfParent', '==', 'e-group'),
      where('ownerId', '==', ALICE),
    )));
  });

  it('an unfiltered sweep of the whole calendar is refused', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'events')));
  });

  it('enumerating by sharedWithFamily is refused', async () => {
    // This one used to WORK, and that was the vulnerability: the branch matched the query exactly.
    await assertFails(getDocs(query(collection(as(DAVE), 'events'), where('sharedWithFamily', '==', true))));
  });
});

describe('creating — the injection path', () => {
  it('a personal event naming only yourself is fine', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'events', 'new-self'), {
      ownerId: ALICE, title: 'Gym', groupId: null, assigneeIds: [ALICE],
    }));
  });

  it('a personal event naming a STRANGER is refused', async () => {
    // Uids are not secret, and the read rule grants access to whoever is named. Without this
    // clause anyone could put arbitrary text into anyone else's calendar.
    await assertFails(setDoc(doc(as(DAVE), 'events', 'inject-1'), {
      ownerId: DAVE, title: 'Call this number', groupId: null, assigneeIds: [ALICE],
    }));
  });

  it('the singular assigneeId is pinned the same way', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'events', 'inject-2'), {
      ownerId: DAVE, title: 'x', groupId: null, assigneeId: ALICE,
    }));
  });

  it('writing inviteeId at all is refused — nothing in the app writes it', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'events', 'inject-3'), {
      ownerId: DAVE, title: 'x', groupId: null, inviteeId: ALICE,
    }));
  });

  it('and the same clause refuses an innocent move to the personal calendar', async () => {
    // Not an injection this time: YOUR event, moved off a group onto your own calendar with
    // somebody still assigned. The rule cannot tell the two apart and refuses both, so the person
    // got a failure about a field whose chip had stopped being drawn the moment they switched
    // calendars. `src/utils/eventTargeting.ts` re-derives the list on that switch rather than
    // letting the form offer a state the database rejects.
    await assertFails(setDoc(doc(as(ALICE), 'events', 'retarget-1'), {
      ownerId: ALICE, title: 'Shopping', groupId: null, assigneeIds: [BOB], assigneeId: BOB,
    }));
    // Re-derived, the same move is accepted.
    await assertSucceeds(setDoc(doc(as(ALICE), 'events', 'retarget-2'), {
      ownerId: ALICE, title: 'Shopping', groupId: null, assigneeIds: [ALICE], assigneeId: ALICE,
    }));
  });

  it('inside a group you belong to, naming other members is allowed', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'events', 'new-group'), {
      ownerId: BOB, title: 'Shopping', groupId: G1, assigneeIds: [ALICE],
    }));
  });

  it('but not into a group you do not belong to', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'events', 'new-foreign'), {
      ownerId: DAVE, title: 'x', groupId: G1,
    }));
  });

  it('and the owner field cannot name somebody else', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'events', 'new-spoof'), {
      ownerId: ALICE, title: 'x', groupId: null,
    }));
  });
});

describe('updating and deleting are deliberately different', () => {
  it('a group member may EDIT a group event they do not own', async () => {
    // Intentional: a shared calendar where only the author can fix a typo is not shared.
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e-group'), { title: 'Dinner, 8pm' }));
  });

  it('but may NOT delete it', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'events', 'e-group')));
  });

  it('the owner may delete it', async () => {
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'events', 'e-group')));
  });

  it('a stranger may do neither', async () => {
    await assertFails(updateDoc(doc(as(DAVE), 'events', 'e-group'), { title: 'x' }));
    await assertFails(deleteDoc(doc(as(DAVE), 'events', 'e-group')));
  });

  it('an assignee may edit the event they are named on', async () => {
    await assertSucceeds(updateDoc(doc(as(CAROL), 'events', 'e-assigned'), { completed: true }));
  });
});

describe('what a group member can actually see, not just query', () => {
  it('the group query returns the group event and not the personal one', async () => {
    // "Permitted" and "returns the right rows" are separate claims. This one would catch a rule
    // that is legal but matches nothing — indistinguishable from a broken calendar on screen.
    const snap = await getDocs(query(collection(as(BOB), 'events'), where('groupId', '==', G1)));
    expect(snap.docs.map((d) => d.id)).toEqual(['e-group']);
  });
});

describe('who an event belongs to, and which calendar it is on', () => {
  // Asked after the same shape was found on `notifications`: a rule that reads only
  // `resource.data` checks the document as it STANDS, so anybody it lets write may rewrite the
  // field that decides who it belongs to. `assets` carries a comment about exactly this.
  //
  // It matters more here than anywhere else, because `delete` on an event is owner-only. If
  // ownership is writable, owner-only is not a restriction, it is a formality.

  it('a group member may edit a group event — that part is intended', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e-group'), { title: 'Dinner, later' }));
  });

  it('but may not make themselves its owner', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'events', 'e-group'), { ownerId: BOB }));
  });

  it('so they cannot reach the delete they are not allowed', async () => {
    // The whole chain: Bob may not delete Alice's event, and must not be able to become its
    // owner in order to.
    await assertFails(deleteDoc(doc(as(BOB), 'events', 'e-group')));
    await assertFails(updateDoc(doc(as(BOB), 'events', 'e-group'), { ownerId: BOB }));
  });

  it('somebody merely ASSIGNED a personal event cannot take it either', async () => {
    // Carol shares no group with Alice at all; she was handed a task. That is a smaller
    // relationship than membership, and it must not be a way to own somebody's calendar entry.
    await assertSucceeds(updateDoc(doc(as(CAROL), 'events', 'e-assigned'), { taskStatus: 'done' }));
    await assertFails(updateDoc(doc(as(CAROL), 'events', 'e-assigned'), { ownerId: CAROL }));
  });

  it('an event may not be pushed into a group the writer is not in', async () => {
    // The `assets` rule has `shareTargetOk` for precisely this: pointing a document at a group
    // you do not belong to puts your content in front of people who never invited you — or, the
    // other way round, takes a group's event somewhere its members cannot follow.
    await assertFails(updateDoc(doc(as(BOB), 'events', 'e-group'), { groupId: G2 }));
  });

  it('moving one to a calendar you ARE on still works', async () => {
    // Moving an event between calendars is a feature, repaired on 16.09. The rule has to
    // narrow the destination without closing the door.
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e-group'), { groupId: null }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'events', 'e-personal'), { groupId: G1 }));
  });
});
