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
import { ALICE, BOB, CAROL, DAVE, EMAIL, G1, G2, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

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

// ── what UPDATE let through until 16.09.2026 ─────────────────────────────────────────────────
//
// `create` pinned ownerId, paidBy and group membership. `update` pinned NONE of them: it asked
// only "is this yours", and everything a create was stopped from doing could be done by creating
// a harmless personal expense and then editing it. Found by an adversarial review of code that
// had been live for months, and the first case is the one that matters — the other two are a
// nuisance, that one moves other people's money.
describe('expenses — an edit cannot do what a create was refused', () => {
  it('cannot be moved into a group the owner is not in', async () => {
    // Alice is not in G2. Without this she files a 500 expense in Carol's ledger, every balance
    // there moves, and Carol cannot delete it: only the owner may, and the owner is Alice.
    await assertFails(updateDoc(doc(as(ALICE), 'expenses', 'x-personal'), { groupId: G2 }));
    await assertFails(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { groupId: G2 }));
  });

  it('cannot be handed to somebody else', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'expenses', 'x-personal'), { ownerId: BOB }));
  });

  it('cannot be re-attributed to another payer', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { paidBy: BOB }));
  });

  it('but the ordinary edits still work', async () => {
    // The point of the rule is to stop three fields moving, not to freeze the row. A guard that
    // also blocked correcting a typo would be replaced by a looser one within the week.
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { amount: 41.5 }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { description: 'bread' }));
  });

  it('and a personal expense can still be filed into a group the owner IS in', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-personal'), { groupId: G1 }));
  });

  it('and can still be taken back out of the group', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { groupId: null }));
  });
});

// ── splitAmong: who a cost is divided between ────────────────────────────────────────────────
//
// It decides what everybody ELSE owes, so it is not the client's to state freely: without a rule,
// one member could write `splitAmong: [somebody-else]` and put a whole bill on one person.
describe('expenses — the split list has to be people who are actually in the group', () => {
  it('records a split among real members', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'expenses', 'x-split'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 30, splitAmong: [ALICE, BOB],
    }));
  });

  it('refuses a split naming somebody outside the group', async () => {
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'x-outsider'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 30, splitAmong: [BOB, DAVE],
    }));
  });

  it('refuses an empty split, which would divide by nobody', async () => {
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'x-empty'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 30, splitAmong: [],
    }));
  });

  it('refuses a split that is not a list at all', async () => {
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'x-string'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 30, splitAmong: BOB,
    }));
  });

  it('refuses a split on a PERSONAL expense, which nobody shares', async () => {
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'x-personal-split'), {
      ownerId: BOB, paidBy: BOB, groupId: null, amount: 30, splitAmong: [BOB],
    }));
  });

  it('still accepts an expense with no split at all', async () => {
    // Every row written before 16.09.2026 has none, and they must keep working.
    await assertSucceeds(setDoc(doc(as(BOB), 'expenses', 'x-nosplit'), {
      ownerId: BOB, paidBy: BOB, groupId: G1, amount: 30,
    }));
  });

  it('and an edit cannot smuggle a dishonest split in later', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { splitAmong: [DAVE] }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'expenses', 'x-group'), { splitAmong: [ALICE] }));
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

  it('an invitation may only have its STATUS changed', async () => {
    // `create` pins `fromId` and the group; `update` pinned nothing, and `canAccessInvite` reads
    // only `resource.data`. So: create a clean invitation you own, then edit it into a forged one
    // and hand it to `acceptGroupInvite`. With a groupId you join that group; with `groupId: null`
    // you force a FRIENDSHIP, which writes `users/{victim}.friends` — an owner-only document —
    // and returns their private email into your own list.
    await assertFails(updateDoc(doc(as(ALICE), 'group_invites', 'i-to-dave'), { fromId: BOB }));
    await assertFails(updateDoc(doc(as(ALICE), 'group_invites', 'i-to-dave'), { groupId: G2 }));
    await assertFails(updateDoc(doc(as(ALICE), 'group_invites', 'i-to-dave'), { toId: ALICE }));
    // Not smuggled alongside the one field that IS allowed, either.
    await assertFails(updateDoc(doc(as(ALICE), 'group_invites', 'i-to-dave'), {
      status: 'declined', groupId: G2,
    }));
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

describe('invite links are denied to clients outright', () => {
  it('nobody can read one, even knowing the code', async () => {
    // The document id IS the secret, so a readable collection would be an enumerable list of
    // every live invitation. Everything goes through the callables instead.
    await seed(async (db) => {
      await setDoc(doc(db, 'invite_links', 'secret-code'), {
        groupId: G1, createdBy: ALICE, maxUses: 5, uses: 0, revoked: false,
      });
    });
    await assertFails(getDoc(doc(as(ALICE), 'invite_links', 'secret-code')));
    await assertFails(getDoc(doc(as(DAVE), 'invite_links', 'secret-code')));
  });

  it('nobody can list them', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'invite_links')));
  });

  it('nobody can forge one', async () => {
    // A client-written link would let somebody mint themselves an unlimited, never-expiring way
    // into any group id they cared to type.
    await assertFails(setDoc(doc(as(DAVE), 'invite_links', 'forged'), {
      groupId: G1, createdBy: DAVE, maxUses: 999, uses: 0, revoked: false,
    }));
  });

  it('the creator cannot even edit their own', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'invite_links', 'mine'), {
        groupId: G1, createdBy: ALICE, maxUses: 1, uses: 1, revoked: false,
      });
    });
    // Withdrawing goes through revokeGroupInviteLink; a direct write could reset `uses`.
    await assertFails(updateDoc(doc(as(ALICE), 'invite_links', 'mine'), { uses: 0 }));
    await assertFails(deleteDoc(doc(as(ALICE), 'invite_links', 'mine')));
  });
});

// ── amount: the one field nothing checked ──────────────────────────────────────────────────────
// The wallet renders `amount.toFixed(2)`, so a single row with a string or null amount put every
// member's Wallet on the ErrorBoundary; a negative one ran every balance backwards.
describe('expenses — the amount has to be a real amount', () => {
  const base = { ownerId: BOB, paidBy: BOB, groupId: G1, splitAmong: [ALICE, BOB], description: 'x' };

  it('accepts an ordinary one, and a large one', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'expenses', 'ok-1'), { ...base, amount: 12.5 }));
    await assertSucceeds(setDoc(doc(as(BOB), 'expenses', 'ok-2'), { ...base, amount: 9_999_999 }));
  });

  it('refuses everything that took the wallet down or ran it backwards', async () => {
    const bad: unknown[] = ['12.50', null, NaN, Infinity, -Infinity, -5, 0, 10_000_000, true, [12], { v: 12 }];
    for (const [i, amount] of bad.entries()) {
      await assertFails(setDoc(doc(as(BOB), 'expenses', `bad-${i}`), { ...base, amount }));
    }
    // And a row with no amount at all.
    await assertFails(setDoc(doc(as(BOB), 'expenses', 'bad-missing'), base));
  });

  it('and an edit cannot introduce one either', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'expenses', 'x-amount'), { ...base, amount: 20 });
    });
    await assertFails(updateDoc(doc(as(BOB), 'expenses', 'x-amount'), { amount: 'twenty' }));
    await assertFails(updateDoc(doc(as(BOB), 'expenses', 'x-amount'), { amount: -20 }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'expenses', 'x-amount'), { amount: 21 }));
  });
});
