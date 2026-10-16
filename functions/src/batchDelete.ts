// functions/src/batchDelete.ts
//
// The two deletes every cascade needs: the documents a query matches, and the files under a folder.
// Moved out of index.ts on 04.10.2026 so the account deletion (accountDeletion.ts) and the group
// deletion (groupDeletion.ts) use the same ones. And, since 15.10.2026, how the two read.

import * as admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";

// ── What a page brings ───────────────────────────────────────────────────────────────────────
//
// Until 15.10.2026 both cascades read every document whole, in pages of 300 to 500. Anybody can pad a
// document to 1 MiB, and some of what they read is written by other people: a friend request or an
// invitation by anybody signed in (their rules type no field), a group event's checklist, picture and
// `hiddenFrom` by every member. A few hundred of those ran a deletion out of its 256 MiB at every
// attempt, after its first steps had run, so an account could not be deleted, from Settings or from
// Admin, nor a group by its owner. Now a read brings only the references, in the pages it had, or only
// the fields it uses, ten documents a page: 10 MiB at worst.

/** How many documents one page may bring when it brings field values. */
export const FIELD_PAGE = 10;

export type Field = string | FieldPath;

/**
 * `query` bringing only `fields`, or only the references when there are none, with the page size that
 * goes with that: FIELD_PAGE, or `refsPage`. One place for the rule, so that no read brings fields in a
 * page sized for references.
 */
export function pageOf(query: admin.firestore.Query, fields: Field[], refsPage: number): { query: admin.firestore.Query; size: number } {
  return fields.length > 0
    ? { query: query.select(...fields), size: FIELD_PAGE }
    : { query: query.select(), size: refsPage };
}

/**
 * Every document a query matches, page by page, bringing only `fields`, for a query that the caller does
 * not drain as it reads. The cursor is the document id, which an equality or array filter can be ordered
 * by without an index.
 */
export async function forEachDoc(
  query: admin.firestore.Query, fields: Field[],
  each: (d: admin.firestore.QueryDocumentSnapshot) => void | Promise<void>,
): Promise<void> {
  const page = pageOf(query, fields, 500);
  let last: admin.firestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = page.query.orderBy(FieldPath.documentId()).limit(page.size);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) await each(d);
    if (snap.size < page.size) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

/** Delete every doc matching a query, in batches, until exhausted (or a cap). Only the references are read. */
export async function deleteQueryInBatches(query: admin.firestore.Query, max = 3000): Promise<number> {
  let deleted = 0;
  while (deleted < max) {
    const snap = await query.select().limit(400).get();
    if (snap.empty) break;
    const batch = admin.firestore().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  return deleted;
}

/** What `deleteFilesExcept` needs from a bucket, so a test can hand it one that fails. */
export interface FileBucket {
  getFiles(o: { prefix: string }): Promise<[Array<{ name: string; delete(o: { ignoreNotFound: boolean }): Promise<unknown> }>]>;
}

export interface FilesOutcome {
  /** False when ANY listing or delete failed. Never true by default: see below. */
  ok: boolean;
  deleted: number;
  /** Files under the prefixes that were left because something that stays still shows them. */
  kept: number;
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
export async function deleteFilesExcept(
  prefixes: string[],
  keep: ReadonlySet<string>,
  bucketOf: () => FileBucket = () => admin.storage().bucket() as unknown as FileBucket,
): Promise<FilesOutcome> {
  const out: FilesOutcome = { ok: true, deleted: 0, kept: 0 };
  let bucket: FileBucket;
  try { bucket = bucketOf(); } catch { return { ...out, ok: false }; }
  for (const prefix of prefixes) {
    let files: Awaited<ReturnType<FileBucket["getFiles"]>>[0];
    try {
      [files] = await bucket.getFiles({ prefix });
    } catch {
      out.ok = false;
      continue;
    }
    const doomed = files.filter((f) => {
      if (keep.has(f.name)) { out.kept++; return false; }
      return true;
    });
    // Twenty at a time: one person's folder can hold hundreds of photos.
    for (let i = 0; i < doomed.length; i += 20) {
      const results = await Promise.allSettled(doomed.slice(i, i + 20).map((f) => f.delete({ ignoreNotFound: true })));
      for (const r of results) {
        if (r.status === "fulfilled") out.deleted++;
        else out.ok = false;
      }
    }
  }
  return out;
}
