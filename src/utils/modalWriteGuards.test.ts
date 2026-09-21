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

/** The full text of an arrow function assigned to `const <name> = ...`. */
function bodyOf(name: string): string | null {
  const init = declOf(name);
  return init;
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

  it('checks it before every state write that follows the await', () => {
    // The await is the line that makes this necessary; every setState after it needs the guard
    // in front of it, on the success path and on the failure path alike.
    const after = body!.slice(body!.indexOf('await generateChecklistForTask'));
    expect(after, 'no guard between the await and what follows').toContain('stillHere()');
    const guards = (after.match(/stillHere\(\)/g) || []).length;
    expect(guards, 'the success path, the error path and the finally each need one')
      .toBeGreaterThanOrEqual(3);
  });
});
