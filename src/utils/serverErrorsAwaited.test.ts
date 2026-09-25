// src/utils/serverErrorsAwaited.test.ts
//
// Every server-side error row is AWAITED before the function moves on.
//
// Until 25.09.2026 eleven call sites wrote `void logServerError(…)` — fire and forget — most of them
// in a `catch` right before `throw`. On 2nd-gen Cloud Functions, work left running after the
// response is sent gets no guaranteed CPU, so the row could be lost on exactly the paths it exists
// to record: the admin panel went quiet precisely when something failed. `logServerError` never
// throws (errorLog.ts), so awaiting it can only cost the failure path a few milliseconds.
//
// Read from the syntax tree, not by regex: a call inside a comment or a string must not count, and a
// call hidden behind `void` or `.then` must.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd(), 'functions/src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

function calls(): Array<{ file: string; line: number; awaited: boolean }> {
  const out: Array<{ file: string; line: number; awaited: boolean }> = [];
  for (const file of sources(ROOT)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'logServerError') {
        out.push({
          file: file.slice(ROOT.length + 1).replace(/\\/g, '/'),
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          awaited: ts.isAwaitExpression(node.parent),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

describe('server error rows', () => {
  const all = calls();

  it('the scan finds the call sites (a scan that finds none proves nothing)', () => {
    expect(all.length).toBeGreaterThanOrEqual(13);
  });

  it('every one is awaited', () => {
    expect(all.filter((c) => !c.awaited).map((c) => `${c.file}:${c.line}`)).toEqual([]);
  });
});
