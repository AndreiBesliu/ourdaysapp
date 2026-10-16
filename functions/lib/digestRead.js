"use strict";
// functions/src/digestRead.ts
//
// The two reads behind the group digest's "Next 7 days". What they decide is in digestEvents.ts,
// pure; this is only the IO.
//
// ── Whose events, and how much of each (16.10.2026) ─────────────────────────────────────────
//
// Until 16.10 both read whole documents. The series query searched the WHOLE database
// (`recurrenceRule != null`, 500 documents, no group): an account with 500 personal events carrying
// any rule at all (`true` sorts before every real one) pushed every group's series out of every
// digest, and padded, ran it out of memory. The dated query brought up to 300 of the group's events
// whole, and any member can pad those (`checklistItems`, `imageUrl` and `hiddenFrom` have no limit in
// the rules). Now both are the group's own, read in pages of ten, only DIGEST_FIELDS, each event
// reduced as it arrives (`compactEvent`, as the reminders do): a padded event costs its few fields.
//
// Neither shape needs an index live lacks, measured on live that day: the series one is equalities
// (`groupId ==`, a frequency `in`), which Firestore serves from single-field indexes; the dated one
// is the composite that already served it. A missing index here would throw, not return less.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDigestEvents = readDigestEvents;
const firestore_1 = require("firebase-admin/firestore");
const recurrenceServer_1 = require("./recurrenceServer");
const remindersCore_1 = require("./remindersCore");
const digestEvents_1 = require("./digestEvents");
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
/** The group's events dated in the scan window, and its series, both read as above. */
async function readDigestEvents(db, groupId, window, opts = {}) {
    var _a, _b, _c;
    const page = (_a = opts.page) !== null && _a !== void 0 ? _a : digestEvents_1.DIGEST_PAGE;
    const byId = new Map();
    const keep = (d) => {
        const c = (0, remindersCore_1.compactEvent)(d.id, d.data(), window.fromDay, window.toDay);
        if (c)
            byId.set(d.id, c);
    };
    const events = db.collection("events").where("groupId", "==", groupId);
    const [datedCut, seriesCut] = await Promise.all([
        readPages(events
            .where("date", ">=", window.scanFrom)
            .where("date", "<=", window.scanTo)
            .orderBy("date", "asc")
            .select(...digestEvents_1.DIGEST_FIELDS), (_b = opts.eventScan) !== null && _b !== void 0 ? _b : digestEvents_1.DIGEST_EVENT_SCAN, page, keep),
        // A rule with a frequency the app knows: any other is not a series to `expandInWindow` either.
        readPages(events
            .where("recurrenceRule.frequency", "in", [...recurrenceServer_1.FREQUENCIES])
            .orderBy(firestore_1.FieldPath.documentId())
            .select(...digestEvents_1.DIGEST_FIELDS), (_c = opts.recurringScan) !== null && _c !== void 0 ? _c : digestEvents_1.DIGEST_RECURRING_SCAN, page, keep),
    ]);
    return { docs: [...byId.values()], truncated: datedCut || seriesCut };
}
//# sourceMappingURL=digestRead.js.map