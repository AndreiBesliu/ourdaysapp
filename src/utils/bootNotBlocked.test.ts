// src/utils/bootNotBlocked.test.ts
//
// Nothing on the sign-in path may WAIT for a Firestore write.
//
// ── The failure this prevents ─────────────────────────────────────────────────────────────
//
// A Firestore write resolves on SERVER acknowledgement. `firebase.ts` turns on IndexedDB
// persistence, so an offline write lands in the local cache at once and is queued — and its
// promise never settles. Not rejected. Not timed out. Pending, for ever.
//
// `App.tsx` awaited three of them inside `onAuthStateChanged`, before `setLoading(false)`. Open
// the app with no connection and you got the loading spinner and nothing else, sitting on top of
// a complete local cache that could have drawn the entire calendar. A `try/catch` does not help:
// there is nothing to catch. A timeout would have helped, and there was none.
//
// This is not a rule about style. It is the difference between an app that works on a train and
// an app that shows a spinner.
//
// ── Why a parser ──────────────────────────────────────────────────────────────────────────
//
// The property is structural — "is this await, inside THIS callback, applied to a write?" — and a
// regex cannot answer it. Three gates in this repo went blind in exactly that way on 2026-09-20,
// one of them skipping 72% of what it claimed to check. `typescript` is already a devDependency.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const APP = join(process.cwd(), 'src', 'App.tsx');

/** Firestore calls that only settle when the server answers. Reads are fine — the cache serves them. */
const WRITES = new Set(['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'setDocs', 'writeBatch', 'runTransaction']);

export interface BlockingAwait { line: number; call: string }

/**
 * Every `await <write>(...)` lexically inside the `onAuthStateChanged` callback.
 *
 * A `.catch(...)` or `.then(...)` chained onto the write still counts: awaiting the chain waits
 * for the same unsettled promise. That was true of two of the three that shipped.
 */
export function blockingAwaits(source: string, fileName = 'App.tsx'): BlockingAwait[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: BlockingAwait[] = [];

  /** Walk down `foo(...).catch(...).then(...)` to the call that started it. */
  const rootCallee = (e: ts.Expression): string | null => {
    let cur: ts.Node = e;
    for (;;) {
      if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isAwaitExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isCallExpression(cur)) {
        const fn = cur.expression;
        if (ts.isIdentifier(fn)) return fn.text;
        if (ts.isPropertyAccessExpression(fn)) { cur = fn.expression; continue; }
        return null;
      }
      return null;
    }
  };

  let body: ts.Node | null = null;
  const scanInside = (node: ts.Node): void => {
    // STOP at a function boundary. An `await` inside a nested callback is not on the path from
    // the auth callback to `setLoading(false)` — it runs later, on its own stack. The FCM-token
    // write inside `addListener('registration', …)` is exactly that, and flagging it would be a
    // false failure. A gate that cries wolf is a gate somebody switches off.
    if (node !== body && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)
        || ts.isFunctionDeclaration(node))) return;
    if (ts.isAwaitExpression(node)) {
      const name = rootCallee(node.expression);
      if (name && WRITES.has(name)) {
        found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, call: name });
      }
    }
    ts.forEachChild(node, scanInside);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'onAuthStateChanged') {
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) { body = arg.body; scanInside(arg.body); }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('the sign-in path never waits for a write', () => {
  const source = readFileSync(APP, 'utf8');

  it('awaits no Firestore write inside onAuthStateChanged', () => {
    expect(
      blockingAwaits(source).map((b) => `App.tsx:${b.line} await ${b.call}(…)`),
      'Offline, a write promise never settles. Use `void write().catch(report)` instead.',
    ).toEqual([]);
  });

  it('actually found the callback, so an empty pass cannot be a silent pass', () => {
    // The honesty check. `buttonNames.test.ts` shipped one that counted how many buttons EXISTED
    // rather than how many it examined, and stayed green while inspecting 28% of them.
    expect(source).toContain('onAuthStateChanged');
    // There ARE awaits in there — of reads, and of the auth SDK — so a scanner that found none at
    // all would be broken rather than reassuring.
    const anyAwait = /await\s/.test(source.slice(source.indexOf('onAuthStateChanged')));
    expect(anyAwait).toBe(true);
  });
});

describe('the detector itself', () => {
  const wrap = (body: string) => `onAuthStateChanged(auth, async (u) => { ${body} });`;

  it('catches a bare awaited write', () => {
    expect(blockingAwaits(wrap('await setDoc(ref, x);')).map((b) => b.call)).toEqual(['setDoc']);
  });

  it('catches one hidden behind .catch() — two of the three that shipped looked like this', () => {
    expect(blockingAwaits(wrap('await setDoc(ref, x).catch(() => {});')).map((b) => b.call)).toEqual(['setDoc']);
    expect(blockingAwaits(wrap('await updateDoc(ref, x).catch(e => log(e)).then(f);')).map((b) => b.call))
      .toEqual(['updateDoc']);
  });

  it('accepts a write that is started and not awaited', () => {
    expect(blockingAwaits(wrap('void setDoc(ref, x).catch(() => {});'))).toEqual([]);
  });

  it('accepts an awaited READ — the cache answers those offline', () => {
    expect(blockingAwaits(wrap('const s = await getDoc(ref);'))).toEqual([]);
  });

  it('ignores an await inside a NESTED callback, which runs on its own stack', () => {
    // The real case: PushNotifications.addListener('registration', async t => { await updateDoc… })
    // is lexically inside the auth callback and dynamically nowhere near it.
    expect(blockingAwaits(wrap("on('x', async (t) => { await updateDoc(ref, t); });"))).toEqual([]);
    expect(blockingAwaits(wrap('void (async () => { await setDoc(ref, x); })();'))).toEqual([]);
  });

  it('ignores a write outside the callback', () => {
    expect(blockingAwaits('async function save() { await setDoc(ref, x); }')).toEqual([]);
  });
});
