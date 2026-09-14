// rules-tests/expenses-invites.test.ts
// The shared ledger, and the invitations that let people into a group.
//
// Both had the same shape of defect and both were fixed the same way — by pinning the field that
// says WHO, so that read access to a group could not be turned into write access in someone
// else's name:
//
//   expenses.paidBy — being in a group lets you SEE the ledger, not record a debt under a
//     member's name, and not rewrite what somebody else recorded.
//   group_invites.groupId — the group id used to be the client's to pick, so anyone could write
//     a pending invite naming any group, address it to themselves, and hand it to
//     acceptGroupInvite.
//
// The invite fix is explicitly the cheaper HALF: it is evaluated at create time, so it cannot stop
// a current member from writing a self-addressed invite and redeeming it after being removed.
// `acceptGroupInvite` re-checks membership at accept time, and that half lives in a Cloud
// Function, which these rules do not constrain and this file therefore cannot prove.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ALICE, BOB, CAROL, DAVE, EMAIL, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-ledger'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'expenses', 'x-group'), { ownerId: ALICE, paidBy: ALICE, groupId: G1, amount: 40 });
    await setDoc(doc(db, 'expenses', 'x-personal'), { ownerId: ALICE, paidBy: ALICE, groupId: null, amount: 12 });
    await setDoc(doc(db, 'group_invites', 'i-to-dave'), {
      fromId: ALICE, toEmail: EMAIL[DAVE], groupId: G1, status: 'pending',
    });
  });
});

describe('expenses — seeing the ledger is not writing in it', () => {
  it('a group member reads the group ledger', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'expenses', 'x-group')));
    await assertSucceeds(getDocs(query(collection(as(BOB), 'expenses'), where('groupId', '==', G1))));
  });

  it('an outsider reads nothing', async () => {
    await assertFails(getDoc(doc(as(DAVE), 'expenses', 'x-group')));
    await assertFails(getDocs(query(collection(as(DAVE), 'expenses'), where('groupId', '==', G1))));
  });

  it('a group member cannot read the owner’s personal expense', async () => {
    await assertFails(getDoc(doc(as(BOB), 'expenses', 'x-personal')));
  });

  it('an unfiltered sweep of every expense is refused', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'expenses')));
  });

  it('a member records an expense they paid', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'expenses', 'x-new'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 10,
    }));
  });

  it('but cannot record one under ANOTHER member’s name', async () => {
    // Otherwise a group ledger is a place to invent debts for other people.
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'x-forged'), {
      ownerId: BOB, paidBy: ALICE, groupId: G1, amount: 500,
    }));
  });

  it('and cannot post into a group they are not in', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'expenses', 'x-foreign'), {
      ownerId: DAVE, paidBy: DAVE, groupId: G1, amount: 1,
    }));
  });

  it('a member may not rewrite what somebody else recorded', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'expenses', 'x-group'), { amount: 4000 }));
  });

  it('nor delete it', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'expenses', 'x-group')));
  });

  it('the person who recorded it may edit and delete it', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { amount: 42 }));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'expenses', 'x-group')));
  });
});

describe('group invites', () => {
  it('the invitee reads the invite addressed to their email', async () => {
    await assertSucceeds(getDoc(doc(as(DAVE), 'group_invites', 'i-to-dave')));
  });

  it('the sender reads it', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'group_invites', 'i-to-dave')));
  });

  it('a member of the target group reads it — group cleanup depends on that', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'group_invites', 'i-to-dave')));
  });

  it('an unrelated person does not', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'group_invites', 'i-to-dave')));
  });

  it('nobody can enumerate every invited email', async () => {
    await assertFails(getDocs(collection(as(DAVE), 'group_invites')));
  });

  it('a member may invite into their own group', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'group_invites', 'i-new'), {
      fromId: BOB, toEmail: EMAIL[CAROL], groupId: G1, status: 'pending',
    }));
  });

  it('an OUTSIDER may not invite into a group they are not in', async () => {
    // The defect: the group id was the client's to pick. Write a self-addressed invite naming any
    // group, then hand it to acceptGroupInvite.
    await assertFails(setDoc(doc(as(DAVE), 'group_invites', 'i-self'), {
      fromId: DAVE, toEmail: EMAIL[DAVE], groupId: G1, status: 'pending',
    }));
  });

  it('nobody may forge an invite "from" somebody else', async () => {
    await assertFails(setDoc(doc(as(DAVE), 'group_invites', 'i-forged'), {
      fromId: ALICE, toEmail: EMAIL[DAVE], groupId: G1, status: 'pending',
    }));
  });

  it('a personal invite with no group is still allowed', async () => {
    // InviteFamilyModal writes `groupId: groupId || null`; this is a real flow, not a loophole.
    await assertSucceeds(setDoc(doc(as(DAVE), 'group_invites', 'i-personal'), {
      fromId: DAVE, toEmail: EMAIL[CAROL], groupId: null, status: 'pending',
    }));
  });

  it('the invitee may respond to their own invite', async () => {
    await assertSucceeds(updateDoc(doc(as(DAVE), 'group_invites', 'i-to-dave'), { status: 'declined' }));
  });

  it('a bystander may not', async () => {
    await assertFails(updateDoc(doc(as(CAROL), 'group_invites', 'i-to-dave'), { status: 'accepted' }));
  });

  it('the group query used for cleanup returns the group’s invites', async () => {
    const snap = await getDocs(query(collection(as(ALICE), 'group_invites'), where('groupId', '==', G1)));
    expect(snap.docs.map((d) => d.id)).toEqual(['i-to-dave']);
  });
});
