// functions/src/batchDelete.ts
//
// The two deletes every cascade needs: the documents a query matches, and the files under a folder.
// Moved out of index.ts on 04.10.2026 so the account deletion (accountDeletion.ts) and the group
// deletion (groupDeletion.ts) use the same ones.

import * as admin from "firebase-admin";

/** Delete every doc matching a query, in batches, until exhausted (or a cap). */
export async function deleteQueryInBatches(query: admin.firestore.Query, max = 3000): Promise<number> {
  let deleted = 0;
  while (deleted < max) {
    const snap = await query.limit(400).get();
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
