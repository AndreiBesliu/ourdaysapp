"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.authIdentityOf = authIdentityOf;
exports.readFriendship = readFriendship;
const admin = require("firebase-admin");
const senderIdentity_1 = require("./senderIdentity");
const cap = (s) => String(s || "").slice(0, 80);
/** A person's email and whether it is verified, from their Auth record. Null when unknown. */
async function authIdentityOf(uid) {
    if (!uid)
        return { email: null, verified: false };
    try {
        const user = await admin.auth().getUser(uid);
        const email = (0, senderIdentity_1.trustedEmail)(user.email);
        return { email, verified: email !== null && user.emailVerified === true };
    }
    catch (_a) {
        return { email: null, verified: false };
    }
}
/**
 * Read everything needed to make `uidA` and `uidB` mutual friends.
 *
 * Returns a no-op `apply` when the two uids are the same or either is missing, so callers do not
 * each have to guard it.
 */
async function readFriendship(tx, db, uidA, uidB, hints = {}) {
    var _a, _b, _c, _d, _e, _f;
    if (!uidA || !uidB || uidA === uidB) {
        return { apply: () => { }, aName: "", bName: "", isNew: false };
    }
    const aRef = db.doc(`users/${uidA}`);
    const bRef = db.doc(`users/${uidB}`);
    const [aUser, bUser, aProfile, bProfile] = await Promise.all([
        tx.get(aRef), tx.get(bRef),
        tx.get(db.doc(`profiles/${uidA}`)), tx.get(db.doc(`profiles/${uidB}`)),
    ]);
    // Emails from Auth only; names are self-chosen wherever they come from, so the profile is as
    // good a source as any — but never a field on the request that brought the two together.
    const aEmail = (0, senderIdentity_1.trustedEmail)(hints.aEmail);
    const bEmail = (0, senderIdentity_1.trustedEmail)(hints.bEmail);
    const aName = cap(((_a = aProfile.data()) === null || _a === void 0 ? void 0 : _a.name) || ((_b = aUser.data()) === null || _b === void 0 ? void 0 : _b.name) ||
        (aEmail || "").split("@")[0] || "Friend");
    const bName = cap(((_c = bProfile.data()) === null || _c === void 0 ? void 0 : _c.name) || ((_d = bUser.data()) === null || _d === void 0 ? void 0 : _d.name) ||
        (bEmail || "").split("@")[0] || "Friend");
    const aFriends = Array.isArray((_e = aUser.data()) === null || _e === void 0 ? void 0 : _e.friends) ? aUser.data().friends : [];
    const bFriends = Array.isArray((_f = bUser.data()) === null || _f === void 0 ? void 0 : _f.friends) ? bUser.data().friends : [];
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
//# sourceMappingURL=friendship.js.map