// src/utils/dateLocaleCoverage.test.ts
//
// A date that spells a word must be told which language to spell it in.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// Yesterday I translated the repeat list on the event form and found the WORD translated while
// the date beside it stayed English: "Zilnic — până pe Oct 20, 2026". That one was fixed by hand.
// Today, on a bench with the language set to Romanian, the event details header still read
// **"Sunday, September 20, 2026"** — same defect, different screen, one commit later.
//
// So it is not a screen, it is a class: `format()` from date-fns writes English unless it is
// handed a `locale`. Measured across `src` on 19.09: fifteen calls whose pattern can spell a word
// out loud, **nine of them with no locale at all** — the details header (four), the chat's day
// separator, the games hub, the leave-group list and the recurring panel (two).
//
// The i18n guard next door cannot see any of this. `format(d, 'MMM d, yyyy')` contains no English
// prose; the English is produced at run time, by a library, from a pattern made of letters that
// are not words. A second net, for a defect the first one is the wrong shape to catch.
//
// ── What it does NOT check ────────────────────────────────────────────────────────────
//
// Patterns made only of digits and separators — `yyyy-MM-dd`, `HH:mm` — read the same in every
// language and are left alone. The test would be noise if it asked those to carry a locale, and a
// noisy guard gets switched off.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** The same two exemptions as the i18n guard: the game submodule and Andrei's own console. */
const SKIP_DIRS = new Set(['warlord', 'warlordPvp', 'warlordAdmin', 'node_modules']);
const SKIP_FILES = new Set(['Admin.tsx', 'Warlord.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, out);
    } else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !SKIP_FILES.has(name) && !name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Tokens that make date-fns write a word rather than a number.
 *
 * `MMM`/`LLL` a month name, `EEE`/`ccc` a weekday, a bare `a` the am/pm marker, `o` an ordinal
 * ("29th"). A pattern without any of them is digits, and digits need no language.
 */
const SPEAKS = /MMM|LLL|EEE|ccc|aaa|\ba\b|\bo\b/;

/**
 * The text of one `format(…)` call, from its opening bracket to the bracket that closes it,
 * however many lines that takes. Stops after eight lines, which is far more than any real call.
 */
function callText(lines: string[], row: number, from: number): string {
  let depth = 0;
  let out = '';
  for (let i = row; i < Math.min(lines.length, row + 8); i++) {
    for (let c = i === row ? from : 0; c < lines[i].length; c++) {
      const ch = lines[i][c];
      out += ch;
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return out;
      }
    }
    out += ' ';
  }
  return out;
}

/** `format(x, '…')` calls whose pattern spells a word and which are handed no locale. */
export function nakedDateFormats(src: string): { line: number; pattern: string }[] {
  const lines = src.split('\n');
  const out: { line: number; pattern: string }[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // `.+?` and not `[^,]+`: the first argument is very often a call of its own, and a
    // comma inside it ended the match before it began. `format(getRecurrenceEndDate(new
    // Date(d), r), 'MMMM d, yyyy')` — the one call the sweep missed — was invisible for
    // exactly that reason, and this guard reported clean while it shipped.
    for (const m of line.matchAll(/\bformat\(\s*.+?,\s*(['"`])([^'"`]+)\1/g)) {
      const pattern = m[2];
      if (!SPEAKS.test(pattern)) continue;
      // Inside THIS call's brackets, not merely nearby: asking whether the word `locale:`
      // appears in the next three lines exempts a bare call for its NEIGHBOUR's locale, and
      // in this codebase localised calls sit in clusters.
      if (/locale\s*:/.test(callText(lines, i, line.indexOf('(', m.index)))) continue;
      out.push({ line: i + 1, pattern });
    }
  });
  return out;
}

describe('a date that spells a word is told which language to spell it in', () => {
  const files = walk(SRC);

  it('finds the screens at all, so this cannot pass by scanning nothing', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith('EventDetailsModal.tsx'))).toBe(true);
  });

  it('sees the exact call that read "Sunday, September 20, 2026" in a Romanian app', () => {
    const sample = "return format(new Date(event.date), 'EEEE, MMMM d, yyyy');";
    expect(nakedDateFormats(sample).map((h) => h.pattern)).toEqual(['EEEE, MMMM d, yyyy']);
  });

  it('is satisfied once the locale is there, on the same line or the next', () => {
    expect(nakedDateFormats("format(d, 'd MMM yyyy', { locale: getDateLocale(language) })")).toEqual([]);
    expect(nakedDateFormats("format(d, 'd MMM yyyy', {\n  locale: dateLocale,\n})")).toEqual([]);
  });

  it('leaves a pattern of pure digits alone, which is why it is worth having on', () => {
    expect(nakedDateFormats("format(d, 'yyyy-MM-dd')")).toEqual([]);
    expect(nakedDateFormats("format(d, 'HH:mm')")).toEqual([]);
  });

  it('does not read a commented-out example as a call', () => {
    expect(nakedDateFormats("// format(d, 'MMM d, yyyy') was what this used to do")).toEqual([]);
  });

  it('sees a call whose first argument is itself a call with arguments', () => {
    // `[^,]+` could never reach past the first comma on the line, so this exact call — the one
    // the sweep missed — did not match at all, and the guard reported clean while it shipped.
    const sample = "format(getRecurrenceEndDate(new Date(eventDate), repeat), 'MMMM d, yyyy')";
    expect(nakedDateFormats(sample).map((h) => h.pattern)).toEqual(['MMMM d, yyyy']);
  });

  it('is not satisfied by the locale of a neighbouring call', () => {
    // Localised calls sit in clusters here. A three-line window let a bare one hide behind the
    // options object of the call above it.
    // Order matters and the first version had it backwards: the old window was
    // `lines.slice(i, i + 3)`, which only ever looked FORWARD, so a localised call ABOVE the
    // bare one could never have exempted it. The bare call has to come first.
    const sample = [
      "const bare = format(d, 'EEEE, d MMMM');",
      "const ok = format(d, 'd MMM yyyy', { locale: getDateLocale(language) });",
    ].join('\n');
    expect(nakedDateFormats(sample).map((h) => h.pattern)).toEqual(['EEEE, d MMMM']);
  });

  it('every date that speaks is given a language', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1).split(sep).join('/');
      for (const hit of nakedDateFormats(readFileSync(f, 'utf8'))) {
        offenders.push(`${rel}:${hit.line}  '${hit.pattern}'`);
      }
    }
    expect(offenders, `dates that will be English whatever the language is:\n${offenders.join('\n')}`).toEqual([]);
  });
});
