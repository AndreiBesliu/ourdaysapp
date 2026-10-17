"use strict";
// functions/src/digestRead.ts
//
// The reads behind the group digest's "Next 7 days". What they decide is in digestEvents.ts, pure;
// this is only the IO.
//
// ── Whose events, and how much of each (16.10.2026) ─────────────────────────────────────────
//
// Until 16.10 both read whole documents. The series query searched the WHOLE database
// (`recurrenceRule != null`, 500 documents, no group): an account with 500 personal events carrying
// any rule at all (`true` sorts before every real one) pushed every group's series out of every
// digest, and padded, ran it out of memory. The dated query brought up to 300 of the group's events
// whole, and any member can pad those (`checklistItems`, `imageUrl` and `hiddenFrom` have no limit in
// the rules). Now every read is the group's own, in pages of ten, only DIGEST_FIELDS and
// DIGEST_VISIBILITY_FIELDS (all bounded by the rules since 17.10.2026), each event reduced as it
// arrives (`compactEvent`, as the reminders do): a padded event costs its few fields.
//
// Neither shape needs an index live lacks, measured on live that day: the series one is equalities
// (`groupId ==`, a frequency `in`), which Firestore serves from single-field indexes; the dated one
// is the composite that already served it. A missing index here would throw, not return less.
//
// ── Two more, from the review of 17.10.2026 ─────────────────────────────────────────────────
//
//   * The days asked about are read apart from the look-back. One ascending read from 30 days back,
//     capped at 300, let a member's past events (or any busy month) fill the cap before the coming
//     week was reached, and the digest told the model "(No upcoming events)".
//   * Who may see each event, as the calendar and the Period Log decide it (`maySee`,
//     `isPendingInvite`): the digest is the caller's own, and it listed back an event hidden from the
//     caller, a surprise to the very person it is kept from. `hiddenFrom` itself is never read: no rule
//     can bound it (a clause took the events rules past their 1000 expressions), and a list of nulls
//     decodes to a hundred times its size. A query of references asks instead which of the group's
//     events hide from the caller (`hiddenFrom array-contains`, no index needed, measured on live).
//     Past its cap the rest is unknown, so only what is the caller's, or names them, gets a line.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDigestEvents = readDigestEvents;
const firestore_1 = require("firebase-admin/firestore");
const recurrenceServer_1 = require("./recurrenceServer");
const remindersCore_1 = require("./remindersCore");
const aiVisibility_1 = require("./aiVisibility");
const digestEvents_1 = require("./digestEvents");
/** References a page, for the read that only asks which events hide from the viewer. */
const REFS_PAGE = 500;
/**
 * One query to its end, page by page, or to one past `cap`: true when it held more than `cap`.
 * Every document fetched counts, a repeated one too (a cursor on a value longer than the 1500 bytes
 * Firestore indexes can repeat a page), so the loop ends whatever the data holds.
 */
async function readPages(base, cap, page, keep) {
    let fetched = 0;
    let last = null;
    for (;;) {
        // One past the cap, to tell "exactly the cap" from "more than it".
        const want = Math.min(page, cap + 1 - fetched);
        const snap = await (last ? base.startAfter(last) : base).limit(want).get();
        for (const d of snap.docs) {
            fetched += 1;
            if (fetched > cap)
                return true;
            keep(d);
        }
        if (snap.size < want)
            return false;
        last = snap.docs[snap.docs.length - 1];
    }
}
/** The group's events dated in the scan window, its series, and which of them hide from the viewer. */
async function readDigestEvents(db, groupId, window, opts = {}) {
    var _a, _b, _c, _d;
    const page = (_a = opts.page) !== null && _a !== void 0 ? _a : digestEvents_1.DIGEST_PAGE;
    const eventScan = (_b = opts.eventScan) !== null && _b !== void 0 ? _b : digestEvents_1.DIGEST_EVENT_SCAN;
    const viewer = opts.viewer;
    const byId = new Map();
    // What `maySee` and `isPendingInvite` read of each event, but `hiddenFrom`: decided at the end, when
    // the read of references has answered. Whether the viewer is among the assignees, not the list.
    const seen = new Map();
    const keep = (d) => {
        const raw = d.data();
        const c = (0, remindersCore_1.compactEvent)(d.id, raw, window.fromDay, window.toDay);
        if (!c)
            return;
        byId.set(d.id, c);
        if (viewer === undefined)
            return;
        // In memory only: nothing here writes an invitation (src/utils/falseUi.test.ts keeps it so).
        const { ownerId, assigneeId, inviteeId, inviteStatus } = raw;
        const assigneeIds = Array.isArray(raw.assigneeIds) && raw.assigneeIds.includes(viewer) ? [viewer] : [];
        seen.set(d.id, { id: d.id, ownerId, assigneeIds, assigneeId, inviteeId, inviteStatus });
    };
    const fields = [...digestEvents_1.DIGEST_FIELDS, ...digestEvents_1.DIGEST_VISIBILITY_FIELDS];
    const events = db.collection("events").where("groupId", "==", groupId);
    // `window.fromDay` is a bare day, and every date of that day sorts at or after it, with a time or
    // without: the split falls where `expandInWindow` takes an event's own day (`date.slice(0, 10)`).
    const dated = (from, op, to) => events
        .where("date", ">=", from)
        .where("date", op, to)
        .orderBy("date", "asc")
        .select(...fields);
    const hidesFromViewer = new Set();
    const [soonCut, earlierCut, seriesCut, hiddenCut] = await Promise.all([
        // The days the digest is about: everything dated here is on a day it lists.
        readPages(dated(window.fromDay, "<=", window.scanTo), eventScan, page, keep),
        // Before them: only what began earlier and is still running (a trip) makes a line here.
        readPages(dated(window.scanFrom, "<", window.fromDay), eventScan, page, keep),
        // A rule with a frequency the app knows: any other is not a series to `expandInWindow` either.
        readPages(events
            .where("recurrenceRule.frequency", "in", [...recurrenceServer_1.FREQUENCIES])
            .orderBy(firestore_1.FieldPath.documentId())
            .select(...fields), (_c = opts.recurringScan) !== null && _c !== void 0 ? _c : digestEvents_1.DIGEST_RECURRING_SCAN, page, keep),
        viewer === undefined
            ? Promise.resolve(false)
            : readPages(events
                .where("hiddenFrom", "array-contains", viewer)
                .orderBy(firestore_1.FieldPath.documentId())
                .select(), (_d = opts.hiddenScan) !== null && _d !== void 0 ? _d : digestEvents_1.DIGEST_HIDDEN_SCAN, REFS_PAGE, (d) => { hidesFromViewer.add(d.id); }),
    ]);
    const hidden = new Set();
    if (viewer !== undefined) {
        for (const [id, ev] of seen) {
            // Past the cap of that read, an event not in it may hide from the viewer all the same: only what
            // is theirs, or names them, is known to be theirs to see.
            const hides = hiddenCut || hidesFromViewer.has(id);
            const asStored = Object.assign(Object.assign({}, ev), { hiddenFrom: hides ? [viewer] : [] });
            if (!(0, aiVisibility_1.maySee)(asStored, viewer) || (0, aiVisibility_1.isPendingInvite)(asStored, viewer))
                hidden.add(id);
        }
    }
    return { docs: [...byId.values()], hidden, truncated: soonCut || earlierCut || seriesCut || hiddenCut };
}
//# sourceMappingURL=digestRead.js.map