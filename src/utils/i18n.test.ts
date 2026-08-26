// src/utils/i18n.test.ts
// Six dictionaries that must stay the same size, and a fallback that hides it when they don't.
//
// `t()` falls back to English and then to the raw key, which is the right runtime behaviour and
// the reason a missing translation is invisible in review: the screen still renders words. The
// only way to catch a gap is to compare the blocks, and the only way to keep comparing them is
// from a test — it was being done by hand, once, when someone happened to wonder.
//
// The house rule (CLAUDE.md): every user-facing string goes through `t()` in all six languages.
// The declared exception is the Warlord UI, which stays English by Andrei's decision.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translations, t } from './i18n';

const LANGS = ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE'];

describe('the six dictionaries agree', () => {
  it('has exactly the six languages the app offers', () => {
    expect(Object.keys(translations).sort()).toEqual([...LANGS].sort());
  });

  it('every language carries every key', () => {
    const en = Object.keys(translations['en-US']);
    expect(en.length).toBeGreaterThan(300);
    for (const lang of LANGS) {
      const mine = new Set(Object.keys(translations[lang]));
      const missing = en.filter((k) => !mine.has(k));
      const extra = Object.keys(translations[lang]).filter((k) => !en.includes(k));
      expect(missing, `${lang} is missing: ${missing.join(', ')}`).toEqual([]);
      // An extra key is a typo in English's block, or a key nobody can ever read.
      expect(extra, `${lang} has keys English does not: ${extra.join(', ')}`).toEqual([]);
    }
  });

  it('no value is left empty', () => {
    for (const lang of LANGS) {
      const blank = Object.entries(translations[lang]).filter(([, v]) => !String(v).trim());
      expect(blank.map(([k]) => k), `${lang} has empty values`).toEqual([]);
    }
  });

  it('no language is a copy of English pretending to be translated', () => {
    // Proper nouns and short shared words legitimately match ("OK", "Email"), so this asks only
    // that each language differs on MOST keys — a block pasted wholesale fails loudly.
    const en = translations['en-US'];
    for (const lang of LANGS.filter((l) => l !== 'en-US')) {
      const keys = Object.keys(en);
      const same = keys.filter((k) => translations[lang][k] === en[k]).length;
      expect(same / keys.length, `${lang} matches English on ${same}/${keys.length} keys`).toBeLessThan(0.5);
    }
  });
});

describe('t() itself', () => {
  it('returns the asked-for language', () => {
    expect(t('walletCancel', 'ro-RO')).toBe(translations['ro-RO'].walletCancel);
    expect(t('walletCancel', 'de-DE')).toBe(translations['de-DE'].walletCancel);
  });

  it('falls back to English, then to the key — never to blank', () => {
    expect(t('walletCancel', 'xx-XX')).toBe(translations['en-US'].walletCancel);
    expect(t('a-key-that-does-not-exist', 'ro-RO')).toBe('a-key-that-does-not-exist');
  });
});

describe('the source file, not just the object it builds', () => {
  // A duplicate key is INVISIBLE to every check above: the object literal simply keeps the last
  // one, so counts match, no value is empty, and the app silently uses whichever definition came
  // second. It happened while writing these very keys — four names already existed, with proper
  // diacritics, and the ASCII copies added later would have won. Only the source shows it.
  const src = readFileSync(join(__dirname, 'i18n.ts'), 'utf8');

  it('defines no key twice inside a language block', () => {
    const dups: string[] = [];
    let block: string | null = null;
    let seen = new Set<string>();
    for (const line of src.split(/\r?\n/)) {
      const b = /^  '([a-z]{2}-[A-Z]{2})': \{/.exec(line);
      if (b) { block = b[1]; seen = new Set(); continue; }
      const k = /^    ([A-Za-z0-9_]+):/.exec(line);
      if (!k || !block) continue;
      if (seen.has(k[1])) dups.push(`${block}.${k[1]}`);
      seen.add(k[1]);
    }
    expect(dups, `duplicate keys: ${dups.join(', ')}`).toEqual([]);
  });

  it('keeps the accented alphabets — a stripped translation is a wrong one', () => {
    // "Sterge" is not Romanian for delete and "loschen" is not German. Both parse, both render,
    // and neither is caught by a key-count check.
    // Walk the file the same way the duplicate check does. Splitting on the language name alone
    // finds the tiny `locales` map at the top of the file first, and a 13-character "block" has
    // no accents in it — which is how this test first passed itself a false failure.
    const need: Record<string, RegExp> = {
      'ro-RO': /[ăâîșțĂÂÎȘȚ]/,
      'fr-FR': /[éèêàçùÉ]/,
      'de-DE': /[äöüßÄÖÜ]/,
      'es-ES': /[áéíóúñ¿¡]/,
      'it-IT': /[àèéìòù]/,
    };
    const counts: Record<string, number> = {};
    let block: string | null = null;
    for (const line of src.split(/\r?\n/)) {
      const b = /^  '([a-z]{2}-[A-Z]{2})': \{/.exec(line);
      if (b) { block = b[1]; counts[block] = counts[block] ?? 0; continue; }
      if (!block || !need[block]) continue;
      if (/^    [A-Za-z0-9_]+:/.test(line) && need[block].test(line)) counts[block]++;
    }
    for (const lang of Object.keys(need)) {
      // Italian, the least accented of the five, sits at 26; a block typed in ASCII scores 0.
      // The threshold only has to separate those two, so it is set well below the real floor.
      expect(counts[lang] ?? 0, `${lang} has only ${counts[lang] ?? 0} accented strings`).toBeGreaterThan(15);
    }
  });
});

