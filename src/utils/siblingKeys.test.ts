// src/utils/siblingKeys.test.ts
//
// Two siblings in one children array must never carry the same `key`.
//
// ── What happened on 2026-09-20 ───────────────────────────────────────────────────────────
//
// `CalendarHome` rendered `<GroupChatWidget key={activeGroupId}>` and, 180 lines later,
// `<GamesHubModal key={activeGroupId}>`. Both are slots in the SAME children array — the first is
// inside `{cond && …}`, which is an expression that evaluates to the element itself, not a wrapper.
//
// React reconciles a keyed update by building a Map of the old children:
//
//     existingChildren.set(currentFirstChild.key, currentFirstChild)   // react-dom, mapRemainingChildren
//
// A plain `Map.set`, so the LATER duplicate overwrites the earlier one. The deletion pass then
// does `oldFiber.forEach(child => deleteChild(...))` — it deletes only what is still IN that map.
// The evicted fiber is never deleted.
//
// So switching groups with the chat open left the whole widget mounted for ever: its DOM stayed
// painted, its effect cleanups never ran, its Firestore listeners were never unsubscribed, and
// its close button called `setIsOpen(false)` on a fiber React no longer renders. The owner saw
// one group's chat pinned under another group's pill with a dead X. Six switches, five stacked
// panes, none of them closeable.
//
// React's dev build warns "Encountered two children with the same key" — DEV ONLY, so nothing
// says a word on live. Nothing else in this repo could catch it either: it is not a type error,
// not an ESLint rule in the gate, and the screen is behind a login.
//
// ── Why a parser and not a regex ──────────────────────────────────────────────────────────
//
// The question is "are these two elements siblings", which is a fact about the tree, not about
// the text. A regex cannot tell a sibling from a child, and cannot tell that `.map()` results are
// reconciled as a nested array and therefore are NOT siblings of their neighbours. `typescript`
// is already a devDependency, so the real parser is free.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname, '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    // The Warlord submodule is a separate product with its own repo and its own gates.
    if (e.isDirectory()) { if (e.name !== 'warlord' && e.name !== 'node_modules') tsxFiles(p, out); }
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export interface DuplicateKey {
  file: string;
  line: number;
  key: string;
  firstLine: number;
}

/**
 * Every child slot of one JSX parent, as React will place it in the children array.
 *
 * `{cond && <X/>}`, `{a ? <X/> : <Y/>}`, `{x ?? <Y/>}` and `{(<X/>)}` all put the element itself
 * directly into the array, so they are siblings of their neighbours. A `.map()` produces a nested
 * array, which React reconciles in its own scope — those keys only have to be unique among
 * themselves, so they are deliberately NOT collected.
 */
function directChildElements(node: ts.Node): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = [];

  const unwrap = (e: ts.Expression | undefined): void => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return unwrap(e.expression);
    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken
          || k === ts.SyntaxKind.QuestionQuestionToken) {
        unwrap(e.left); unwrap(e.right);
      }
      return;
    }
    if (ts.isConditionalExpression(e)) { unwrap(e.whenTrue); unwrap(e.whenFalse); return; }
    if (ts.isJsxElement(e)) { out.push(e.openingElement); return; }
    if (ts.isJsxSelfClosingElement(e)) { out.push(e); return; }
    // Anything else — a call, an identifier, a .map() — is opaque or its own scope. Left alone.
  };

  const children: ts.NodeArray<ts.JsxChild> =
    ts.isJsxElement(node) ? node.children
      : ts.isJsxFragment(node) ? node.children
        : ([] as unknown as ts.NodeArray<ts.JsxChild>);

  for (const child of children) {
    if (ts.isJsxElement(child)) out.push(child.openingElement);
    else if (ts.isJsxSelfClosingElement(child)) out.push(child);
    else if (ts.isJsxExpression(child)) unwrap(child.expression);
  }
  return out;
}

/** The source text of a `key` attribute, or null when the element has none. */
function keyText(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): string | null {
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'key') continue;
    const init = a.initializer;
    if (!init) return null;
    if (ts.isJsxExpression(init)) return init.expression ? init.expression.getText(sf) : null;
    return init.getText(sf);
  }
  return null;
}

export function duplicateSiblingKeys(source: string, fileName: string): DuplicateKey[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: DuplicateKey[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const seen = new Map<string, number>();
      for (const el of directChildElements(node)) {
        const k = keyText(el, sf);
        if (!k) continue;
        const line = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
        const first = seen.get(k);
        if (first !== undefined) found.push({ file: fileName, line, key: k, firstLine: first });
        else seen.set(k, line);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

describe('no two siblings share a key', () => {
  it('holds across every .tsx in src/', () => {
    const hits = tsxFiles(SRC).flatMap((f) =>
      duplicateSiblingKeys(readFileSync(f, 'utf8'), relative(SRC, f)));

    expect(hits.map((h) => `${h.file}:${h.line} key=${h.key} (first at ${h.firstLine})`)).toEqual([]);
  });
});

describe('the net catches what it claims to, and nothing else', () => {
  const find = (src: string) => duplicateSiblingKeys(src, 'x.tsx');

  it('catches the exact shape that shipped — a conditional slot beside a plain element', () => {
    // `{cond && <A/>}` is not a wrapper. It evaluates to the element, which lands in the same
    // children array as <B/>. That is what made these two siblings, 180 lines apart.
    const hits = find('const x = <div>{cond && <A key={id} />}<B key={id} /></div>;');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('id');
  });

  it('catches it through a ternary and through parentheses', () => {
    expect(find('const x = <div>{c ? <A key={id} /> : <Z/>}<B key={id} /></div>;')).toHaveLength(1);
    expect(find('const x = <div>{(<A key={id} />)}<B key={id} /></div>;')).toHaveLength(1);
  });

  it('catches two plain siblings, and a fragment parent', () => {
    expect(find('const x = <div><A key={id} /><B key={id} /></div>;')).toHaveLength(1);
    expect(find('const x = <><A key={id} /><B key={id} /></>;')).toHaveLength(1);
  });

  it('does NOT flag a .map(), whose keys live in their own array', () => {
    // The usual and correct pattern. Flagging it would make the guard noise, and a noisy gate is
    // a gate somebody turns off.
    expect(find('const x = <div>{xs.map(x => <A key={x.id} />)}</div>;')).toEqual([]);
    expect(find('const x = <div>{xs.map(x => <A key={id} />)}<B key={id} /></div>;')).toEqual([]);
  });

  it('does NOT flag the same key at different depths', () => {
    expect(find('const x = <div><A key={id} /><section><B key={id} /></section></div>;')).toEqual([]);
  });

  it('does NOT flag elements with no key, or different keys', () => {
    expect(find('const x = <div><A /><B /></div>;')).toEqual([]);
    expect(find('const x = <div><A key={`chat-${id}`} /><B key={`games-${id}`} /></div>;')).toEqual([]);
  });

  it('would have caught CalendarHome as it was this morning', () => {
    // The regression, reduced. If this ever passes, the guard has stopped guarding.
    const before = `
      const x = (
        <div>
          {activeGroupId !== 'personal' && (
            <GroupChatWidget key={activeGroupId} convId={activeGroupId} />
          )}
          <GamesHubModal key={activeGroupId} isOpen={open} />
        </div>
      );`;
    const hits = find(before);
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('activeGroupId');
  });
});
