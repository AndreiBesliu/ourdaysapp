"use strict";
// functions/src/groupDeletion.ts
//
// What deleting a group takes with it. The body of the `deleteGroupCascade` callable until
// 04.10.2026, moved here unchanged so the account deletion can use it too: an owner who deletes
// their account while alone in a group takes the group with them (Andrei, 04.10.2026). The callable
// keeps the checks — signed in, a document id, the owner — and the reasons stay with the code.
//
// Note what this does NOT do: other members' events are RE-PARENTED to personal, never deleted.
// Losing the group should not lose their data, and the owner was never entitled to delete it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroupData = deleteGroupData;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const groupMedia_1 = require("./groupMedia");
const errorLog_1 = require("./errorLog");
const batchDelete_1 = require("./batchDelete");
/**
 * Delete `groupId`, owned by `ownerUid`. The owner's own events in it are deleted unless their id is
 * in `keep`; everybody else's become personal. Every step is idempotent, so a call that stops part
 * way can be repeated and finishes the job.
 */
async function deleteGroupData(groupId, ownerUid, keep) {
    var _a;
    const db = admin.firestore();
    const groupRef = db.doc(`groups/${groupId}`);
    let deleted = 0;
    let freed = 0;
    // No cursor is needed: every document this loop touches stops matching `groupId == groupId`
    // (it is either deleted or re-parented to null), so the same query drains itself. The bound is
    // there so a write that silently fails cannot turn that into a spin — and reaching it now STOPS
    // the cascade before the group goes (25.09.2026). It used to carry on after 40 pages and delete
    // the group anyway, leaving every event past 12,000 pointing at a group that no longer existed.
    // Every page is committed, so a retry picks up where this one stopped.
    for (let page = 0;; page++) {
        const snap = await db.collection("events").where("groupId", "==", groupId).limit(300).get();
        if (snap.empty)
            break;
        if (page >= 200) {
            throw new https_1.HttpsError("deadline-exceeded", "Still clearing the group's events — try again.");
        }
        const batch = db.batch();
        for (const d of snap.docs) {
            const ev = d.data() || {};
            if (ev.ownerId === ownerUid && !keep.has(d.id)) {
                batch.delete(d.ref);
                deleted++;
            }
            else {
                batch.update(d.ref, { groupId: null, sharedWithFamily: false });
                freed++;
            }
        }
        await batch.commit();
    }
    const invites = await (0, batchDelete_1.deleteQueryInBatches)(db.collection("group_invites").where("groupId", "==", groupId));
    // Its links, revoked rather than deleted, so their creators' lists still explain them. A redeem
    // would answer "group not found" anyway; this keeps "listMyInviteLinks" honest.
    let links = 0;
    const linkSnap = await db.collection("invite_links").where("groupId", "==", groupId).get();
    for (let i = 0; i < linkSnap.docs.length; i += 400) {
        const batch = db.batch();
        for (const d of linkSnap.docs.slice(i, i + 400)) {
            if (((_a = d.data()) === null || _a === void 0 ? void 0 : _a.revoked) === true)
                continue;
            batch.update(d.ref, { revoked: true });
            links++;
        }
        await batch.commit();
    }
    // Its chat media, BEFORE the group goes: if the sweep fails, the group still exists and the owner
    // can retry — every step above is idempotent — whereas once the document is gone a retry answers
    // "not found" for ever. Guarded; see groupMedia.ts for why a naive sweep would be a way to wipe
    // somebody's direct messages.
    let media = "skipped";
    if (groupMedia_1.GROUP_ID.test(groupId) && !(await db.doc(`chats/${groupId}`).get()).exists) {
        try {
            await groupMedia_1.groupMedia.sweep(groupId);
            media = "deleted";
        }
        catch (err) {
            // Awaited: work left running after the response is not guaranteed CPU on 2nd-gen functions.
            await (0, errorLog_1.logServerError)(String((err === null || err === void 0 ? void 0 : err.message) || err), "deleteGroupCascade.media", { uid: ownerUid, stack: err === null || err === void 0 ? void 0 : err.stack });
            throw new https_1.HttpsError("unavailable", "The group's photos could not be removed yet. Try again.");
        }
    }
    else {
        await (0, errorLog_1.logServerError)(`media sweep skipped: group id is not an auto-id or names a direct chat`, "deleteGroupCascade.media", { uid: ownerUid });
    }
    // The chat lives UNDER the group document, so deleting the parent alone would leave it
    // unreachable and still billed for. `recursiveDelete` takes the messages, the typing flags and the
    // group itself, with no cap — the batch loop it replaces stopped at about 3,200 messages and then
    // deleted the group anyway, orphaning the rest under a parent nobody could read through.
    const messages = (await db.collection(`groups/${groupId}/messages`).count().get()).data().count;
    await db.recursiveDelete(groupRef);
    return { deleted, freed, invites, messages, media, links };
}
//# sourceMappingURL=groupDeletion.js.map