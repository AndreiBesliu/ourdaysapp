// functions/src/friendship.ts
// Making two people friends, once, in a transaction.
//
// Extracted because three paths now need it — accepting a friend request, accepting a group
// invitation, and redeeming an invite link — and the write has two traps that are not obvious
// from the call site:
//
//  1. `friends` holds OBJECTS, so `arrayUnion` does not deduplicate. Two accepts produced two
//     entries for the same person, and the stale one kept an old name and email forever. The fix
//     is read-filter-write, which also refreshes the name instead of accumulating copies.
//
//  2. A Firestore transaction must do ALL its reads before ANY of its writes. A helper that read
//     the two user documents at the point it was called would throw the moment a caller had
//     already written something. So this splits in two: `readFriendship` during the read phase,
//     and the `apply` it returns during the write phase.

import * as admin from "firebase-admin";

type Tx = admin.firestore.Transaction;
type Db = admin.firestore.Firestore;

const cap = (s: unknown): string => String(s || "").slice(0, 80);

export interface FriendshipHints {
  /** Fallbacks when neither the profile nor the user document carries a name. */
  aName?: string;
  bName?: string;
  aEmail?: string;
  bEmail?: string;
}

export interface PreparedFriendship {
  /** Call during the WRITE phase of the same transaction. */
  apply: () => void;
  /** What each side will be called — useful for the notification text. */
  aName: string;
  bName: string;
  /** False when they were already friends, so a caller can skip a redundant notification. */
  isNew: boolean;
}

/**
 * Read everything needed to make `uidA` and `uidB` mutual friends.
 *
 * Returns a no-op `apply` when the two uids are the same or either is missing, so callers do not
 * each have to guard it.
 */
export async function readFriendship(
  tx: Tx, db: Db, uidA: string, uidB: string, hints: FriendshipHints = {},
): Promise<PreparedFriendship> {
  if (!uidA || !uidB || uidA === uidB) {
    return { apply: () => { /* nothing to do */ }, aName: "", bName: "", isNew: false };
  }

  const aRef = db.doc(`users/${uidA}`);
  const bRef = db.doc(`users/${uidB}`);
  const [aUser, bUser, aProfile, bProfile] = await Promise.all([
    tx.get(aRef), tx.get(bRef),
    tx.get(db.doc(`profiles/${uidA}`)), tx.get(db.doc(`profiles/${uidB}`)),
  ]);

  const aEmail = (aUser.data()?.email || hints.aEmail || "").toLowerCase() || null;
  const bEmail = (bUser.data()?.email || hints.bEmail || "").toLowerCase() || null;
  const aName = cap(aProfile.data()?.name || aUser.data()?.name || hints.aName ||
    (aEmail || "").split("@")[0] || "Friend");
  const bName = cap(bProfile.data()?.name || bUser.data()?.name || hints.bName ||
    (bEmail || "").split("@")[0] || "Friend");

  const aFriends: any[] = Array.isArray(aUser.data()?.friends) ? aUser.data()!.friends : [];
  const bFriends: any[] = Array.isArray(bUser.data()?.friends) ? bUser.data()!.friends : [];
  const isNew = !aFriends.some((f) => f && f.uid === uidB);

  // Filter then push: exactly one entry per uid on each side, and an existing entry has its name
  // and email refreshed rather than duplicated.
  const nextA = aFriends.filter((f) => f && f.uid !== uidB);
  nextA.push({ uid: uidB, name: bName, email: bEmail });
  const nextB = bFriends.filter((f) => f && f.uid !== uidA);
  nextB.push({ uid: uidA, name: aName, email: aEmail });

  return {
    aName,
    bName,
    isNew,
    apply: () => {
      // `set(..., {merge: true})` rather than `update`: a user document may not exist yet for
      // somebody who has only just signed up, and `update` throws on a missing document — which
      // would fail the whole redemption for exactly the new arrival it is meant to welcome.
      tx.set(aRef, { friends: nextA }, { merge: true });
      tx.set(bRef, { friends: nextB }, { merge: true });
    },
  };
}
