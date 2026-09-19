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
// ── 19.09.2026, later the same day: the third repair was half a repair ─────────────────
//
// The capital filter came out of the ATTRIBUTE loop and stayed in the text loop, which is the
// one the note above is about. Two more strings were found by eye on a bench a few hours
// later — `+ Assign Member` in the assignee picker and `typing...` in the chat — both of them
// lowercase-or-punctuation at the front, both invisible to this file while it reported clean.
//
// Measured before removing it: the filter was throwing away four matches in the whole of
// `src`. Two were those strings. The other two were `liveQuery` (an identifier leaking out of
// `liveQuery<any>(`) and `0 && dist` (a plain `if` in a .tsx file). So the filter was paying
// for two false positives with two real defects, and both false positives have a shape worth
// naming instead.
//
// Repairing one call site and leaving the other is the failure this whole file is about:
// afterwards the header said the blindness was gone while half of it was still there.
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
  for (const m of masked.matchAll(/>([^<>]{2,2000}?)</gs)) {
    const text = m[1].split(/\s+/).filter(Boolean).join(' ');
    // The size test belongs on the COLLAPSED text, never on the raw region. Blanking `{…}`
    // preserves length, so 95 characters of masked expression inside a 60-character sentence
    // pushed the region past the old 200-character quantifier and the match was ABANDONED —
    // an English paragraph in AddEventModal was invisible for exactly that reason.
    if (text.length < 2 || text.length > 200) continue;
    // All that survives of a count like `({yesUsers.length})` is `( )`. Removing it before the
    // code-shaped test below is what lets `Going (2)` be read as the label it is; with the
    // brackets left in, the scanner filed three RSVP labels as code.
    const probe = text.replace(/\(\s*\)/g, '').trim();
    // Two letters, not three: the third RSVP button says `No`, and its two siblings were
    // translated around it. Measured before lowering it — across all of `src` the change
    // surfaces four strings, and all four are real.
    if (!/[A-Za-z]{2}/.test(probe)) continue;     // punctuation, entities, separators
    // A lone lowercase token is an identifier leaking out of a generic — `liveQuery<any>(`
    // matches `>liveQuery<`. This is what is left of the old `^[A-Z]` rule, which threw away
    // every lowercase match and with it "+ Assign Member" and "typing...". Anything with a
    // space or a mark of punctuation in it is prose and is looked at.
    if (/^[a-z_$][A-Za-z0-9_$]*$/.test(probe)) continue;
    if (ALLOWED.has(probe) || probe.startsWith('http')) continue;
    // `&&` and `||`: `if (dist > 0 && dist < 150)` is a `>…<` match with no other code in it.
    if (/[=;{}()[\]/\\]|&&|\|\||className|=>/.test(probe)) continue; // still code, not prose
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

  it('sees text that does not begin with a capital — the half of the repair I missed', () => {
    // Both found by eye on a bench hours after this file reported clean, because `^[A-Z]`
    // came out of the attribute loop and stayed in the one above it.
    const sample = `<option value="unassigned" disabled>+ Assign Member</option>\n`
      + `<span>someone is typing...</span>`;
    const found = literalJsxText(sample).map((h) => h.text);
    expect(found).toContain('+ Assign Member');
    expect(found).toContain('someone is typing...');
  });

  it('still does not flag the two things that filter was paying for', () => {
    // A generic's identifier and a plain comparison. Measured: these two were the ENTIRE
    // cost of `^[A-Z]` across src, against the two real strings above.
    expect(literalJsxText('const u = liveQuery<any>(q);')).toEqual([]);
    expect(literalJsxText('if (dist > 0 && dist < 150) setPull(dist);')).toEqual([]);
  });

  it('still lets a translated attribute through', () => {
    expect(literalJsxText(`<img alt={t('altProfile', language)} />`)).toEqual([]);
  });

  it('sees a short sentence with a long masked expression inside it', () => {
    // Found by an adversarial review on 19.09, hours after this file was mended. Blanking
    // `{…}` keeps its LENGTH, so 95 characters of masked code inside a 60-character sentence
    // pushed the region past the old 200-character quantifier and the match was abandoned.
    // The English paragraph under the repeat dropdown had been live all along.
    // Written out with the newlines and the indentation the real file has: the first version of
    // this fixture was one unindented line of about 160 characters, which fitted inside the old
    // 200-character quantifier and so passed with the repair reverted. A negative control that
    // does not break the thing it names proves nothing.
    const sample = [
      '                  <p className="text-xs">',
      '                    \u{1F501} This event will repeat {repeat} until '
        + "{eventDate ? format(getRecurrenceEndDate(new Date(eventDate), repeat), 'MMMM d, yyyy') : '...'}"
        + '. Recurrence is not infinite.',
      '                  </p>',
    ].join('\n');
    expect(literalJsxText(sample).map((h) => h.text).join(' ')).toContain('This event will repeat');
  });

  it('sees a label with a count in brackets', () => {
    // `({yesUsers.length})` collapses to `( )`, and the brackets made the scanner file three
    // RSVP labels as code. Stripping the empty pair before the code test is the repair.
    const sample = '<span>Going ({yesUsers.length})</span><span>Not going ({noUsers.length})</span>';
    const found = literalJsxText(sample).map((h) => h.text);
    expect(found.some((t) => t.startsWith('Going'))).toBe(true);
    expect(found.some((t) => t.startsWith('Not going'))).toBe(true);
  });

  it('sees a two-letter word between two translated siblings', () => {
    // The third RSVP button said `No` while the other two went through t(). Three characters
    // was the floor; two is enough for a word somebody clicks.
    const sample = '<button><ThumbsDown /> No</button>';
    expect(literalJsxText(sample).map((h) => h.text)).toContain('No');
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
