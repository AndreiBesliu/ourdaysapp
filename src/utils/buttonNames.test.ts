// src/utils/buttonNames.test.ts
//
// A button whose only child is an icon has no accessible name. A screen reader announces it as
// "button" and nothing else; voice control has no word to activate it with. This app had eighteen
// of them and seven more named only by `title` — which is the LAST resort in the accessible-name
// computation, never appears on a touch device, and is announced inconsistently.
//
// ── This gate was blind for months, and measured so on 2026-09-20 ─────────────────────────
//
// It used to match buttons with `/<button\b([^>]*)>([\s\S]*?)<\/button>/`. `[^>]*` stops at the
// FIRST `>` — and in this codebase that is almost never the end of the tag, because it is the `>`
// inside `onClick={() => …}`. So `attrs` came out as ` onClick={() =`, and the REST of the
// attributes fell into `inner`. The check then asked whether `inner` had visible text, saw
// `className="p-1 hover:bg-black/10 …"`, decided the button was labelled, and skipped it.
//
// Measured before this rewrite: **221 of 307 matched buttons — 72% — were skipped that way.**
// The gate examined 86. It had been green the whole time.
//
// The old honesty test could not catch it either, because it counted `<button` occurrences in the
// TEXT rather than how many buttons the analyser actually EXAMINED. A gate that counts the work
// available instead of the work done cannot notice that it stopped doing any.
//
// So: a real TSX parser, and an honesty test that compares examined against present.
//
// Still deliberately conservative about what counts as a name. An earlier throwaway version
// stripped every `{...}` and claimed sixty-eight offenders, because `<button>{t('save')}</button>`
// looked empty to it. A label rendered by an expression IS a label. Under-reporting is the safe
// direction for a gate — a false failure gets the gate disabled, and then it protects nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

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

export interface Offender {
  file: string;
  line: number;
  kind: 'no-name' | 'title-only';
}

/** Does this element carry an attribute with that name, including through a spread we cannot see? */
function attrs(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile) {
  let spread = false;
  const names = new Set<string>();
  for (const p of el.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) { spread = true; continue; }
    if (ts.isJsxAttribute(p)) names.add(p.name.getText(sf));
  }
  return { has: (n: string) => names.has(n), spread };
}

/**
 * Could a sighted user read something inside this button?
 *
 * Text counts. An expression counts — `{t('save', language)}` is a label, and this gate must not
 * punish it. A nested ELEMENT does not count: that is the icon. A `{/* comment *\/}` does not.
 */
function hasVisibleContent(el: ts.JsxElement): boolean {
  for (const child of el.children) {
    if (ts.isJsxText(child)) { if (child.getText().trim()) return true; continue; }
    if (ts.isJsxExpression(child)) {
      // A JsxExpression with no expression is `{/* comment */}` — the comment lives in the trivia.
      if (child.expression) return true;
      continue;
    }
    // JsxElement / JsxSelfClosingElement / JsxFragment: markup, not a name.
  }
  return false;
}

/** Analyse one file. Returns the offenders AND how many buttons were examined, for the honesty test. */
export function analyseButtons(source: string, fileName: string): { offenders: Offender[]; examined: number } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: Offender[] = [];
  let examined = 0;

  const check = (el: ts.JsxOpeningLikeElement, parent: ts.JsxElement | null): void => {
    if (el.tagName.getText(sf) !== 'button') return;
    examined++;
    const a = attrs(el, sf);
    // A spread could carry anything, including an aria-label. Refusing to guess is the
    // conservative direction, and this repo's overlay props are passed exactly that way.
    if (a.spread) return;
    if (a.has('aria-label') || a.has('aria-labelledby')) return;
    if (parent && hasVisibleContent(parent)) return;
    offenders.push({
      file: fileName,
      line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1,
      kind: a.has('title') ? 'title-only' : 'no-name',
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) check(node.openingElement, node);
    else if (ts.isJsxSelfClosingElement(node)) check(node, null);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { offenders, examined };
}

function scanSrc() {
  const files = tsxFiles(SRC);
  const offenders: Offender[] = [];
  let examined = 0;
  let present = 0;
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    present += (raw.match(/<button[\s/>]/g) || []).length;
    const r = analyseButtons(raw, f.slice(SRC.length + 1).replace(/\\/g, '/'));
    offenders.push(...r.offenders);
    examined += r.examined;
  }
  return { files, offenders, examined, present };
}

describe('every button says what it does', () => {
  it('has no icon-only button without an accessible name', () => {
    const nameless = scanSrc().offenders.filter((o) => o.kind === 'no-name');
    expect(
      nameless.map((o) => `${o.file}:${o.line}`),
      "Add aria-label={t('someKey', language)} — an icon is not a name",
    ).toEqual([]);
  });

  it('has no button whose only name comes from title', () => {
    // `title` is better than nothing and worse than a label: it is the last thing the accessible
    // name computation looks at, and a touch user never sees it at all. This app ships through
    // Capacitor to Android, where there is no hover and `title` NEVER renders.
    const titled = scanSrc().offenders.filter((o) => o.kind === 'title-only');
    expect(
      titled.map((o) => `${o.file}:${o.line}`),
      'Keep title= for the tooltip, but add aria-label= too',
    ).toEqual([]);
  });

  it('EXAMINES nearly every button that exists, not merely some of them', () => {
    // The check the old version did not have, and the reason it was blind for months: it asserted
    // that buttons EXIST, which stays true however few of them get looked at.
    const { files, examined, present } = scanSrc();
    expect(files.length).toBeGreaterThan(20);
    expect(present).toBeGreaterThan(100);
    // Parser-based, so the only gap is a `<button>` inside a file that failed to parse.
    expect(examined).toBeGreaterThanOrEqual(present);
  });
});

describe('the analyser itself', () => {
  const run = (src: string) => analyseButtons(src, 'x.tsx').offenders;

  it('sees a button whose attributes contain an arrow function — the blindness that shipped', () => {
    // The whole regression in one case. `[^>]*` stopped at the `>` of `() =>`, the rest of the
    // attributes leaked into the children, and the button looked labelled.
    const src = 'const x = <button onClick={() => go()} className="p-1"><Icon /></button>;';
    expect(run(src)).toHaveLength(1);
    expect(run(src)[0].kind).toBe('no-name');
  });

  it('classifies a title-only button as such, arrow function or not', () => {
    const src = 'const x = <button onClick={() => go()} title="Search"><Icon /></button>;';
    expect(run(src)[0].kind).toBe('title-only');
  });

  it('accepts a label rendered by an expression', () => {
    expect(run("const x = <button onClick={() => go()}>{t('save', language)}</button>;")).toEqual([]);
  });

  it('accepts plain text, and an aria-label beside an icon', () => {
    expect(run('const x = <button onClick={() => go()}>Save</button>;')).toEqual([]);
    expect(run('const x = <button aria-label="Close" onClick={() => go()}><X /></button>;')).toEqual([]);
  });

  it('does not count a comment as a name', () => {
    expect(run('const x = <button onClick={() => go()}>{/* icon below */}<X /></button>;')).toHaveLength(1);
  });

  it('declines to judge a button carrying a spread', () => {
    // The spread could hold aria-label. Guessing wrong here produces a false failure, and a gate
    // that cries wolf is a gate somebody deletes.
    expect(run('const x = <button {...menu.triggerProps}><X /></button>;')).toEqual([]);
  });

  it('counts every button it examined, including the ones it cleared', () => {
    const src = 'const x = <div><button aria-label="a"><X/></button><button><Y/></button></div>;';
    expect(analyseButtons(src, 'x.tsx').examined).toBe(2);
  });
});
