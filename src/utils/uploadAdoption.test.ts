// src/utils/uploadAdoption.test.ts
//
// Files go into Storage through ONE function, and this is what keeps it that way.
//
// ── Why ───────────────────────────────────────────────────────────────────────────────
//
// There were seven upload sites across four files. Six had no time limit at all, so a dead
// connection was a spinner that never came back; the seventh raced a fifteen-second timer against
// an upload it could not cancel, which reported failure and then finished — leaving a file in the
// bucket that no document points at. Measured on live: 44 objects, two of them orphans, one under
// `assets/`, which is that exact line.
//
// Seven call sites cannot be kept in step by intention. They can by there being one.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const APP = join(__dirname, '..', '..');
const SRC = join(APP, 'src');
const UPLOADER = 'src/utils/uploadFile.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'warlord' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * The file with its COMMENTS removed.
 *
 * Without this the guard flags its own documentation: `uploadWatch.ts` quotes the broken code in
 * its header to explain what it replaced, and a scanner that reads prose as code called that a
 * violation. Block comments go entirely; line comments only when they start the line, so a `//`
 * inside a URL cannot swallow real code sitting after it.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const files = walk(SRC).map((f) => ({
  rel: f.slice(APP.length + 1).split(sep).join('/'),
  src: code(readFileSync(f, 'utf8')),
  raw: readFileSync(f, 'utf8'),
}));

describe('one way into Storage', () => {
  it('finds the source at all, so this cannot pass by finding nothing', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.rel === UPLOADER)).toBe(true);
  });

  it('only uploadFile puts bytes in the bucket', () => {
    const writers = files
      .filter((f) => /\buploadBytes(Resumable)?\s*\(/.test(f.src))
      .map((f) => f.rel);
    expect(writers, `these upload without going through ${UPLOADER}`).toEqual([UPLOADER]);
  });

  it('and it is the resumable one, because the other cannot be cancelled', () => {
    const up = files.find((f) => f.rel === UPLOADER)!.raw;
    expect(up).toContain('uploadBytesResumable');
    expect(up).toContain('task.cancel()');
  });

  it('nobody races a timer against an upload any more', () => {
    // The shape that shipped the orphan: a rejecting timer against a task with no cancel. The
    // loser of a Promise.race keeps running, which is the whole defect in one word.
    const racers = files
      .filter((f) => /Promise\.race\s*\(/.test(f.src) && /upload/i.test(f.src))
      .map((f) => f.rel);
    expect(racers, 'a raced upload cannot be cancelled and leaves the file behind').toEqual([]);
  });

  it('no upload site invents its own millisecond limit', () => {
    // How long to wait is one decision, in uploadWatch.ts, where it is explained and tested.
    const offenders = files
      .filter((f) => f.rel !== UPLOADER && f.rel !== 'src/utils/uploadWatch.ts')
      .filter((f) => /upload/i.test(f.src) && /setTimeout\([^)]*\b\d{4,}\)/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
