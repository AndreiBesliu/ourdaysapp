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
exports.readFriendship = readFriendship;
const cap = (s) => String(s || "").slice(0, 80);
/**
 * Read everything needed to make `uidA` and `uidB` mutual friends.
 *
 * Returns a no-op `apply` when the two uids are the same or either is missing, so callers do not
 * each have to guard it.
 */
async function readFriendship(tx, db, uidA, uidB, hints = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!uidA || !uidB || uidA === uidB) {
        return { apply: () => { }, aName: "", bName: "", isNew: false };
    }
    const aRef = db.doc(`users/${uidA}`);
    const bRef = db.doc(`users/${uidB}`);
    const [aUser, bUser, aProfile, bProfile] = await Promise.all([
        tx.get(aRef), tx.get(bRef),
        tx.get(db.doc(`profiles/${uidA}`)), tx.get(db.doc(`profiles/${uidB}`)),
    ]);
    const aEmail = (((_a = aUser.data()) === null || _a === void 0 ? void 0 : _a.email) || hints.aEmail || "").toLowerCase() || null;
    const bEmail = (((_b = bUser.data()) === null || _b === void 0 ? void 0 : _b.email) || hints.bEmail || "").toLowerCase() || null;
    const aName = cap(((_c = aProfile.data()) === null || _c === void 0 ? void 0 : _c.name) || ((_d = aUser.data()) === null || _d === void 0 ? void 0 : _d.name) || hints.aName ||
        (aEmail || "").split("@")[0] || "Friend");
    const bName = cap(((_e = bProfile.data()) === null || _e === void 0 ? void 0 : _e.name) || ((_f = bUser.data()) === null || _f === void 0 ? void 0 : _f.name) || hints.bName ||
        (bEmail || "").split("@")[0] || "Friend");
    const aFriends = Array.isArray((_g = aUser.data()) === null || _g === void 0 ? void 0 : _g.friends) ? aUser.data().friends : [];
    const bFriends = Array.isArray((_h = bUser.data()) === null || _h === void 0 ? void 0 : _h.friends) ? bUser.data().friends : [];
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