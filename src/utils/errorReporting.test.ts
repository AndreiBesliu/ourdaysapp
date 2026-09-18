// src/utils/errorReporting.test.ts
//
// A failure that only reaches the console is a bug nobody will ever hear about.
//
// ── Why ───────────────────────────────────────────────────────────────────────────────
//
// The admin health panel is the instrument this project uses to decide what is broken on live —
// it is how the shopping-list card bug was found on 18.09, two days after it started. An
// instrument is only as good as what reaches it.
//
// Measured on 19.09: of 143 `catch` blocks in `src/`, **49 wrote to the console and reported
// nothing**. A third of every failure path in the app ended on a device and stayed there, while the
// panel showed a clean bill. Two of the 49 were found the hard way the day before: the wallet's
// upload reported only to `console.error`, and `AddEventModal` did not even import the reporter —
// `reportError` there resolved to the DOM global, which takes one argument and logs to the console.
//
// ── What this guards ──────────────────────────────────────────────────────────────────
//
// Blocks are found by BRACE MATCHING rather than by regex: a regex cannot tell where a block ends,
// and a scanner that guesses has misled this project more than once. Comments are not stripped
// here because a comment mentioning `console.error` inside a catch is still a catch that must
// report — the rule is about the presence of the call, not about prose.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const APP = join(__dirname, '..', '..');
const SRC = join(APP, 'src');

/** The reporter itself, which obviously cannot call itself. */
const EXEMPT = ['src/reportError.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'warlord' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Block { line: number; body: string }

/** Every `catch` block's body, matched by braces. */
function catchBlocks(src: string): Block[] {
  const out: Block[] = [];
  const re = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, body: src.slice(start, i + 1) });
  }
  return out;
}

const files = walk(SRC).map((f) => ({
  rel: f.slice(APP.length + 1).split(sep).join('/'),
  src: readFileSync(f, 'utf8'),
}));

describe('every failure has a way off the device', () => {
  it('finds the catch blocks at all, so this cannot pass by finding nothing', () => {
    const total = files.reduce((n, f) => n + catchBlocks(f.src).length, 0);
    expect(total).toBeGreaterThan(100);
  });

  it('no catch logs to the console without also reporting', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (EXEMPT.includes(f.rel)) continue;
      for (const b of catchBlocks(f.src)) {
        const logs = /console\.(error|warn)\s*\(/.test(b.body);
        const reports = /reportError\s*\(/.test(b.body);
        if (logs && !reports) offenders.push(`${f.rel}:${b.line}`);
      }
    }
    expect(
      offenders,
      'these failures end on the device and never reach the health panel:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('and every file that reports has actually imported the reporter', () => {
    // `AddEventModal` called `reportError` for a day without importing it. TypeScript resolved it
    // to the DOM global — one argument, straight to the console — so the call compiled, ran, and
    // reported nothing. The context object was silently dropped on the floor.
    const missing = files
      .filter((f) => !EXEMPT.includes(f.rel))
      .filter((f) => /\breportError\s*\(/.test(f.src))
      .filter((f) => !/from ['"][^'"]*reportError['"]/.test(f.src))
      .map((f) => f.rel);
    expect(missing, 'these call reportError without importing it — that is the DOM global').toEqual([]);
  });
});
