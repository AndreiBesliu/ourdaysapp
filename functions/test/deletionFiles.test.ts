// functions/test/deletionFiles.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// k-files.test.ts (mutation killers, label m-deletion, commit 5f8f0c2)
//
// listFiles and deleteFilesExcept (functions/src/batchDelete.ts) on a bucket of the test's own, so a
// listing can fail and a stop can come at a chosen moment:
//   1. listFiles is null when ANY listing fails: the keep list only ever names a file that exists, so a
//      partial listing would let the deletion take a file that something that stays still shows;
//   2. deleteFilesExcept, asked to stop, ends as NOT done (ok false), before a listing and between two
//      batches of twenty deletes, and makes no listing and no delete after the stop.

import { beforeAll, describe, expect, it } from 'vitest';

let bd: typeof import('../src/batchDelete');
beforeAll(async () => { bd = await import('../src/batchDelete'); });

/** Files per prefix, deleted for real (a second listing no longer sees them); every listing recorded. */
function fakeBucket(files: Record<string, string[]>, failOn: string[] = []) {
  const live = new Map(Object.entries(files).map(([p, names]) => [p, new Set(names)]));
  const listed: string[] = [];
  const deleted: string[] = [];
  const bucket = {
    getFiles: async ({ prefix }: { prefix: string }) => {
      listed.push(prefix);
      if (failOn.includes(prefix)) throw new Error(`listing ${prefix} denied`);
      const names = [...(live.get(prefix) ?? [])];
      return [names.map((name) => ({ name, delete: async () => { live.get(prefix)?.delete(name); deleted.push(name); } }))];
    },
  };
  return { of: () => bucket as never, listed, deleted };
}

describe('listFiles', () => {
  it('is null when any listing fails, never the names the other listings found', async () => {
    const files = { 'a/': ['a/1'], 'b/': ['b/1', 'b/2'], 'c/': ['c/1'] };
    const all = await bd.listFiles(['a/', 'b/', 'c/'], fakeBucket(files).of);
    expect([...(all ?? [])].sort()).toEqual(['a/1', 'b/1', 'b/2', 'c/1']);
    for (const bad of ['a/', 'b/', 'c/']) {
      expect(await bd.listFiles(['a/', 'b/', 'c/'], fakeBucket(files, [bad]).of), `listing ${bad} failed`).toBeNull();
    }
  });
});

describe('deleteFilesExcept, asked to stop', () => {
  it('before the first listing: lists nothing, deletes nothing, and is not done', async () => {
    const b = fakeBucket({ 'a/': ['a/1'], 'b/': ['b/1'] });
    const out = await bd.deleteFilesExcept(['a/', 'b/'], new Set(), b.of, () => true);
    expect(out.ok).toBe(false);
    expect(b.listed).toEqual([]);
    expect(b.deleted).toEqual([]);
  });

  it('between two listings: the next listing is not made, and it is not done', async () => {
    // a/ holds only a kept file, so nothing there is deleted: only the stop before b/ can end it.
    const b = fakeBucket({ 'a/': ['a/keep'], 'b/': ['b/1'] });
    let asked = 0;
    const out = await bd.deleteFilesExcept(['a/', 'b/'], new Set(['a/keep']), b.of, () => ++asked > 1);
    expect(out).toMatchObject({ ok: false, deleted: 0, kept: 1 });
    expect(b.listed).toEqual(['a/']);
    expect(b.deleted).toEqual([]);
  });

  it('between two batches of twenty deletes: the rest waits for the next call, which finishes', async () => {
    const names = Array.from({ length: 45 }, (_, i) => `a/${String(i).padStart(2, '0')}`);
    const b = fakeBucket({ 'a/': names });
    const first = await bd.deleteFilesExcept(['a/'], new Set(), b.of, () => b.deleted.length >= 20);
    expect(first).toMatchObject({ ok: false, deleted: 20 });
    expect(b.deleted).toHaveLength(20);
    const second = await bd.deleteFilesExcept(['a/'], new Set(), b.of, () => false);
    expect(second).toEqual({ ok: true, deleted: 25, kept: 0 });
    expect([...b.deleted].sort()).toEqual(names);
  });
});
