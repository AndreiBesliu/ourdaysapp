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
//   * a link is good for exactly ONE registration (owner's decision, 14 Sep) — so a link that
//     gets forwarded past its intended recipient is spent by whoever arrives first, rather than
//     admitting everyone it reaches;
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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { readFriendship } from "./friendship";
import { linkVerdict } from "./inviteLinkState";

const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";

/** Ceilings live HERE, not in the caller's payload. A client-chosen limit is not a limit. */
export const LINK_MAX_DAYS_CAP = 30;
export const LINK_DEFAULT_DAYS = 7;
/**
 * One registration per link. Owner's decision, and a constant rather than a default: a `maxUses`
 * a caller could raise would be exactly the knob the decision says should not exist.
 *
 * The field is still written on the document, and the checks still read it, so an older link
 * minted with a larger allowance keeps behaving the way it was issued instead of being silently
 * cut short — the safe direction for a credential somebody has already sent to somebody else.
 */
export const LINK_USES = 1;
/** Links one account may mint per day. Bounds both spam and the size of the collection. */
const LINK_DAILY_LIMIT = Number(process.env.INVITE_LINK_DAILY_LIMIT || 20);

const cap = (s: unknown, n = 80): string => String(s || "").slice(0, n);
const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * 128 bits, URL-safe, used directly as the document id.
 *
 * The id IS the code so redemption is a single document lookup rather than a query — a query
 * would need an index and a read rule, and the whole point is that clients never read this
 * collection at all. base64url emits only `A-Za-z0-9-_`, all legal in a Firestore document id.
 */
function newCode(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export const createGroupInviteLink = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");

  const { groupId, days } = request.data || {};
  const db = admin.firestore();

  let groupName: string | null = null;
  if (groupId != null) {
    // `groups/${null}` is a VALID Firestore path that resolves to a missing document, so the
    // shape is checked before it is ever used to build one.
    if (typeof groupId !== "string" || !groupId) {
      throw new HttpsError("invalid-argument", "groupId must be a group id or null.");
    }
    const snap = await db.doc(`groups/${groupId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "That group no longer exists.");
    const members = snap.data()?.members;
    if (!Array.isArray(members) || !members.includes(uid)) {
      throw new HttpsError("permission-denied", "You are not in that group.");
    }
    groupName = cap(snap.data()?.name || "", 60) || null;
  }

  // Daily cap, counted on the documents themselves so it cannot drift from reality.
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.collection("invite_links")
    .where("createdBy", "==", uid)
    .where("createdAt", ">=", since)
    .count().get();
  if (recent.data().count >= LINK_DAILY_LIMIT) {
    throw new HttpsError("resource-exhausted", "Too many invite links created today.");
  }

  const life = clampInt(days, LINK_DEFAULT_DAYS, 1, LINK_MAX_DAYS_CAP);
  const code = newCode();

  const profile = await db.doc(`profiles/${uid}`).get();
  await db.doc(`invite_links/${code}`).set({
    groupId: typeof groupId === "string" ? groupId : null,
    groupName,
    createdBy: uid,
    createdByName: cap(profile.data()?.name || (request.auth?.token?.email || "").split("@")[0] || "A friend"),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + life * 24 * 60 * 60 * 1000),
    maxUses: LINK_USES,
    uses: 0,
    redeemedBy: [],
    revoked: false,
  });

  return { code, maxUses: LINK_USES, days: life, groupName };
});

/**
 * What a link is for, WITHOUT redeeming it.
 *
 * The join screen has to say "Ana invites you to Family" before asking somebody to sign up, and
 * it must do so for a caller who has no account yet — so this one is callable unauthenticated. It
 * returns only what a poster would put on the invitation: who, and which group. Never the member
 * list, never the creator's uid or email.
 */
export const peekGroupInviteLink = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const { code } = request.data || {};
  if (typeof code !== "string" || !code || code.length > 64) {
    throw new HttpsError("invalid-argument", "A code is required.");
  }
  const snap = await admin.firestore().doc(`invite_links/${code}`).get();
  if (!snap.exists) return { valid: false, reason: "not-found" };

  const d = snap.data() || {};

  // The SAME verdict `redeem` will reach, from the same function, so the two cannot tell a person
  // different stories about one link. `request.auth` is optional here: this callable serves
  // visitors with no account, which is the whole reason the join screen can name who invited them
  // before asking anyone to sign up.
  const verdict = linkVerdict(d, request.auth?.uid ?? null, Date.now());
  const alreadyJoined = verdict === 'already';
  const admits = verdict === 'ok' || alreadyJoined;

  return {
    valid: admits,
    reason: admits ? null : verdict,
    alreadyJoined,
    groupName: d.groupName || null,
    invitedBy: d.createdByName || null,
  };
});

export const redeemGroupInviteLink = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  const email = (request.auth?.token?.email || "").toLowerCase();
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");

  const { code } = request.data || {};
  if (typeof code !== "string" || !code || code.length > 64) {
    throw new HttpsError("invalid-argument", "A code is required.");
  }

  const db = admin.firestore();
  const linkRef = db.doc(`invite_links/${code}`);

  return db.runTransaction(async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────────
    const snap = await tx.get(linkRef);
    if (!snap.exists) throw new HttpsError("not-found", "This invitation link is not valid.");
    const d = snap.data() || {};

    // ONE verdict, the same one `peek` reached, so the two can never tell a person different
    // stories about the same link. They already did once: both asked "is it spent?" before
    // "have YOU used it?", and the person who had just joined was told their own redemption had
    // used the invitation up.
    const verdict = linkVerdict(d, uid, Date.now());
    if (verdict === "malformed") throw new HttpsError("failed-precondition", "This invitation is malformed.");
    if (verdict === "own") throw new HttpsError("failed-precondition", "This is your own invitation link.");
    if (verdict === "revoked") throw new HttpsError("failed-precondition", "This invitation was withdrawn.");
    if (verdict === "expired") throw new HttpsError("failed-precondition", "This invitation has expired.");
    if (verdict === "spent") throw new HttpsError("resource-exhausted", "This invitation has already been used up.");

    const already = verdict === "already";
    const inviter = d.createdBy as string;

    let groupRef: admin.firestore.DocumentReference | null = null;
    let joinsGroup = false;
    if (typeof d.groupId === "string" && d.groupId) {
      groupRef = db.doc(`groups/${d.groupId}`);
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) throw new HttpsError("not-found", "That group no longer exists.");
      const members = groupSnap.data()?.members;
      if (!Array.isArray(members)) throw new HttpsError("failed-precondition", "That group is malformed.");
      // The creator must STILL be entitled to let people in. A link minted while a member and
      // redeemed after being removed would otherwise be a permanent back door.
      if (!members.includes(inviter)) {
        throw new HttpsError("permission-denied", "Whoever sent this invitation is no longer in the group.");
      }
      joinsGroup = !members.includes(uid);
    }

    const friendship = await readFriendship(tx, db, inviter, uid, { bEmail: email });

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
export const revokeGroupInviteLink = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { code } = request.data || {};
  if (typeof code !== "string" || !code || code.length > 64) {
    throw new HttpsError("invalid-argument", "A code is required.");
  }

  const db = admin.firestore();
  const ref = db.doc(`invite_links/${code}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "This invitation link is not valid.");
    if (snap.data()?.createdBy !== uid) {
      throw new HttpsError("permission-denied", "Only whoever created a link can withdraw it.");
    }
    tx.update(ref, { revoked: true });
  });
  return { revoked: true };
});

/** The caller's own links, newest first, so the invite screen can show and withdraw them. */
export const listMyInviteLinks = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  const { groupId } = request.data || {};

  let q = admin.firestore().collection("invite_links").where("createdBy", "==", uid);
  if (typeof groupId === "string" && groupId) q = q.where("groupId", "==", groupId);

  const snap = await q.orderBy("createdAt", "desc").limit(25).get();
  return {
    links: snap.docs.map((doc) => {
      const d = doc.data();
      return {
        code: doc.id,
        groupId: d.groupId || null,
        groupName: d.groupName || null,
        createdAt: d.createdAt?.toMillis?.() ?? null,
        expiresAt: d.expiresAt?.toMillis?.() ?? null,
        maxUses: d.maxUses || 0,
        uses: d.uses || 0,
        revoked: d.revoked === true,
      };
    }),
  };
});
