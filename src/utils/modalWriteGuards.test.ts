// src/utils/modalWriteGuards.test.ts
//
// Two invariants of `EventDetailsModal` that no unit test can reach, because the modal needs a
// DOM and a Firestore and this suite has neither. They are STRUCTURAL properties of the source,
// so a parser can hold them — the same arrangement as `aiLedgerShape.test.ts`.
//
// Both were found by an adversarial review of code that had already shipped, and both are the
// same species of bug: state that outlives the thing it describes, in a component that is NEVER
// UNMOUNTED. `CalendarHome` renders this modal once and toggles `isOpen`, so nothing resets
// between one event and the next unless somebody wrote the reset.
//
//   THE CACHED PROMISE — `resolveWriteTarget` materialises a recurring occurrence into a real
//     override document and caches the in-flight promise so two quick taps cannot create two
//     documents. The cache was a bare promise, set on success and cleared only on failure. So
//     after any occurrence had been materialised, EVERY later occurrence of EVERY series reused
//     it: tick a checklist item on next week's rehearsal and it lands on last week's.
//
//   THE STALE HANDLER — `handleRetryAiChecklist` awaits a multi-second AI call and then writes
//     component state. Closing the event and opening another while it runs is the ordinary thing
//     to do, and without a guard the result landed on whatever was open when it returned.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const FILE = resolve(process.cwd(), 'src', 'components', 'EventDetailsModal.tsx');
const src = readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** The initializer text of `const <name> = ...`, or null. */
function declOf(name: string): string | null {
  let out: string | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer) {
      out = n.initializer.getText(sf);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The CODE of an arrow function assigned to `const <name> = ...`. */
function bodyOf(name: string): string | null {
  return declOf(name);
}

/** The arrow-function NODE for `const <name> = async () => {...}`. */
function nodeOf(name: string): ts.Node | null {
  let out: ts.Node | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer) {
      out = n.initializer;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every node inside `root` matching `pred`, in source order. */
function nodesIn(root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out.sort((a, b) => a.getStart(sf) - b.getStart(sf));
}

const isCallTo = (name: string) => (n: ts.Node) =>
  ts.isCallExpression(n) && n.expression.getText(sf) === name;

/** The nearest enclosing `if` condition, as text — or '' when unguarded. */
function guardText(n: ts.Node, root: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p && p !== root; p = p.parent) {
    if (ts.isIfStatement(p)) return p.expression.getText(sf);
  }
  return '';
}

describe('the override cache can only answer for the occurrence it was made for', () => {
  it('found the ref, so an empty pass cannot be a silent pass', () => {
    expect(declOf('materialising'), 'materialising ref not found').not.toBeNull();
  });

  it('is keyed, not a bare promise', () => {
    // A bare `Promise<string> | null` is the shape that served one override to every occurrence.
    const init = declOf('materialising')!;
    expect(init).toContain('key');
    expect(
      /useRef<\s*Promise<string>\s*\|\s*null\s*>/.test(init),
      'materialising must carry the target it belongs to, not just a promise',
    ).toBe(false);
  });

  it('compares the key before reusing anything', () => {
    const body = bodyOf('resolveWriteTarget')!;
    expect(body, 'resolveWriteTarget must derive a key from the plan')
      .toMatch(/const key = `\$\{plan\.parentId\}_\$\{plan\.overrideDate\}`/);
    expect(body, 'a cached promise must only be reused when its key matches')
      .toMatch(/cached\.key === key/);
  });
});

describe('a retry that outlives its event does not write to the next one', () => {
  const body = bodyOf('handleRetryAiChecklist');

  it('found the handler, so an empty pass cannot be a silent pass', () => {
    expect(body, 'handleRetryAiChecklist not found').not.toBeNull();
  });

  it('captures the event it started on, from a ref rather than the closure', () => {
    // Reading `event.id` after the await reads the closure's copy — which is the bug, not the
    // guard. The ref is written during render, so it always holds what is on screen NOW.
    expect(body!).toMatch(/const startedFor = event\.id/);
    expect(body!).toMatch(/eventIdRef\.current/);
  });

  it('does NOT guard the write — the call was paid for and belongs to that event', () => {
    // The rule this replaces COUNTED: "at least 3 occurrences of stillHere() after the await".
    // A count cannot say WHERE, and the placement that caused the bug — the guard as the first
    // statement of the write try — satisfied it perfectly. The gate was enforcing the defect.
    //
    // Then the first rewrite searched the body TEXT and matched the comment describing the bug,
    // four lines above the code. Positions on the AST cannot be confused by prose at all, which
    // is why this asks the parser rather than the string.
    const fn = nodeOf('handleRetryAiChecklist')!;
    const writes = nodesIn(fn, isCallTo('updateDoc'));
    expect(writes.length, 'no updateDoc in the retry handler').toBeGreaterThan(0);
    const firstWrite = writes[0].getStart(sf);

    const earlyExits = nodesIn(fn, (n) => ts.isReturnStatement(n))
      .filter((n) => n.getStart(sf) < firstWrite)
      .filter((n) => guardText(n, fn).includes('stillHere'));

    expect(
      earlyExits.map((n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1),
      'A stillHere()-guarded return before the first updateDoc skips the WRITE, not just the '
      + 'on-screen state: closing the modal mid-generation then discards the suggestions and '
      + 'leaves the failure card in place, inviting a second paid call.',
    ).toEqual([]);
  });

  it('but DOES guard what it puts on screen', () => {
    // The other half. Writing another event's checklist into the open modal is the hazard the
    // guard exists for, so those two setters must stay behind it.
    const fn = nodeOf('handleRetryAiChecklist')!;
    for (const setter of ['setChecklist', 'setAiOutcomeDone']) {
      const calls = nodesIn(fn, isCallTo(setter));
      expect(calls.length, `${setter} is not called at all`).toBeGreaterThan(0);
      const unguarded = calls.filter((n) => !guardText(n, fn).includes('stillHere'));
      expect(
        unguarded.map((n) => `${setter} @ ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`),
        `${setter} must be behind stillHere(), or it lands on whatever event is open now`,
      ).toEqual([]);
    }
  });

  it('never shows a message on a card it has already hidden', () => {
    // `setAiOutcomeDone(true)` removes the amber card, and `aiRetryError` renders INSIDE it. Set
    // before the write, it made the "could not be saved" sentence unreachable by construction.
    const fn = nodeOf('handleRetryAiChecklist')!;
    const lastWrite = nodesIn(fn, isCallTo('updateDoc')).slice(-1)[0].getStart(sf);
    const done = nodesIn(fn, isCallTo('setAiOutcomeDone'))
      .filter((n) => (n as ts.CallExpression).arguments[0]?.getText(sf) === 'true');
    expect(done.length, 'setAiOutcomeDone(true) not found').toBe(1);
    expect(done[0].getStart(sf)).toBeGreaterThan(lastWrite);
  });
});

describe('a claim nobody finished is answered, not left spinning (01.11.2026)', () => {
  // The trigger now leaves `aiChecklist: { status: "running" }` while a delivery works. One that dies
  // leaves it for good (the trigger is not retried), with the assistant still assigned. The window
  // reads the note through `checklistNoteView`, which turns such a claim into a failure with Retry.
  const text = (n: ts.Node) => n.getText(sf).replace(/\s+/g, ' ');
  const binaries = (op: string) => nodesIn(sf, (n) => ts.isBinaryExpression(n) && text(n) === op);

  it('the card and the skeleton both read the view, not the raw status', () => {
    expect(binaries("aiNote?.kind === 'failed'").length, 'the card must render for the view’s failures').toBeGreaterThan(0);
    expect(binaries("aiNote?.kind !== 'failed'"), 'the skeleton must give way to that card').toHaveLength(1);
    // The raw status check showed only recorded failures: a dead claim kept the skeleton forever.
    expect(binaries("event.aiChecklist?.status === 'failed'")).toEqual([]);
    const view = nodesIn(sf, isCallTo('checklistNoteView'));
    expect(view, 'checklistNoteView is called once').toHaveLength(1);
    // Fed the event as it is, and watched on the monotonic clock (a device clock may run ahead).
    const input = declOf('aiNoteInput');
    expect(input, 'aiNoteInput not found').not.toBeNull();
    for (const prop of [
      'note: event.aiChecklist',
      "aiAssigned: !!event.assigneeIds?.includes('ai_assistant')",
      'checklistEmpty: checklist.length === 0',
      'createdAt: event.createdAt',
    ]) expect(input!.replace(/\s+/g, ' ')).toContain(prop);
    expect(text((view[0] as ts.CallExpression).arguments[2])).toBe('aiPendingKey ? watchedFor(aiPendingKey, performance.now()) : 0');
  });

  it('Retry takes the assistant off with the note, when it is still assigned', () => {
    // Otherwise a late duplicate delivery finds the work open (assistant on, no note) and pays again.
    const fn = nodeOf('handleRetryAiChecklist')!;
    const clears = nodesIn(fn, isCallTo('updateDoc'))
      .map((n) => (n as ts.CallExpression).arguments[1])
      .filter((a) => a && ts.isObjectLiteralExpression(a) && text(a).includes('aiChecklist: deleteField()'));
    expect(clears, 'one write clears the note').toHaveLength(1);
    expect(text(clears[0])).toContain("...(event.assigneeIds?.includes('ai_assistant') ? { assigneeIds: arrayRemove('ai_assistant') } : {})");
  });
});
