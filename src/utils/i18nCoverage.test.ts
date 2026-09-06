// src/utils/i18nCoverage.test.ts
// "Every visible string goes through t()" — as a test, not as a claim in a commit message.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// On 2026-08-26 I swept the app for hardcoded English, re-scanned, found none, and wrote "zero
// English strings remain outside the two declared exemptions" in a commit message. That was
// wrong. The scan matched `>Text<` on a SINGLE line, and the commonest real shape in this codebase
// spans three:
//
//     <p className="...">
//       <Wallet className="w-4 h-4" /> Linked Asset Code
//     </p>
//
// Thirty-two strings were sitting in that blind spot, and not obscure ones: Start Task, Complete,
// To-Do List, Delete Event, RSVP — Are you going?, "This message was deleted".
//
// A one-off grep is a claim about the day it was run. This is the same scan with the newline bug
// fixed, wired into the suite, so the claim is re-checked on every commit instead of being
// believed. The house rule it enforces (CLAUDE.md): all user-facing text goes through `t()` in six
// languages, with `/admin` and the Warlord UI as the two declared exemptions.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** The game is a submodule with its own English-only decision; admin is Andrei's own console. */
const SKIP_DIRS = new Set(['warlord', 'warlordPvp', 'warlordAdmin', 'node_modules']);
const SKIP_FILES = new Set(['Admin.tsx', 'Warlord.tsx']);

/**
 * Text that is meant to stay exactly as written.
 *
 * Kept deliberately short. Every entry is a word that is either a proper noun or identical across
 * all six languages — not a place to park something that should have been translated.
 */
const ALLOWED = new Set([
  'Our Days',   // the product name
  'Google',     // the sign-in provider
  'Warlord',    // the game's name
  'Admin',      // identical in all six languages; the entry to the exempt console
  'English', 'Română', 'Français', 'Español', 'Italiano', 'Deutsch', // language names stay native
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx') && !SKIP_FILES.has(name) && !name.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

/** Literal text sitting between JSX tags, ACROSS newlines — the thing the old scan could not see. */
function literalJsxText(src: string): { line: number; text: string }[] {
  // Line index first, so a hit in the flattened text can be reported where it really is.
  const lineStarts: number[] = [];
  let pos = 0;
  for (const l of src.split('\n')) {
    lineStarts.push(pos);
    pos += l.length + 1;
  }
  const lineOf = (off: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // Blank out comments and {expressions}, preserving length so offsets stay meaningful.
  const blank = (m: string) => ' '.repeat(m.length);
  let masked = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
  masked = masked.replace(/\{[^{}]*\}/g, blank);

  const out: { line: number; text: string }[] = [];
  for (const m of masked.matchAll(/>([^<>]{2,200}?)</gs)) {
    const text = m[1].split(/\s+/).filter(Boolean).join(' ');
    if (text.length < 3) continue;
    if (!/[A-Za-z]{3}/.test(text)) continue;     // punctuation, entities, separators
    if (!/^[A-Z]/.test(text)) continue;          // prose starts with a capital; fragments do not
    if (ALLOWED.has(text) || text.startsWith('http')) continue;
    if (/[=;{}()[\]/\\]|className|=>/.test(text)) continue; // still code, not prose
    out.push({ line: lineOf(m.index! + 1), text });
  }
  return out;
}

describe('no user-facing screen ships a hardcoded string', () => {
  const files = walk(SRC);

  it('finds the screens at all, so this cannot pass by scanning nothing', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith('CalendarHome.tsx'))).toBe(true);
  });

  it('sees text that spans lines — the blind spot that produced a false all-clear', () => {
    // The exact shape that slipped through: icon, then words, then the closing tag next line.
    const sample = `<p className="x">\n  <Wallet className="w-4 h-4" /> Linked Asset Code\n</p>`;
    expect(literalJsxText(sample).map((h) => h.text)).toContain('Linked Asset Code');
  });

  it('does not flag text that is already translated', () => {
    const sample = `<p className="x">\n  <Wallet className="w-4 h-4" /> {t('linkedAssetCode', language)}\n</p>`;
    expect(literalJsxText(sample)).toEqual([]);
  });

  it('every literal is gone', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1).split(sep).join('/');
      for (const hit of literalJsxText(readFileSync(f, 'utf8'))) {
        offenders.push(`${rel}:${hit.line}  ${hit.text}`);
      }
    }
    expect(offenders, `hardcoded strings:\n${offenders.join('\n')}`).toEqual([]);
  });
});
