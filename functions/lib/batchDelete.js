"use strict";
// functions/src/batchDelete.ts
//
// The two deletes every cascade needs: the documents a query matches, and the files under a folder.
// Moved out of index.ts on 04.10.2026 so the account deletion (accountDeletion.ts) and the group
// deletion (groupDeletion.ts) use the same ones. And, since 15.10.2026, how the two read.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONE_A_PAGE = exports.FIELD_PAGE = void 0;
exports.pageOf = pageOf;
exports.forEachDoc = forEachDoc;
exports.deleteQueryInBatches = deleteQueryInBatches;
exports.deleteFilesExcept = deleteFilesExcept;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
// ── What a page brings ───────────────────────────────────────────────────────────────────────
//
// Until 15.10.2026 both cascades read every document whole, in pages of 300 to 500. Anybody can pad a
// document to 1 MiB, and some of what they read is written by other people: a friend request or an
// invitation by anybody signed in (their rules type no field), a group event's checklist, picture and
// `hiddenFrom` by every member. A few hundred of those ran a deletion out of its 256 MiB at every
// attempt, after its first steps had run, so an account could not be deleted, from Settings or from
// Admin, nor a group by its owner. Now a read brings only the references, in the pages it had, or only
// the fields it uses, ten documents a page.
//
// Ten is not "10 MiB at worst": a megabyte stored is not a megabyte decoded. A list of a million nulls
// fits in a document and is about 100 MB once decoded (review of 17.10.2026). So every field a page of
// ten brings is bounded by the rules — a short list of scalars, or a value that is not a list or a map
// (firestore.rules, "What the server reads in bulk") — or written only by the server. Three are not,
// and a read that brings one brings one document a page, the most one document can decode to, which
// the deletion has the memory for: a checklist, whose items are maps the rules cannot look into; the
// picture, whose kind the rules do not check (an edit of an event has no room left under the 1000
// expressions a request may evaluate); and `hiddenFrom`, which the rules bound on a group's events but
// not on a personal one, and the deletion's hand-over reads the person's own events of both kinds.
/** How many documents one page may bring when it brings field values. */
exports.FIELD_PAGE = 10;
/** Fields whose decoded size the rules do not bound: a read that brings one brings one document a page. */
exports.ONE_A_PAGE = new Set(["checklistItems", "hiddenFrom", "imageUrl"]);
/**
 * `query` bringing only `fields`, or only the references when there are none, with the page size that
 * goes with that: FIELD_PAGE, one for a field in ONE_A_PAGE, or `refsPage`. One place for the rule, so
 * that no read brings fields in a page sized for references.
 */
function pageOf(query, fields, refsPage) {
    if (fields.length === 0)
        return { query: query.select(), size: refsPage };
    const one = fields.some((f) => typeof f === "string" && exports.ONE_A_PAGE.has(f));
    return { query: query.select(...fields), size: one ? 1 : exports.FIELD_PAGE };
}
/**
 * Every document a query matches, page by page, bringing only `fields`, for a query that the caller does
 * not drain as it reads. The cursor is the document id, which an equality or array filter can be ordered
 * by without an index.
 */
async function forEachDoc(query, fields, each) {
    const page = pageOf(query, fields, 500);
    let last = null;
    for (;;) {
        let q = page.query.orderBy(firestore_1.FieldPath.documentId()).limit(page.size);
        if (last)
            q = q.startAfter(last);
        const snap = await q.get();
        for (const d of snap.docs)
            await each(d);
        if (snap.size < page.size)
            return;
        last = snap.docs[snap.docs.length - 1];
    }
}
/** Delete every doc matching a query, in batches, until exhausted (or a cap). Only the references are read. */
async function deleteQueryInBatches(query, max = 3000) {
    let deleted = 0;
    while (deleted < max) {
        const snap = await query.select().limit(400).get();
        if (snap.empty)
            break;
        const batch = admin.firestore().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400)
            break;
    }
    return deleted;
}
/**
 * Delete every Storage object under the prefixes except those named in `keep`, and SAY whether it
 * worked.
 *
 * Its predecessor, `deleteStoragePrefixes`, swallowed each prefix's failure and returned true
 * regardless until 25.09.2026, so a deletion reported its files gone when nothing had been deleted.
 * This one is listed and deleted file by file, because some files under a person's folder are not
 * theirs to take any more: a group event they attached a photo to stays in the group, and so does a
 * wallet card they gave away (accountDeletion.ts).
 */
async function deleteFilesExcept(prefixes, keep, bucketOf = () => admin.storage().bucket()) {
    const out = { ok: true, deleted: 0, kept: 0 };
    let bucket;
    try {
        bucket = bucketOf();
    }
    catch (_a) {
        return Object.assign(Object.assign({}, out), { ok: false });
    }
    for (const prefix of prefixes) {
        let files;
        try {
            [files] = await bucket.getFiles({ prefix });
        }
        catch (_b) {
            out.ok = false;
            continue;
        }
        const doomed = files.filter((f) => {
            if (keep.has(f.name)) {
                out.kept++;
                return false;
            }
            return true;
        });
        // Twenty at a time: one person's folder can hold hundreds of photos.
        for (let i = 0; i < doomed.length; i += 20) {
            const results = await Promise.allSettled(doomed.slice(i, i + 20).map((f) => f.delete({ ignoreNotFound: true })));
            for (const r of results) {
                if (r.status === "fulfilled")
                    out.deleted++;
                else
                    out.ok = false;
            }
        }
    }
    return out;
}
//# sourceMappingURL=batchDelete.js.map