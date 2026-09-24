"use strict";
// functions/src/senderIdentity.ts
//
// Who sent a friend request or a group invitation — from sources the sender cannot write.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────
//
// A request carried `fromName`, `fromEmail` and (on invitations) `groupName`, all written by the
// sender's own client, and the rules pinned only `fromId`. The recipient's screen showed those
// three fields as the sender. So a stranger's request read "Mama <mama@…>", and accepting it put
// the recipient's REAL email into the stranger's friend list — while the fake one, through a
// fallback on `fromEmail`, went into the recipient's.
//
// ── Why "read the name from the profile instead" was not enough ────────────────────────────
//
// It was the first fix proposed, and it would have shipped a lock with no bolt:
//
//   * `profiles/{uid}.name` is written by its owner. A stranger sets their own to "Mama".
//   * `users/{uid}.email` is written by its owner too (`allow read, write: if isOwner`), so
//     "the user document, not the request" moves the forgery one document over.
//   * `groups/{id}` is readable only by MEMBERS, and the person being invited is not one yet —
//     so the recipient's client cannot read the real group name at all.
//
// A NAME is always self-chosen; that is what names are. What a stranger cannot choose is the
// email on their Firebase Auth record, and only the server can read that. So the server stamps
// it onto the request, and the recipient's screen shows the stamp and nothing else.
//
// Pure, with no firebase-admin import, so it can be tested from the app's suite.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_NAME_MAX = exports.SENDER_NAME_MAX = exports.SERVER_STAMP_KEYS = void 0;
exports.trustedEmail = trustedEmail;
exports.senderStamp = senderStamp;
exports.stampedGroupName = stampedGroupName;
/** Keys only the server writes on a request. The create rules refuse them from a client. */
exports.SERVER_STAMP_KEYS = ["sender", "verifiedGroupName"];
exports.SENDER_NAME_MAX = 40;
exports.GROUP_NAME_MAX = 60;
/**
 * The only email this app treats as a person's: the one on their Auth record, or in their ID
 * token. Never one read from a Firestore document a client can write.
 */
function trustedEmail(authEmail) {
    if (typeof authEmail !== "string")
        return null;
    const e = authEmail.trim().toLowerCase();
    return e.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
}
function senderStamp(input) {
    const email = trustedEmail(input.authEmail);
    const raw = typeof input.profileName === "string" ? input.profileName.trim() : "";
    const name = (raw || (email ? email.split("@")[0] : "") || "Someone").slice(0, exports.SENDER_NAME_MAX);
    // Verified means something only about an email that exists.
    return { name, email, emailVerified: input.authVerified === true && email !== null };
}
/** The group's real name, read by the server from the group document. */
function stampedGroupName(raw) {
    if (typeof raw !== "string")
        return null;
    const s = raw.trim().slice(0, exports.GROUP_NAME_MAX);
    return s || null;
}
//# sourceMappingURL=senderIdentity.js.map