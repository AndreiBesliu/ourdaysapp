"use strict";
// functions/src/groupMedia.ts
//
// A group's chat media, for the cascade that deletes the group (deleteGroupCascade in index.ts).
//
// Chat photos and voice notes live in Storage under `chat-images/{groupId}/` and
// `chat-audio/{groupId}/`. Firestore deletes never reach them, and storage.rules makes them
// undeletable by any client — so until 25.09.2026 every deleted group left its media in the bucket
// for good.
//
// ── The guard is the point ─────────────────────────────────────────────────────────────────
//
// Direct chats keep their media under the SAME prefix, `chat-images/{chatId}/`, and a direct chat's
// id is `<uidA>__<uidB>` — made of uids, which are public. Group create does not constrain the
// document id. So a stranger could create `groups/<uidA>__<uidB>`, own it, delete it, and a naive
// sweep would wipe Alice and Bob's private photos. A sweep therefore runs only for an id shaped
// like what `addDoc` makes (web and APK alike: 20 characters of [A-Za-z0-9]) AND with no direct
// chat of that id. Measured on live 25.09: all 5 groups have that shape.
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupMedia = exports.GROUP_ID = void 0;
exports.groupMediaPrefixes = groupMediaPrefixes;
const admin = require("firebase-admin");
/** What `addDoc` makes. A direct chat's `<uid>__<uid>` can never match. */
exports.GROUP_ID = /^[A-Za-z0-9]{20}$/;
/** The group's media folders. The trailing slash is what keeps `abc` from reaching `abcd`. */
function groupMediaPrefixes(id) {
    return [`chat-images/${id}/`, `chat-audio/${id}/`];
}
/** Called through this object, so a test can make it fail and prove the cascade fails closed. */
exports.groupMedia = {
    async sweep(id) {
        const bucket = admin.storage().bucket();
        for (const prefix of groupMediaPrefixes(id)) {
            // `force: true` deletes what it can and then rejects with an ARRAY of errors, not an Error.
            await bucket.deleteFiles({ prefix, force: true }).catch((errs) => {
                const list = Array.isArray(errs) ? errs : [errs];
                throw new Error(`media sweep failed for ${prefix}: ${list.map((e) => { var _a; return String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e); }).join("; ")}`);
            });
        }
    },
};
//# sourceMappingURL=groupMedia.js.map