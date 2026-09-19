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

/** `format(x, '…')` calls whose pattern spells a word and which are handed no locale. */
export function nakedDateFormats(src: string): { line: number; pattern: string }[] {
  const lines = src.split('\n');
  const out: { line: number; pattern: string }[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const m of line.matchAll(/\bformat\(\s*[^,]+,\s*(['"`])([^'"`]+)\1/g)) {
      const pattern = m[2];
      if (!SPEAKS.test(pattern)) continue;
      // The options object is often wrapped onto the next line or two by the formatter.
      if (/locale\s*:/.test(lines.slice(i, i + 3).join(' '))) continue;
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
