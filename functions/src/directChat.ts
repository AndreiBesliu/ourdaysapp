// functions/src/directChat.ts
// One-to-one conversations.
//
// ── Why a separate collection and not a two-person group ──────────────────────────────
//
// The tempting shortcut is to make a direct chat a `groups` document with two members: every
// message path, rule, notification, typing indicator, search and pin then works unchanged.
//
// It was rejected on a count. Thirteen places list groups by membership — five in the client
// (the calendar switcher, the wallet, the group creator, the PvP roster) and eight on the server
// — and every one of them would need a filter for a kind of group it has never heard of. Forget
// one and a private two-person chat shows up as a calendar group, a wallet sharing target, or a
// PvP opponent. Each failure silent, each in a different screen.
//
// A separate collection cannot leak into any of them. The price is this file and one rules block;
// the message subcollection is deliberately the SAME shape, so the chat UI reads either path and
// nothing else has to know which.
//
// ── Why opening one is a callable ─────────────────────────────────────────────────────
//
// The rule for "may I talk to this person" is "we are friends, or we share a group", and Firestore
// rules can express neither. `isMemberOfGroup` needs a known group id — which is exactly why the
// assets rule says the shared-group check has to live on the server — and friendship is an array
// of OBJECTS on a document only its owner may read.
//
// So clients cannot create a chat at all. They ask for one.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { notify } from "./notify";

const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";

/**
 * The document id for a pair, derived rather than random.
 *
 * Sorted and joined, so both people compute the same one and "do we already have a chat" is a
 * single document read instead of a query. A random id would need an index, a query, and a race
 * where two people opening the chat at the same second create two of them.
 */
export function directChatId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

/** Do these two share any group? The check the rules cannot make. */
async function shareAGroup(db: admin.firestore.Firestore, a: string, b: string): Promise<boolean> {
  const snap = await db.collection("groups").where("members", "array-contains", a).get();
  return snap.docs.some((d) => {
    const members = d.data()?.members;
    return Array.isArray(members) && members.includes(b);
  });
}

/**
 * Does `owner` list `other` as a friend? `friends` holds objects, hence the shape check.
 *
 * The DIRECTION is the whole point. This was called as `areFriends(db, caller, otherUid)` — a read
 * of `users/{caller}`, which the caller owns and may write freely (`allow read, write: if
 * isOwner(userId)`). So the authorisation was "am I allowed? let me check the note I wrote
 * myself": push `{ uid: <anyone> }` into your own `friends` array and open a direct chat with any
 * account in the app.
 *
 * Asking the TARGET's document instead makes the fact one the caller cannot manufacture. A real
 * friendship is written to both users by `respondToFriendRequest`, so nothing legitimate changes.
 */
async function listsAsFriend(db: admin.firestore.Firestore, owner: string, other: string): Promise<boolean> {
  const snap = await db.doc(`users/${owner}`).get();
  const friends = snap.data()?.friends;
  return Array.isArray(friends) && friends.some((f) => f && f.uid === other);
}

export const openDirectChat = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");

  const { otherUid } = request.data || {};
  if (typeof otherUid !== "string" || !otherUid) {
    throw new HttpsError("invalid-argument", "otherUid is required.");
  }
  if (otherUid === uid) {
    throw new HttpsError("failed-precondition", "You cannot start a chat with yourself.");
  }

  const db = admin.firestore();
  const id = directChatId(uid, otherUid);
  const ref = db.doc(`chats/${id}`);

  // Already there: nothing to authorise again. Re-checking would mean a chat could go dead
  // because somebody left a group, silently hiding a conversation that already has history in it.
  const existing = await ref.get();
  if (existing.exists) {
    return { chatId: id, created: false };
  }

  const [friends, sharedGroup] = await Promise.all([
    // THEIR list, not ours — see the note on `listsAsFriend`.
    listsAsFriend(db, otherUid, uid),
    shareAGroup(db, uid, otherUid),
  ]);
  if (!friends && !sharedGroup) {
    throw new HttpsError("permission-denied", "You can only message friends and people in your groups.");
  }

  // The other person must exist. Otherwise a typo'd uid creates a chat with nobody in it that
  // still appears in one person's list forever — a stale friend entry or a group membership left
  // behind by a deleted account would do it, since neither of the checks above proves the other
  // side is still there.
  //
  // Checked against `users`, NOT `profiles`. The profile is a public MIRROR of name and photo that
  // an account writes for itself when it next signs in, so five of the eight accounts here have no
  // profile document at all — and every one of them was offered in the "New message" picker and
  // then refused by this line with "That person could not be found." `users` is the document that
  // actually says whether somebody exists.
  const other = await db.doc(`users/${otherUid}`).get();
  if (!other.exists) {
    throw new HttpsError("not-found", "That person could not be found.");
  }

  await ref.set({
    members: [uid, otherUid].sort(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
    // Written by the message trigger from here on; seeded empty so the list has something to
    // sort by before anybody has said anything.
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageText: "",
    lastMessageBy: null,
  });

  return { chatId: id, created: true };
});

/**
 * A direct message arrived: tell the other person, and keep the list preview current.
 *
 * The same `notify` every other announcement goes through, so a direct message leaves a bell row
 * AND a push, in the reader's language — which is more than group chat managed until today.
 *
 * The message TEXT rides as `bodyText`: it is the sender's own words and must not be translated.
 */
export const onDirectMessageCreated = onDocumentCreated("chats/{chatId}/messages/{messageId}", async (event) => {
  const msg = event.data?.data();
  const chatId = event.params.chatId;
  if (!msg || !chatId) return;

  const senderId = typeof msg.senderId === "string" ? msg.senderId : "";
  if (!senderId) return;

  try {
    const db = admin.firestore();
    const chatSnap = await db.doc(`chats/${chatId}`).get();
    const members: string[] = Array.isArray(chatSnap.data()?.members) ? chatSnap.data()!.members : [];
    if (members.length === 0) return;

    const preview = typeof msg.text === "string" && msg.text
      ? msg.text.slice(0, 140)
      : msg.imageUrl ? "\u{1F4F7}" : msg.audioUrl ? "\u{1F3A4}" : "";

    // Written by the server, never by a client: a writable preview is a way to put words into
    // somebody else's conversation list.
    await db.doc(`chats/${chatId}`).set({
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageText: preview,
      lastMessageBy: senderId,
    }, { merge: true });

    const senderName =
      (await db.doc(`profiles/${senderId}`).get()).data()?.name || "Someone";

    await notify({
      userIds: members.filter((m) => m !== senderId),
      createdBy: senderId,
      type: "chat",
      titleKey: "notifNewMessage",
      titleParam: senderName,
      ...(typeof msg.text === "string" && msg.text
        ? { bodyText: msg.text }
        : { bodyKey: msg.imageUrl ? "notifSentImage" : "notifSentMessage" }),
      data: { route: "/chat", chatId },
    });
  } catch (err) {
    console.error("onDirectMessageCreated: could not deliver", err);
  }
});
