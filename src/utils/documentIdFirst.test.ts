// src/utils/documentIdFirst.test.ts
//
// An object built from a Firestore document carries the DOCUMENT's id, never a field of it
// (06.10.2026). `{ id: d.id, ...d.data() }` spreads the data after the id, so a document with a
// field called `id` — which a member can write on most shared collections — replaced its own id:
// the screen then wrote or deleted another document, and a map there crashed every list that
// used it as a React key. liveQuery/liveDoc build `{ ...data, id }`; this keeps the rest of the
// app to the same order. (Measured on live that day: no document in 33 collections has the field.)
//
// The server too, since 29.10.2026. The scan read only `src/` and only the one-step form, and the
// functions had eight sites in the two-step one (`const e = d.data(); { id: d.id, ...e }`). The
// one that mattered was the assistant's event sources, where the expansion orders a day's events by
// that id (recurrenceServer.ts, 18.10.2026). Measured on live that day: no document in `events`,
// `games`, `errorLogs` or the AI spend rollups has the field, so the order changed nothing there.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** `{ id: <x>.id, ...<anything>` — the document's data, or a copy of it, spread over the id taken from it. */
const ID_THEN_SPREAD = /\{\s*id:\s*[\w$.]+\.id\s*,\s*\.\.\./g;

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    // The Warlord game is a submodule with a repository of its own.
    if (statSync(p).isDirectory()) { if (f !== 'warlord' && f !== 'node_modules') sources(p, out); continue; }
    if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** `file:line` of every match, so a file with one site fixed and another not still fails, by name. */
function sites(text: string, file: string): string[] {
  return [...text.matchAll(ID_THEN_SPREAD)].map((m) => `${file}:${text.slice(0, m.index).split('\n').length}`);
}

describe('the id is the document’s', () => {
  it('the pattern is recognised (a scan that matches nothing proves nothing)', () => {
    const hits = (s: string) => sites(s, 'x').length;
    expect(hits('docs.map((d) => ({ id: d.id, ...d.data() }))')).toBe(1);
    expect(hits('({ id: snap.id, ...(snap.data() as T) })')).toBe(1);
    // The server's two-step forms.
    expect(hits('byId.set(doc.id, { id: doc.id, ...data });')).toBe(1);
    expect(hits('return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.() || null };')).toBe(1);
    expect(hits('return {\n  id: d.id,\n  ...data,\n};')).toBe(1);
    // The right order, and explicit fields, are not.
    expect(hits('({ ...d.data(), id: d.id })')).toBe(0);
    expect(hits('{ ...data, id: doc.id }')).toBe(0);
    expect(hits('({ id: d.id, name: typeof x === "string" ? x : "" })')).toBe(0);
    // Every match counts, with its line.
    expect(sites('a\n{ id: a.id, ...x }\nb\n{ id: b.id, ...y }', 'f.ts')).toEqual(['f.ts:2', 'f.ts:4']);
  });

  it('no file in the app spreads a document over its own id', () => {
    const found = sources('src').flatMap((p) => sites(readFileSync(p, 'utf8'), p));
    expect(found).toEqual([]);
  });

  it('no file in the functions does either', () => {
    const files = sources(join('functions', 'src'));
    expect(files.length).toBeGreaterThan(20); // the walk reached the functions at all
    const found = files.flatMap((p) => sites(readFileSync(p, 'utf8'), p));
    expect(found).toEqual([]);
  });
});
