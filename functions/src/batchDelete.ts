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
// the fields it uses, ten documents a page.
//
// Ten is not "10 MiB at worst": a megabyte stored is not a megabyte decoded. A list of a million nulls
// fits in a document and is about 100 MB once decoded (review of 17.10.2026). So every field a page of
// ten brings is bounded by the rules — a short list of scalars, or a value that is not a list or a map
// (firestore.rules, "What the server reads in bulk") — or written only by the server. Three are not,
// and only the account deletion reads them: a checklist, whose items are maps the rules cannot look
// into; the picture, whose kind the rules do not check (an edit of an event has no room left under the
// 1000 expressions a request may evaluate); and `hiddenFrom`, which no clause fits there either. The
// deletion has the memory for ten of the largest a client can write (DELETION_MEMORY,
// accountDeletion.ts). One a page (the first answer, the same day) held the memory but multiplied the
// round trips by ten, and any member decides how many events a group has.

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
 * Where a `forEachDoc` starts, when it stops before the end, and how it keeps its place (17.10.2026).
 * A read that the caller does not drain matches as many documents at the next attempt as at this one,
 * so without a place kept every attempt starts again from the first page.
 */
export interface Resume {
  /** The id of the last document an earlier run read: this one starts after it. */
  after?: string | null;
  /** Asked before every page; true ends the read there, before that page. */
  stop?: () => boolean;
  /** Called every `saveEvery` pages with the id of the last document read, so that a run killed in
   * between loses at most that many pages. */
  save?: (after: string) => Promise<void>;
  saveEvery?: number;
}

/**
 * Every document a query matches, page by page, bringing only `fields`, for a query that the caller does
 * not drain as it reads. The cursor is the document id, which an equality or array filter can be ordered
 * by without an index. Done, or stopped by `resume.stop` with the id to start after next time.
 */
export async function forEachDoc(
  query: admin.firestore.Query, fields: Field[],
  each: (d: admin.firestore.QueryDocumentSnapshot) => void | Promise<void>,
  resume: Resume = {},
): Promise<{ done: boolean; after: string | null }> {
  const page = pageOf(query, fields, 500);
  let after = resume.after ?? null;
  for (let n = 1; ; n++) {
    if (resume.stop?.()) return { done: false, after };
    let q = page.query.orderBy(FieldPath.documentId()).limit(page.size);
    if (after !== null) q = q.startAfter(after);
    const snap = await q.get();
    for (const d of snap.docs) await each(d);
    if (snap.size < page.size) return { done: true, after: null };
    after = snap.docs[snap.docs.length - 1].id;
    if (resume.save && resume.saveEvery && n % resume.saveEvery === 0) await resume.save(after);
  }
}

/**
 * Delete every doc matching a query, in batches, until exhausted (or a cap, or `stop`, asked before each
 * batch: what is deleted stays deleted, and the next call goes on). Only the references are read.
 */
export async function deleteQueryInBatches(query: admin.firestore.Query, max = 3000, stop: () => boolean = () => false): Promise<number> {
  let deleted = 0;
  while (deleted < max && !stop()) {
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

const projectBucket = (): FileBucket => admin.storage().bucket() as unknown as FileBucket;

export interface FilesOutcome {
  /** False when ANY listing or delete failed, or `stop` ended it early. Never true by default: see below. */
  ok: boolean;
  deleted: number;
  /** Files under the prefixes that were left because something that stays still shows them. */
  kept: number;
}

/** The names of every Storage object under the prefixes, or null when a listing failed. */
export async function listFiles(prefixes: string[], bucketOf: () => FileBucket = projectBucket): Promise<Set<string> | null> {
  let bucket: FileBucket;
  try { bucket = bucketOf(); } catch { return null; }
  const names = new Set<string>();
  for (const prefix of prefixes) {
    try {
      const [files] = await bucket.getFiles({ prefix });
      for (const f of files) names.add(f.name);
    } catch {
      return null;
    }
  }
  return names;
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
 *
 * `stop`, asked before each listing and each twenty deletes, ends it early as not done: whatever was
 * deleted stays deleted, and the next call lists what is left.
 */
export async function deleteFilesExcept(
  prefixes: string[],
  keep: ReadonlySet<string>,
  bucketOf: () => FileBucket = projectBucket,
  stop: () => boolean = () => false,
): Promise<FilesOutcome> {
  const out: FilesOutcome = { ok: true, deleted: 0, kept: 0 };
  let bucket: FileBucket;
  try { bucket = bucketOf(); } catch { return { ...out, ok: false }; }
  for (const prefix of prefixes) {
    if (stop()) return { ...out, ok: false };
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
      if (stop()) return { ...out, ok: false };
      const results = await Promise.allSettled(doomed.slice(i, i + 20).map((f) => f.delete({ ignoreNotFound: true })));
      for (const r of results) {
        if (r.status === "fulfilled") out.deleted++;
        else out.ok = false;
      }
    }
  }
  return out;
}
