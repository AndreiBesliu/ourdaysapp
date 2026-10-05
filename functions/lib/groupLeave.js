"use strict";
// functions/src/groupLeave.ts
//
// When somebody stops being a member of a group, they come off its events that are still to come
// (Andrei, 05.10.2026; what and why in leaverCore.ts). Server-side, on the group document, because
// that is the one place every way out goes through: leaving (web, and the installed APK whose code
// cannot change), the owner taking somebody off, account deletion. A client could not do it
// anyway: once out, the leaver may no longer write the group's events, and the owner may not
// delete somebody else's RSVP.
Object.defineProperty(exports, "__esModule", { value: true });
exports.onGroupMembersChanged = void 0;
exports.takeLeaversOffEvents = takeLeaversOffEvents;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const firestore_2 = require("firebase-functions/v2/firestore");
const leaverCore_1 = require("./leaverCore");
const errorLog_1 = require("./errorLog");
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && !!x) : []);
/**
 * Takes everybody who is no longer a member off the group's events still to come. Reads the group
 * NOW, so somebody who came back in the meantime stays, and a run that failed is made good by the
 * next. Null when there is nothing to judge against: the group is gone (deleting a group changes
 * nothing here, by decision) or has no member list, which would make everybody a leaver.
 */
async function takeLeaversOffEvents(groupId, nowMs = Date.now()) {
    const db = admin.firestore();
    const groupRef = db.doc(`groups/${groupId}`);
    const membersOf = (g) => { var _a; return new Set(g.exists ? strList((_a = g.data()) === null || _a === void 0 ? void 0 : _a.members) : []); };
    const members = membersOf(await groupRef.get());
    if (!members.size)
        return null;
    const today = (0, leaverCore_1.earliestTodayOf)(nowMs);
    const out = { events: 0, changed: 0, unassigned: 0, rsvpsRemoved: 0 };
    const snap = await db.collection("events").where("groupId", "==", groupId)
        .select("date", "endDayOffset", "recurrenceRule", "assigneeIds", "assigneeId", "rsvps")
        .get();
    out.events = snap.size;
    for (const d of snap.docs) {
        if (!(0, leaverCore_1.leaverPlan)(d.data(), members, today))
            continue;
        // The event AND the group read again, in one transaction with the write: an edit made in between
        // is not undone, an event deleted or moved to another calendar in between is left alone, and
        // somebody let back in while this runs is judged a member.
        const written = await db.runTransaction(async (tx) => {
            var _a;
            const [fresh, group] = await Promise.all([tx.get(d.ref), tx.get(groupRef)]);
            const now = membersOf(group);
            const plan = fresh.exists && fresh.get("groupId") === groupId && now.size
                ? (0, leaverCore_1.leaverPlan)((_a = fresh.data()) !== null && _a !== void 0 ? _a : {}, now, today)
                : null;
            if (!plan)
                return null;
            const fields = [];
            if (plan.unassign.length)
                fields.push("assigneeIds", firestore_1.FieldValue.arrayRemove(...plan.unassign));
            if ("assigneeId" in plan)
                fields.push("assigneeId", plan.assigneeId);
            // By path: a key is a uid, and only that person's answer goes, never the map.
            for (const u of plan.rsvps)
                fields.push(new firestore_1.FieldPath("rsvps", u), firestore_1.FieldValue.delete());
            tx.update(fresh.ref, fields[0], fields[1], ...fields.slice(2));
            return plan;
        });
        // Counted once the transaction is through: its body may run more than once.
        if (written) {
            out.changed += 1;
            out.unassigned += written.unassign.length;
            out.rsvpsRemoved += written.rsvps.length;
        }
    }
    return out;
}
/**
 * Fires on every write to a group, a chat message's preview included, and does nothing unless the
 * member list lost somebody. Retried by the platform when it throws: the sweep is the same whatever
 * the number of runs.
 */
exports.onGroupMembersChanged = (0, firestore_2.onDocumentUpdated)({ document: "groups/{groupId}", retry: true }, async (event) => {
    var _a, _b, _c, _d;
    const after = new Set(strList((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data()) === null || _b === void 0 ? void 0 : _b.members));
    if (!strList((_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.before.data()) === null || _d === void 0 ? void 0 : _d.members).some((u) => !after.has(u)))
        return;
    const groupId = event.params.groupId;
    try {
        const r = await takeLeaversOffEvents(groupId);
        console.log("LEAVERS_OFF_EVENTS", JSON.stringify(Object.assign({ groupId }, (r !== null && r !== void 0 ? r : { skipped: true }))));
    }
    catch (err) {
        // The group in the message: with retries, one stuck group would otherwise be a run of identical rows.
        await (0, errorLog_1.logServerError)(`${(err === null || err === void 0 ? void 0 : err.message) || "events not cleaned"} (group ${groupId})`, "groupLeave:takeLeaversOffEvents", {
            stack: err === null || err === void 0 ? void 0 : err.stack,
        });
        throw err;
    }
});
//# sourceMappingURL=groupLeave.js.map