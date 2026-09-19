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
//
// ── 19.09.2026: this guard had been blind for twenty-four days ──────────────────────
//
// Seventeen hardcoded strings were found by hand — a button reading "Remove Attached Asset", a
// placeholder "e.g. Kroger Card", nine `alt` texts — while this test passed on every commit.
// Three reasons, all of them in here:
//
//   1. **`accept="image/*"`.** Blanking block comments with `/\/\*[\s\S]*?\*\//` treats the
//      `/*` INSIDE that string as a comment opener. It blanked 18,592 characters of
//      AddEventModal in one bite, 7,202 of Wallet and 3,148 of Settings — about 36,000
//      characters of the app's three biggest screens, silently. Everything the scan was for
//      was sitting inside the hole. A scanner that skips a third of a file does not return a
//      wrong answer; it returns a clean one.
//   2. **Props were never looked at.** `alt`, `placeholder`, `title` and `aria-label` are read
//      out by screen readers and shown when an image fails. Nine of the seventeen were those.
//   3. **`if (!/^[A-Z]/.test(text)) continue;`** skipped anything starting lowercase, so
//      "e.g., Buy Milk, Order Cake..." was invisible even as text.
//
// The lesson is the header's own, turned on itself: a guard is a claim about the day it was
// written unless something proves it can still SEE. Hence the two tests below that feed it the
// exact shapes it went blind to.

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
  'you@example.com', // an address shaped the same in every language; the field is an email field
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
  //
  // Block comments are matched ONLY where `/*` opens a line, which is where a real one lives.
  // The unanchored version swallowed `accept="image/*"` and 36,000 characters after it.
  const blank = (m: string) => ' '.repeat(m.length);
  let masked = src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank).replace(/\/\/[^\n]*/g, blank);
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

  // The attributes a person actually meets: read aloud by a screen reader, shown when an image
  // fails, or sitting in an empty field. Nine of the seventeen found on 19.09 were these, and
  // none of them could ever have been seen by the loop above.
  for (const m of masked.matchAll(/\b(placeholder|title|aria-label|alt)="([^"]{2,200})"/g)) {
    const text = m[2].split(/\s+/).filter(Boolean).join(' ');
    if (text.length < 3) continue;
    if (!/[A-Za-z]{3}/.test(text)) continue;
    if (ALLOWED.has(text) || text.startsWith('http')) continue;
    if (/[=;{}()[\]\/\\]|className|=>/.test(text)) continue;
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

  it('is not blinded by a /* inside a string, which is what accept="image/*" is', () => {
    // The defect that hid ~36,000 characters for twenty-four days. The string after the input
    // must still be seen.
    const sample = `<input accept="image/*" />\n<button>Remove Attached Asset</button>`;
    expect(literalJsxText(sample).map((h) => h.text)).toContain('Remove Attached Asset');
  });

  it('sees the attributes a person meets, not just text between tags', () => {
    const sample = `<img alt="Profile picture" />\n<input placeholder="e.g. Kroger Card" />`;
    const found = literalJsxText(sample).map((h) => h.text);
    expect(found).toContain('Profile picture');
    expect(found).toContain('e.g. Kroger Card');
  });

  it('still lets a translated attribute through', () => {
    expect(literalJsxText(`<img alt={t('altProfile', language)} />`)).toEqual([]);
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
