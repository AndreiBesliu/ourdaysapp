"use strict";
// functions/src/inviteLinks.ts
// Invitations you can put in a WhatsApp message.
//
// ── Why this is a different thing from the invite that already existed ────────────────
//
// The existing `group_invites` document is addressed to an EMAIL, and `acceptGroupInvite` only
// honours it when the caller's verified email matches. That is strong, and it stays. But it
// cannot be sent over WhatsApp, because there is nothing to send: the recipient discovers the
// invitation inside the app after signing up with exactly the right address.
//
// An invite link is the opposite trade. It is a BEARER credential — whoever holds it can redeem
// it — which buys the thing the owner asked for (send it through any channel, to somebody with no
// account yet) and costs the guarantee that only the intended person can use it.
//
// So the bearer risk is bounded rather than ignored:
//   * the code is 128 bits of CSPRNG, so it cannot be guessed or enumerated;
//   * every link EXPIRES, and the maximum lifetime is capped here, not by the client;
//   * every link has a USE COUNT, also capped here;
//   * the creator can revoke it at any time;
//   * redemption re-checks that the creator is STILL a member of the group — the same
//     accept-time check `acceptGroupInvite` learned, and for the same reason: a link created
//     while a member and redeemed after being removed would otherwise walk someone back in;
//   * the documents live in a collection clients cannot read or write at all. Everything goes
//     through these two callables, so the code is only ever compared by the Admin SDK and no
//     read rule has to be written that could leak one.
//
// ── The friendship ────────────────────────────────────────────────────────────────────
//
// Whoever redeems an invitation also becomes a friend of whoever sent it, in the same
// transaction. Asked for explicitly, and it is right: the person who let you in is the one person
// in the group you certainly know.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMyInviteLinks = exports.revokeGroupInviteLink = exports.redeemGroupInviteLink = exports.peekGroupInviteLink = exports.createGroupInviteLink = exports.LINK_DEFAULT_DAYS = exports.LINK_DEFAULT_USES = exports.LINK_MAX_DAYS_CAP = exports.LINK_MAX_USES_CAP = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const friendship_1 = require("./friendship");
const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";
/** Ceilings live HERE, not in the caller's payload. A client-chosen limit is not a limit. */
exports.LINK_MAX_USES_CAP = 25;
exports.LINK_MAX_DAYS_CAP = 30;
exports.LINK_DEFAULT_USES = 5;
exports.LINK_DEFAULT_DAYS = 7;
/** Links one account may mint per day. Bounds both spam and the size of the collection. */
const LINK_DAILY_LIMIT = Number(process.env.INVITE_LINK_DAILY_LIMIT || 20);
const cap = (s, n = 80) => String(s || "").slice(0, n);
const clampInt = (v, fallback, min, max) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
};
/**
 * 128 bits, URL-safe, used directly as the document id.
 *
 * The id IS the code so redemption is a single document lookup rather than a query — a query
 * would need an index and a read rule, and the whole point is that clients never read this
 * collection at all. base64url emits only `A-Za-z0-9-_`, all legal in a Firestore document id.
 */
function newCode() {
    return crypto.randomBytes(16).toString("base64url");
}
exports.createGroupInviteLink = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c, _d, _e, _f;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const { groupId, maxUses, days } = request.data || {};
    const db = admin.firestore();
    let groupName = null;
    if (groupId != null) {
        // `groups/${null}` is a VALID Firestore path that resolves to a missing document, so the
        // shape is checked before it is ever used to build one.
        if (typeof groupId !== "string" || !groupId) {
            throw new https_1.HttpsError("invalid-argument", "groupId must be a group id or null.");
        }
        const snap = await db.doc(`groups/${groupId}`).get();
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "That group no longer exists.");
        const members = (_b = snap.data()) === null || _b === void 0 ? void 0 : _b.members;
        if (!Array.isArray(members) || !members.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "You are not in that group.");
        }
        groupName = cap(((_c = snap.data()) === null || _c === void 0 ? void 0 : _c.name) || "", 60) || null;
    }
    // Daily cap, counted on the documents themselves so it cannot drift from reality.
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db.collection("invite_links")
        .where("createdBy", "==", uid)
        .where("createdAt", ">=", since)
        .count().get();
    if (recent.data().count >= LINK_DAILY_LIMIT) {
        throw new https_1.HttpsError("resource-exhausted", "Too many invite links created today.");
    }
    const uses = clampInt(maxUses, exports.LINK_DEFAULT_USES, 1, exports.LINK_MAX_USES_CAP);
    const life = clampInt(days, exports.LINK_DEFAULT_DAYS, 1, exports.LINK_MAX_DAYS_CAP);
    const code = newCode();
    const profile = await db.doc(`profiles/${uid}`).get();
    await db.doc(`invite_links/${code}`).set({
        groupId: typeof groupId === "string" ? groupId : null,
        groupName,
        createdBy: uid,
        createdByName: cap(((_d = profile.data()) === null || _d === void 0 ? void 0 : _d.name) || (((_f = (_e = request.auth) === null || _e === void 0 ? void 0 : _e.token) === null || _f === void 0 ? void 0 : _f.email) || "").split("@")[0] || "A friend"),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + life * 24 * 60 * 60 * 1000),
        maxUses: uses,
        uses: 0,
        redeemedBy: [],
        revoked: false,
    });
    return { code, maxUses: uses, days: life, groupName };
});
/**
 * What a link is for, WITHOUT redeeming it.
 *
 * The join screen has to say "Ana invites you to Family" before asking somebody to sign up, and
 * it must do so for a caller who has no account yet — so this one is callable unauthenticated. It
 * returns only what a poster would put on the invitation: who, and which group. Never the member
 * list, never the creator's uid or email.
 */
exports.peekGroupInviteLink = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b;
    const { code } = request.data || {};
    if (typeof code !== "string" || !code || code.length > 64) {
        throw new https_1.HttpsError("invalid-argument", "A code is required.");
    }
    const snap = await admin.firestore().doc(`invite_links/${code}`).get();
    if (!snap.exists)
        return { valid: false, reason: "not-found" };
    const d = snap.data() || {};
    const expired = ((_b = (_a = d.expiresAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) ? d.expiresAt.toMillis() < Date.now() : false;
    const spent = (d.uses || 0) >= (d.maxUses || 0);
    const reason = d.revoked ? "revoked" : expired ? "expired" : spent ? "spent" : null;
    return {
        valid: reason === null,
        reason,
        groupName: d.groupName || null,
        invitedBy: d.createdByName || null,
    };
});
exports.redeemGroupInviteLink = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a, _b, _c;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    const email = (((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) || "").toLowerCase();
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const { code } = request.data || {};
    if (typeof code !== "string" || !code || code.length > 64) {
        throw new https_1.HttpsError("invalid-argument", "A code is required.");
    }
    const db = admin.firestore();
    const linkRef = db.doc(`invite_links/${code}`);
    return db.runTransaction(async (tx) => {
        var _a, _b, _c;
        // ── READ PHASE ────────────────────────────────────────────────────────────
        const snap = await tx.get(linkRef);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "This invitation link is not valid.");
        const d = snap.data() || {};
        if (d.revoked === true)
            throw new https_1.HttpsError("failed-precondition", "This invitation was withdrawn.");
        const expiresAt = (_b = (_a = d.expiresAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (typeof expiresAt === "number" && expiresAt < Date.now()) {
            throw new https_1.HttpsError("failed-precondition", "This invitation has expired.");
        }
        if ((d.uses || 0) >= (d.maxUses || 0)) {
            throw new https_1.HttpsError("resource-exhausted", "This invitation has already been used up.");
        }
        const inviter = typeof d.createdBy === "string" ? d.createdBy : "";
        if (!inviter)
            throw new https_1.HttpsError("failed-precondition", "This invitation is malformed.");
        if (inviter === uid) {
            throw new https_1.HttpsError("failed-precondition", "This is your own invitation link.");
        }
        const already = Array.isArray(d.redeemedBy) && d.redeemedBy.includes(uid);
        let groupRef = null;
        let joinsGroup = false;
        if (typeof d.groupId === "string" && d.groupId) {
            groupRef = db.doc(`groups/${d.groupId}`);
            const groupSnap = await tx.get(groupRef);
            if (!groupSnap.exists)
                throw new https_1.HttpsError("not-found", "That group no longer exists.");
            const members = (_c = groupSnap.data()) === null || _c === void 0 ? void 0 : _c.members;
            if (!Array.isArray(members))
                throw new https_1.HttpsError("failed-precondition", "That group is malformed.");
            // The creator must STILL be entitled to let people in. A link minted while a member and
            // redeemed after being removed would otherwise be a permanent back door.
            if (!members.includes(inviter)) {
                throw new https_1.HttpsError("permission-denied", "Whoever sent this invitation is no longer in the group.");
            }
            joinsGroup = !members.includes(uid);
        }
        const friendship = await (0, friendship_1.readFriendship)(tx, db, inviter, uid, { bEmail: email });
        // ── WRITE PHASE ───────────────────────────────────────────────────────────
        if (joinsGroup && groupRef) {
            tx.update(groupRef, { members: admin.firestore.FieldValue.arrayUnion(uid) });
        }
        friendship.apply();
        // A second redemption by the SAME person spends no use — they are already in, and charging
        // for it would let one person exhaust a family link by opening it twice.
        if (!already) {
            tx.update(linkRef, {
                uses: admin.firestore.FieldValue.increment(1),
                redeemedBy: admin.firestore.FieldValue.arrayUnion(uid),
            });
        }
        if (!already) {
            const notifRef = db.collection("notifications").doc();
            tx.set(notifRef, {
                userId: inviter,
                createdBy: uid,
                type: "friend",
                // The reader's client translates the keys; the literals are only a fallback for rows
                // written before keys existed. The renderer appends `param` at the END.
                titleKey: "inviteLinkUsed",
                bodyKey: "inviteLinkUsedBody",
                param: friendship.bName,
                title: "Invitation accepted",
                body: `${friendship.bName} joined through your invitation.`,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        return {
            status: already ? "already" : "accepted",
            groupId: d.groupId || null,
            groupName: d.groupName || null,
            invitedBy: friendship.aName,
            joinedGroup: joinsGroup,
        };
    });
});
/** Withdraw a link. Only its creator, and never destructive — redemptions already made stand. */
exports.revokeGroupInviteLink = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const { code } = request.data || {};
    if (typeof code !== "string" || !code || code.length > 64) {
        throw new https_1.HttpsError("invalid-argument", "A code is required.");
    }
    const db = admin.firestore();
    const ref = db.doc(`invite_links/${code}`);
    await db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "This invitation link is not valid.");
        if (((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.createdBy) !== uid) {
            throw new https_1.HttpsError("permission-denied", "Only whoever created a link can withdraw it.");
        }
        tx.update(ref, { revoked: true });
    });
    return { revoked: true };
});
/** The caller's own links, newest first, so the invite screen can show and withdraw them. */
exports.listMyInviteLinks = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    var _a;
    const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const { groupId } = request.data || {};
    let q = admin.firestore().collection("invite_links").where("createdBy", "==", uid);
    if (typeof groupId === "string" && groupId)
        q = q.where("groupId", "==", groupId);
    const snap = await q.orderBy("createdAt", "desc").limit(25).get();
    return {
        links: snap.docs.map((doc) => {
            var _a, _b, _c, _d, _e, _f;
            const d = doc.data();
            return {
                code: doc.id,
                groupId: d.groupId || null,
                groupName: d.groupName || null,
                createdAt: (_c = (_b = (_a = d.createdAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null,
                expiresAt: (_f = (_e = (_d = d.expiresAt) === null || _d === void 0 ? void 0 : _d.toMillis) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : null,
                maxUses: d.maxUses || 0,
                uses: d.uses || 0,
                revoked: d.revoked === true,
            };
        }),
    };
});
//# sourceMappingURL=inviteLinks.js.map