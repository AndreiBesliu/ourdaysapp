"use strict";
// functions/src/aiSources.ts
// Reading, for one caller, only what that caller could already have seen.
//
// Everything here runs on the Admin SDK, which ignores `firestore.rules` completely. So each
// fetcher below re-derives, in code, the rule it mirrors. That is the whole job of this file,
// and it is why it takes a `Scope` — a branded value with exactly one constructor — instead of
// a `uid` it would have to trust.
//
// Two rules that apply to every fetcher:
//   • NEVER `collectionGroup`. On the Admin SDK `db.collectionGroup('messages')` returns every
//     group in the database and produces a plausible answer rather than an error. It is a
//     one-line catastrophe, and the tempting precedent already exists in this codebase behind
//     an admin gate.
//   • Be NARROWER than the rules, never wider. Where a rule is loose, mirror the intent.
Object.defineProperty(exports, "__esModule", { value: true });
exports.maySee = maySee;
exports.isPendingInvite = isPendingInvite;
exports.fetchEvents = fetchEvents;
exports.fetchChat = fetchChat;
exports.fetchAssets = fetchAssets;
exports.fetchExpenses = fetchExpenses;
const admin = require("firebase-admin");
const aiScope_1 = require("./aiScope");
const recurrenceServer_1 = require("./recurrenceServer");
/**
 * THE visibility invariant for one event, written from scratch.
 *
 * NOT ported from `CalendarHome`: the client's filter is wrapped in
 * `activeGroupId !== 'personal'`, a UI variable the server does not have. Ported literally
 * with the caller "in personal view", the condition short-circuits to false and every event a
 * member deliberately hid lands in the cross-group context.
 */
function maySee(ev, uid) {
    if (ev.ownerId === uid)
        return true; // personal events carry `visibleTo: []`
    const assignees = Array.isArray(ev.assigneeIds) ? ev.assigneeIds : [];
    if (assignees.includes(uid))
        return true;
    if (ev.assigneeId === uid || ev.inviteeId === uid)
        return true; // assignment IS a read grant
    if (!Array.isArray(ev.visibleTo))
        return true; // legacy / unset = unrestricted
    return ev.visibleTo.includes(uid);
}
/** A pending invitation is hidden in the app until it is answered; mirror that. */
function isPendingInvite(ev, uid) {
    return ev.inviteeId === uid && ev.inviteStatus === "pending";
}
/**
 * Events and tasks — the same collection; a task is an event with `isTask: true`.
 *
 * Four branches, deduplicated by document id. The `sharedWithFamily == true` branch that the
 * read rule used to carry is DELIBERATELY ABSENT: it granted any signed-in account, and being
 * narrower than the rules is always safe. (That branch has since been removed from the rules
 * too, but this file must not depend on that having happened.)
 */
async function fetchEvents(scope, period, budget) {
    const db = admin.firestore();
    const col = db.collection("events");
    const uid = scope.uid;
    // Recurring parents can start long before the window, so the lower bound reaches back by the
    // client's own horizon. Two bounded passes, never one unbounded scan.
    const shortFrom = new Date(Date.parse(period.from) - (0, recurrenceServer_1.lookbackMsFor)("weekly")).toISOString();
    const longFrom = new Date(Date.parse(period.from) - (0, recurrenceServer_1.lookbackMsFor)("yearly")).toISOString();
    const perQuery = Math.max(20, Math.floor(budget / Math.max(1, 3 + scope.groupIds.length)));
    const queries = [
        col.where("ownerId", "==", uid).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery),
        col.where("assigneeIds", "array-contains", uid).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery),
        col.where("assigneeId", "==", uid).where("date", ">=", shortFrom).where("date", "<=", period.to).limit(perQuery),
        col.where("inviteeId", "==", uid).where("date", ">=", shortFrom).where("date", "<=", period.to).limit(perQuery),
    ];
    for (const g of scope.groupIds) {
        queries.push(col.where("groupId", "==", g).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery));
    }
    const snaps = await Promise.all(queries.map((q) => q.get().catch(() => null)));
    let complete = true;
    const byId = new Map();
    for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i];
        if (!snap) {
            complete = false;
            continue;
        }
        if (snap.size >= perQuery)
            complete = false;
        for (const doc of snap.docs) {
            const data = doc.data();
            byId.set(doc.id, Object.assign({ id: doc.id }, data));
        }
    }
    const visible = [...byId.values()].filter((ev) => maySee(ev, uid) && !isPendingInvite(ev, uid));
    const occurrences = (0, recurrenceServer_1.expandInWindow)(visible, period.fromDay, period.toDay);
    const items = occurrences.map((occ) => {
        const ev = occ.source;
        const gid = typeof ev.groupId === "string" ? ev.groupId : null;
        // A group the caller has LEFT still yields events where they are a named assignee — the
        // read rule has no membership test on that branch and leaving clears only `members`. Those
        // stay visible in the product, so they stay here; but they are labelled by CODE and never
        // by name, because reading `groups/{id}` for a name would be a read the caller cannot make.
        const outOfScope = !!gid && !(0, aiScope_1.inScope)(scope, gid);
        return {
            id: occ.virtual ? `${ev.id}_${occ.day}` : ev.id,
            day: occ.day,
            title: typeof ev.title === "string" ? ev.title : "",
            isTask: ev.isTask === true,
            scopeLabel: !gid ? "personal" : outOfScope ? "former-group" : scope.groupNames[gid] || "Group",
            outOfScope,
            virtual: occ.virtual,
        };
    });
    return { items, complete };
}
/**
 * Group chat, one query PER GROUP. Never `collectionGroup` — see the file header.
 *
 * Soft-deleted messages are skipped entirely, timestamp included: the delete blanks `text` and
 * `imageUrl` but keeps the document, so ingesting the husk yields "X said something at 14:03"
 * about a message somebody deliberately retracted.
 */
async function fetchChat(scope, period, budget) {
    const db = admin.firestore();
    if (scope.groupIds.length === 0)
        return { items: [], complete: true };
    const perGroup = Math.max(10, Math.floor(budget / scope.groupIds.length));
    const from = admin.firestore.Timestamp.fromDate(new Date(period.from));
    const to = admin.firestore.Timestamp.fromDate(new Date(period.to));
    const snaps = await Promise.all(scope.groupIds.map((g) => db.collection(`groups/${g}/messages`)
        .where("createdAt", ">=", from)
        .where("createdAt", "<=", to)
        .orderBy("createdAt", "asc")
        .limit(perGroup)
        .get()
        .then((s) => ({ g, s }))
        .catch(() => null)));
    let complete = true;
    const items = [];
    for (const entry of snaps) {
        if (!entry) {
            complete = false;
            continue;
        }
        if (entry.s.size >= perGroup)
            complete = false;
        for (const doc of entry.s.docs) {
            const d = doc.data();
            if (d.isDeleted === true)
                continue;
            const created = d.createdAt;
            const when = created && typeof created.toDate === "function" ? created.toDate() : null;
            if (!when)
                continue;
            items.push({
                groupId: entry.g,
                senderId: typeof d.senderId === "string" ? d.senderId : "",
                day: when.toISOString().slice(0, 10),
                text: typeof d.text === "string" ? d.text : "",
            });
        }
    }
    return { items, complete };
}
/** The caller's own inventory, and nothing else. `sharedWithFamily` on an asset is inert —
 *  the assets rule is owner-only and never refers to it. */
async function fetchAssets(scope, budget) {
    const db = admin.firestore();
    const limit = Math.max(20, Math.min(200, budget));
    const snap = await db.collection("assets").where("ownerId", "==", scope.uid).limit(limit).get();
    return {
        items: snap.docs.map((d) => ({
            id: d.id,
            name: typeof d.data().name === "string" ? d.data().name : "",
        })),
        complete: snap.size < limit,
    };
}
/**
 * Expenses are NOT a source, and this stub says why in code rather than staying silent.
 *
 * `expenses` appears nowhere in `firestore.rules` and there is no catch-all, so the collection
 * is denied by default — the app's own client cannot read it either. The document shape is
 * `{amount, description, paidBy, createdAt}`: no `groupId`, no `ownerId`. A Cloud Function
 * ingesting it would read EVERY expense in the database, with no field to filter on.
 *
 * The server returns a CODE; the client renders the sentence through `t()`. The difference
 * between an absence and a lie is that the absence is stated.
 */
async function fetchExpenses() {
    return { items: [], complete: true, unavailable: "no-scoping-field" };
}
//# sourceMappingURL=aiSources.js.map