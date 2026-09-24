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
import { trustedEmail } from "./senderIdentity";

type Tx = admin.firestore.Transaction;
type Db = admin.firestore.Firestore;

const cap = (s: unknown): string => String(s || "").slice(0, 80);

export interface FriendshipHints {
  /**
   * The two people's emails, and the ONLY source of them. Each must come from Firebase Auth — the
   * caller's ID token, or `authIdentityOf` below — never from a Firestore document.
   *
   * This used to read `users/{uid}.email` first and fall back to whatever the caller passed, which
   * for an invitation was the invitation's own `fromEmail`. Both are written by the person they
   * describe (`users` is owner-writable; the invitation by its sender), so a stranger's forged
   * address went straight into the recipient's friend list. See senderIdentity.ts.
   */
  aEmail?: string | null;
  bEmail?: string | null;
}

/** A person's email and whether it is verified, from their Auth record. Null when unknown. */
export async function authIdentityOf(uid: string): Promise<{ email: string | null; verified: boolean }> {
  if (!uid) return { email: null, verified: false };
  try {
    const user = await admin.auth().getUser(uid);
    const email = trustedEmail(user.email);
    return { email, verified: email !== null && user.emailVerified === true };
  } catch {
    return { email: null, verified: false };
  }
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

  // Emails from Auth only; names are self-chosen wherever they come from, so the profile is as
  // good a source as any — but never a field on the request that brought the two together.
  const aEmail = trustedEmail(hints.aEmail);
  const bEmail = trustedEmail(hints.bEmail);
  const aName = cap(aProfile.data()?.name || aUser.data()?.name ||
    (aEmail || "").split("@")[0] || "Friend");
  const bName = cap(bProfile.data()?.name || bUser.data()?.name ||
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
