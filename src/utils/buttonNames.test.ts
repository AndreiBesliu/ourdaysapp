// src/utils/buttonNames.test.ts
//
// A button whose only child is an icon has no accessible name. A screen reader announces it as
// "button" and nothing else; voice control has no word to activate it with. This app had eighteen
// of them and seven more named only by `title` — which is the LAST resort in the accessible-name
// computation, never appears on a touch device, and is announced inconsistently.
//
// They were fixed by hand once. This keeps them fixed, because the next icon-only button will be
// added by someone who has never read that commit.
//
// Deliberately conservative: it reports a button only when the content is pure markup. An earlier
// throwaway version of this scan stripped every `{...}` and so claimed sixty-eight offenders,
// because `<button>{t('save', language)}</button>` looked empty to it. A label rendered by an
// expression is still a label. Under-reporting is the safe direction for a gate — a false failure
// gets the gate disabled, and then it protects nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // `warlord` is a git submodule with its own repo and its own English-only UI rules.
    if (entry === 'warlord' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** What a sighted user reads inside the button, with markup removed but expressions kept. */
function visibleText(inner: string): string {
  return inner
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // {/* comments */}
    .replace(/<[^>]*>/g, '')                     // <Icon />, <span>, …
    .trim();
}

interface Offender {
  file: string;
  line: number;
  kind: 'no-name' | 'title-only';
}

function findOffenders(): Offender[] {
  const found: Offender[] = [];
  for (const file of tsxFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    // Line endings are mixed across this repo, so count lines on a normalised copy.
    const normalised = src.replace(/\r\n/g, '\n');
    for (const m of normalised.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const [, attrs, inner] = m;
      if (attrs.includes('aria-label') || attrs.includes('aria-labelledby')) continue;
      if (visibleText(inner)) continue;
      found.push({
        file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
        line: normalised.slice(0, m.index).split('\n').length,
        kind: /\btitle=/.test(attrs) ? 'title-only' : 'no-name',
      });
    }
  }
  return found;
}

describe('every button says what it does', () => {
  it('has no icon-only button without an accessible name', () => {
    const nameless = findOffenders().filter((o) => o.kind === 'no-name');
    expect(
      nameless.map((o) => `${o.file}:${o.line}`),
      'Add aria-label={t(\'someKey\', language)} — an icon is not a name',
    ).toEqual([]);
  });

  it('has no button whose only name comes from title', () => {
    // `title` is better than nothing and worse than a label: it is the last thing the accessible
    // name computation looks at, and a touch user never sees it at all. Keep the tooltip, add the
    // label beside it.
    const titled = findOffenders().filter((o) => o.kind === 'title-only');
    expect(
      titled.map((o) => `${o.file}:${o.line}`),
      'Keep title= for the tooltip, but add aria-label= too',
    ).toEqual([]);
  });

  it('actually looks at files, so an empty pass cannot be a silent pass', () => {
    // Without this, a broken glob or a moved directory would make both tests above trivially green
    // and nobody would notice for months.
    const files = tsxFiles(SRC);
    expect(files.length).toBeGreaterThan(20);
    const buttons = files
      .map((f) => (readFileSync(f, 'utf8').match(/<button\b/g) || []).length)
      .reduce((a, b) => a + b, 0);
    expect(buttons).toBeGreaterThan(100);
  });
});
