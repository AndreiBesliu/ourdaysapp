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

  interface Site { file: string; line: number; text: string; node: ts.Node; sf: ts.SourceFile }

  function collect(match: (n: ts.CallExpression, sf: ts.SourceFile) => boolean): Site[] {
    const out: Site[] = [];
    for (const file of tsFiles(FUNCTIONS_SRC)) {
      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && match(n, sf)) {
          out.push({
            file: file.slice(FUNCTIONS_SRC.length + 1).replace(/\\/g, '/'),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            text: n.getText(sf),
            node: n,
            sf,
          });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return out;
  }

  /**
   * Every call INTO the model: `<x>.messages.create|stream|parse(...)` — Anthropic's Messages API
   * (26.09.2026; it was `*.generateContent` while the app ran on Gemini). Matched on the `messages`
   * receiver, so Firestore's own `tx.create(...)` / `ref.create(...)` are not counted as calls.
   */
  const calls = collect((n, sf) => ts.isPropertyAccessExpression(n.expression)
    && ['create', 'stream', 'parse'].includes(n.expression.name.getText(sf))
    && ts.isPropertyAccessExpression(n.expression.expression)
    && n.expression.expression.name.getText(sf) === 'messages');

  /** The name of the function a node sits in. */
  function enclosingFunctionName(node: ts.Node, sf: ts.SourceFile): string | null {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return p.name.getText(sf);
    }
    return null;
  }

  it('found the generation call, so an empty pass cannot be a silent pass', () => {
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('there is exactly ONE, in claude.ts — every feature reaches the model through `generate()`', () => {
    // A second direct call is a second place the cap, the model id and the fallback can drift.
    expect(calls.map((c) => `${c.file}:${c.line}`)).toEqual([expect.stringMatching(/^claude\.ts:\d+$/)]);
  });

  it('caps the output of it', () => {
    // Without the cap nothing enforces the ceiling `estimateUsdFor` prices the output at, and the
    // hold under-estimates silently — no error, just a budget that stops bounding under concurrency.
    for (const c of calls) {
      expect(c.text, `${c.file}:${c.line} — pass max_tokens: AI_MAX_OUTPUT_TOKENS`).toMatch(/max_tokens:\s*AI_MAX_OUTPUT_TOKENS/);
    }
  });

  it('`generate()` is only ever called from `paidGenerate`, which runs it inside `withLedger`', () => {
    // A call outside it would reach the model with no budget hold and no ledger row.
    const gens = collect((n, sf) => ts.isIdentifier(n.expression) && n.expression.getText(sf) === 'generate');
    expect(gens.length, 'no call to generate() found').toBeGreaterThanOrEqual(1);
    for (const g of gens) {
      expect(enclosingFunctionName(g.node, g.sf), `${g.file}:${g.line}`).toBe('paidGenerate');
    }
    const paid = collect((n, sf) => ts.isIdentifier(n.expression) && n.expression.getText(sf) === 'withLedger');
    const inPaid = paid.filter((p) => enclosingFunctionName(p.node, p.sf) === 'paidGenerate');
    expect(inPaid, 'paidGenerate must call withLedger').toHaveLength(1);
    expect(inPaid[0].text).toContain('generate(req)');
    // And with the readers that make the charge honest: usage from the reply, and the mark for a
    // billed reply that is no answer. Dropping either stays green everywhere else.
    const args = (inPaid[0].node as ts.CallExpression).arguments.map((a) => a.getText(inPaid[0].sf));
    expect(args[3]).toBe('usageOf');
    // Calibration learns only from calls whose every input token is a character we sent.
    expect(args[4]).toBe('req.schema ? undefined : chars');
    expect(args[5]).toBe('unfinishedReason');
  });

  it('every AI request runs at effort "low"', () => {
    // Claude Opus 5.5 always thinks, and thinking counts toward `max_tokens`. A higher effort thinks
    // longer, and a reply cut off at the cap is billed and thrown away (`max-tokens` in the ledger).
    const index = parse(join(FUNCTIONS_SRC, 'index.ts'));
    const efforts: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && n.name.getText(index) === 'effort') efforts.push(n.initializer.getText(index));
      ts.forEachChild(n, visit);
    };
    visit(index);
    expect(efforts.length).toBeGreaterThanOrEqual(4);
    expect([...new Set(efforts)]).toEqual(['"low"']);
  });

  it('all five AI features go through `paidGenerate`', () => {
    const features = collect((n, sf) => ts.isIdentifier(n.expression) && n.expression.getText(sf) === 'paidGenerate')
      .map((c) => (c.node as ts.CallExpression).arguments[0]?.getText(c.sf));
    expect(features.sort()).toEqual(['"asset-suggest"', '"auto-checklist"', '"category"', '"checklist"', '"group-digest"']);
  });

  it('uses the same constant the estimate is priced against', () => {
    // Two literals that happen to match today is not the same as one constant. If the estimate
    // said 2048 and a call site said 4096, the hold would under-estimate by half.
    const ledger = readFileSync(LEDGER, 'utf8');
    expect(ledger).toMatch(/export const AI_MAX_OUTPUT_TOKENS = \d+;/);
    expect(ledger).toContain('maxOutTokens = AI_MAX_OUTPUT_TOKENS');
    for (const c of calls) expect(c.text, `${c.file}:${c.line}`).toContain('AI_MAX_OUTPUT_TOKENS');
    // And the model the call names is the one the estimate and the ledger price.
    for (const c of calls) expect(c.text, `${c.file}:${c.line}`).toMatch(/model:\s*AI_MODEL/);
  });
});
