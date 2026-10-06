// src/utils/documentIdFirst.test.ts
//
// An object built from a Firestore document carries the DOCUMENT's id, never a field of it
// (06.10.2026). `{ id: d.id, ...d.data() }` spreads the data after the id, so a document with a
// field called `id` — which a member can write on most shared collections — replaced its own id:
// the screen then wrote or deleted another document, and a map there crashed every list that
// used it as a React key. liveQuery/liveDoc build `{ ...data, id }`; this keeps the rest of the
// app to the same order. (Measured on live that day: no document in 33 collections has the field.)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** `{ id: <x>.id, ...<x>.data() }`, with or without a cast around the data. */
const ID_THEN_DATA = /\{\s*id:\s*[\w.]+\.id\s*,\s*\.\.\.\(?\s*[\w.]+\.data\(\)/;

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    // The Warlord game is a submodule with a repository of its own.
    if (statSync(p).isDirectory()) { if (f !== 'warlord' && f !== 'node_modules') sources(p, out); continue; }
    if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe('the id is the document’s', () => {
  it('the pattern is recognised (a scan that matches nothing proves nothing)', () => {
    expect(ID_THEN_DATA.test('docs.map((d) => ({ id: d.id, ...d.data() }))')).toBe(true);
    expect(ID_THEN_DATA.test('({ id: snap.id, ...(snap.data() as T) })')).toBe(true);
    expect(ID_THEN_DATA.test('({ ...d.data(), id: d.id })')).toBe(false);
  });

  it('no file in the app spreads a document over its own id', () => {
    const found = sources('src').filter((p) => ID_THEN_DATA.test(readFileSync(p, 'utf8')));
    expect(found).toEqual([]);
  });
});
