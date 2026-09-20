// src/utils/aiLedgerShape.test.ts
//
// Two properties of the paid-call path that decide whether the budget is real. Neither can be
// tested by importing: `functions/src/aiLedger.ts` pulls in `firebase-admin`, and CI installs only
// the root package. Both are STRUCTURAL properties of the source, so a parser can hold them.
//
// ── 1. A refund means the call produced nothing ───────────────────────────────────────────
//
// `withLedger` used to run the generation AND the bookkeeping inside one `try`. `closeLedgerRow`
// ends in `batch.commit()`, the last thing between a successful generation and the settle — and
// when it threw, control reached a catch whose comment said "Nothing measurable was spent" and
// which called `settleBudget(hold, 0)`. That statement is true for a provider failure and false
// for this one. A call that really cost money moved the day's counter by zero, and was never
// priced into the rollups either, so the spend was invisible in both places.
//
// Not remote: that batch writes `aiSpendDaily/{date}` — one document per day for the whole app —
// on every AI call, and Firestore sustains roughly one write per second per document.
//
// ── 2. The "pessimistic" hold must actually be a ceiling ──────────────────────────────────
//
// `estimateUsdFor` prices output at `AI_MAX_OUTPUT_TOKENS` and its comment says output "is assumed
// to be the model's maximum". No call site passed `maxOutputTokens`, so that was an assumption
// rather than a fact, and a longer response made the hold under-estimate the very call it bounded.
// A hold that under-estimates bounds nothing under concurrency, which is the whole reason it
// exists.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const FUNCTIONS_SRC = resolve(process.cwd(), 'functions', 'src');
const LEDGER = join(FUNCTIONS_SRC, 'aiLedger.ts');

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Find a top-level function declaration by name. */
function functionNamed(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | null {
  let found: ts.FunctionDeclaration | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === name) found = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Every `try` statement inside a node, with the source text of its block and its catch. */
function tryBlocks(node: ts.Node, sf: ts.SourceFile): { block: string; handler: string }[] {
  const out: { block: string; handler: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTryStatement(n)) {
      out.push({
        block: n.tryBlock.getText(sf),
        handler: n.catchClause ? n.catchClause.getText(sf) : '',
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

describe('a refund means the call produced nothing', () => {
  const sf = parse(LEDGER);
  const fn = functionNamed(sf, 'withLedger');

  it('found withLedger, so an empty pass cannot be a silent pass', () => {
    expect(fn, 'withLedger not found in functions/src/aiLedger.ts').not.toBeNull();
  });

  it('never settles at zero from a try that also did the bookkeeping', () => {
    // THE regression. Any `try` whose catch refunds in full must contain the generation and
    // nothing else — specifically not `closeLedgerRow`, whose commit is the likeliest thing to
    // throw after the money is already spent.
    const offenders = tryBlocks(fn!, sf)
      .filter((t) => /settleBudget\(\s*hold\s*,\s*0\s*\)/.test(t.handler))
      .filter((t) => t.block.includes('closeLedgerRow'));

    expect(
      offenders.map((t) => t.block.slice(0, 120)),
      'A try whose catch refunds the whole hold must not also contain closeLedgerRow: '
      + 'its commit throws AFTER the tokens are burned.',
    ).toEqual([]);
  });

  it('refunds in full in exactly one place', () => {
    // More than one would mean a second path can zero the charge, and this check would have to
    // be re-derived for it. Zero would mean the hold never releases on a failed call.
    //
    // Counted as CALL EXPRESSIONS, not as text. My first version regexed the file and found two
    // — the second was the sentence in the comment above `withLedger` describing the bug. A
    // source scanner satisfied by prose is the exact failure this repo hit twice today.
    let zeroSettles = 0;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)
          && n.expression.getText(sf) === 'settleBudget'
          && n.arguments.length === 2
          && n.arguments[1].getText(sf) === '0') {
        zeroSettles++;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(zeroSettles).toBe(1);
  });

  it('runs the generation in a try of its own', () => {
    // The shape that makes the rule above possible to state at all.
    const runOnly = tryBlocks(fn!, sf).find((t) => t.block.includes('await run()'));
    expect(runOnly, 'no try wraps `await run()`').toBeDefined();
    expect(runOnly!.block).not.toContain('closeLedgerRow');
    expect(runOnly!.block).not.toContain('usageFrom');
  });
});

describe('the pessimistic hold is a real ceiling', () => {
  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'lib') continue;
      const f = join(dir, e);
      if (statSync(f).isDirectory()) tsFiles(f, out);
      else if (e.endsWith('.ts')) out.push(f);
    }
    return out;
  }

  /** Every `*.generateContent({...})` call, with its argument text. */
  function generationCalls(): { file: string; line: number; text: string }[] {
    const out: { file: string; line: number; text: string }[] = [];
    for (const file of tsFiles(FUNCTIONS_SRC)) {
      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)
            && ts.isPropertyAccessExpression(n.expression)
            && n.expression.name.getText(sf) === 'generateContent') {
          out.push({
            file: file.slice(FUNCTIONS_SRC.length + 1).replace(/\\/g, '/'),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            text: n.getText(sf),
          });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return out;
  }

  const calls = generationCalls();

  it('found the generation calls, so an empty pass cannot be a silent pass', () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('caps the output of every one of them', () => {
    // A new call site added without this makes the hold under-estimate silently — there is no
    // error, just a budget that stops bounding under concurrency.
    const uncapped = calls.filter((c) => !c.text.includes('maxOutputTokens'));
    expect(
      uncapped.map((c) => `${c.file}:${c.line}`),
      'Pass config: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS } — estimateUsdFor prices the output '
      + 'at that ceiling, and without it nothing enforces one.',
    ).toEqual([]);
  });

  it('uses the same constant the estimate is priced against', () => {
    // Two literals that happen to match today is not the same as one constant. If the estimate
    // said 2048 and a call site said 4096, the hold would under-estimate by half.
    const ledger = readFileSync(LEDGER, 'utf8');
    expect(ledger).toMatch(/export const AI_MAX_OUTPUT_TOKENS = \d+;/);
    expect(ledger).toContain('maxOutTokens = AI_MAX_OUTPUT_TOKENS');
    for (const c of calls) expect(c.text, `${c.file}:${c.line}`).toContain('AI_MAX_OUTPUT_TOKENS');
  });
});
