// src/utils/i18nKeysExist.test.ts
//
// Every `t('literal')` in the app must name a key that exists.
//
// ── Why this was missing, and what it cost ────────────────────────────────────────────────
//
// `t()` ends with `|| key`:
//
//     return currentLangDict[key] || translations['en-US'][key] || key;
//
// A sensible fallback — better to render `closeRecap` than to crash or render nothing. But it
// means a typo, or a key somebody forgot to add, produces a screen that LOOKS fine in review and
// reads a camel-case identifier out loud to a screen-reader user. Nothing fails.
//
// Measured on 2026-09-20: 74 buttons were given `aria-label={t('…')}` in one change, and the step
// that added the 19 new keys silently failed. `i18nCoverage` passed (it hunts hard-coded English,
// and these were not hard-coded), `i18n.test` passed (it compares the six dictionaries against
// each other, and a key missing from ALL SIX is consistent), and `buttonNames` passed (it asks
// whether an aria-label exists, not whether it resolves). Three green gates, 19 broken labels.
//
// Each of those three is right about its own question. This is the question none of them asked.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { translations } from './i18n';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // The Warlord submodule is English-only by the owner's decision and has no `t()`.
    if (entry === 'warlord' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

export interface KeyUse { file: string; line: number; key: string }

/**
 * Every literal key passed to `t(...)`, including both arms of a ternary.
 *
 * A computed key — `t(someVar)` — is skipped rather than guessed at. That is a real blind spot and
 * it is the safe direction: a gate that guesses produces false failures, and a false failure gets
 * the gate deleted.
 */
export function literalKeyUses(source: string, fileName: string): KeyUse[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const uses: KeyUse[] = [];

  const collect = (e: ts.Expression, at: ts.Node): void => {
    if (ts.isParenthesizedExpression(e)) return collect(e.expression, at);
    if (ts.isConditionalExpression(e)) { collect(e.whenTrue, at); collect(e.whenFalse, at); return; }
    if (ts.isStringLiteral(e)) {
      uses.push({
        file: fileName,
        line: sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1,
        key: e.text,
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 't'
        && node.arguments.length > 0) {
      collect(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

/**
 * The comparison, pulled out so it can be tested against a dictionary this file controls.
 *
 * Inline, it was untestable in the only way that matters: a mutation replacing it with `[]` left
 * the suite green. The honesty check below proves the COLLECTOR works; nothing proved the
 * COMPARISON did, and a gate whose verdict is unreachable by any test is not a gate.
 */
export function missingKeys(uses: readonly KeyUse[], dict: Record<string, string>): KeyUse[] {
  // `in` walks the prototype chain, so `toString` would count as present — and `t()` would then
  // return a FUNCTION, because its own check is `dict[key] ||`, which a function satisfies.
  // Own property, and a string: that is what `t()` actually needs to return a label.
  return uses.filter((u) =>
    !Object.prototype.hasOwnProperty.call(dict, u.key) || typeof dict[u.key] !== 'string');
}

describe('every translation key the app asks for exists', () => {
  const dict = translations['en-US'];

  const uses = sourceFiles(SRC).flatMap((f) =>
    literalKeyUses(readFileSync(f, 'utf8'), f.slice(SRC.length + 1).replace(/\\/g, '/')));

  it('finds no `t()` call naming a key that is not defined', () => {
    const missing = missingKeys(uses, dict);
    expect(
      missing.map((u) => `${u.file}:${u.line} t('${u.key}')`),
      "t() falls back to returning the key, so a missing one renders as `someCamelCaseWord`",
    ).toEqual([]);
  });

  it('actually collected a large number of calls, so an empty pass cannot be a silent pass', () => {
    // The honesty check. `buttonNames` had one of these that counted how many buttons EXISTED
    // rather than how many were examined, and stayed green while it inspected 28% of them.
    // This counts what the parser really resolved.
    expect(uses.length).toBeGreaterThan(400);
    expect(new Set(uses.map((u) => u.file)).size).toBeGreaterThan(15);
  });
});

describe('the comparison itself', () => {
  it('reports a key the dictionary does not have, and only that one', () => {
    const uses: KeyUse[] = [
      { file: 'a.tsx', line: 1, key: 'known' },
      { file: 'b.tsx', line: 2, key: 'absent' },
    ];
    expect(missingKeys(uses, { known: 'x' }).map((u) => u.key)).toEqual(['absent']);
  });

  it('is not satisfied by an inherited property', () => {
    // `'toString' in {}` is TRUE through the prototype chain. A key called `constructor` or
    // `toString` would otherwise be reported as present while `t()` returns a function.
    expect(missingKeys([{ file: 'a', line: 1, key: 'toString' }], {}).map((u) => u.key))
      .toEqual(['toString']);
  });
});

describe('the collector itself', () => {
  const run = (src: string) => literalKeyUses(src, 'x.tsx').map((u) => u.key);

  it('reads a plain call', () => {
    expect(run("const a = t('save', language);")).toEqual(['save']);
  });

  it('reads BOTH arms of a ternary, which this app really writes', () => {
    // GroupChatWidget: t(msg.isPinned ? 'unpinMessage' : 'pinMessage', language)
    expect(run("const a = t(p ? 'unpinMessage' : 'pinMessage', language);"))
      .toEqual(['unpinMessage', 'pinMessage']);
  });

  it('skips a computed key rather than guessing', () => {
    expect(run('const a = t(someVar, language);')).toEqual([]);
    expect(run('const a = t(`dyn-${x}`, language);')).toEqual([]);
  });

  it('is not fooled by a different function that happens to end in t', () => {
    expect(run("const a = fmt('save');")).toEqual([]);
    expect(run("const a = obj.t('save');")).toEqual([]);
  });
});
