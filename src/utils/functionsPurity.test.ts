// src/utils/functionsPurity.test.ts
//
// Four of this app's tests import straight out of `functions/src/`, which is the right thing to
// do: the fan-out planner, the invite-link verdict, the notification dictionary and the reminder
// window are decisions, and a decision should be tested once, where it is made, rather than
// copied into the app so the copy can drift.
//
// It comes with one condition, and the condition is invisible until it breaks.
//
// CI runs `npm ci` at the repo root. It never installs `functions/node_modules`. So the moment
// anything reachable from an app test imports `firebase-admin` or `firebase-functions`, that test
// stops loading — in CI only. On a developer machine both trees are installed and everything is
// green, which is the worst possible arrangement: the machine that says yes is the one that
// cannot see the problem.
//
// That is not hypothetical. `reminders.test.ts` imported `functions/src/reminders.ts`, which
// declares the scheduled function and therefore imports `firebase-functions/v2/scheduler`. It
// passed here and failed there, on the commit that shipped it. The arithmetic now lives in
// `remindersCore.ts` with no package imports at all, and this test is what keeps it that way —
// because the next person to add an import to a pure module will have no reason to suspect it.
//
// The check walks the RELATIVE import graph from each entry point, so it also catches the
// indirect case: a pure module that starts importing another module that is not.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Every `from '...'` and bare `import '...'`, with whether the statement was type-only. */
function importsOf(code: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  const re = /(?:^|[\n;])[ \t]*(import|export)[ \t]+(type[ \t]+)?(?:[^;'"]*?[ \t]from[ \t]*)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push({ spec: m[3], typeOnly: !!m[2] });
  }
  return out;
}

const isRelative = (spec: string) => spec.startsWith('./') || spec.startsWith('../');

/** Resolve a relative specifier to a file, or throw — an unresolvable import is a finding too. */
function resolveRelative(fromFile: string, spec: string): string {
  const base = join(dirname(fromFile), spec);
  for (const candidate of [base, base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch { /* a directory: keep looking */ }
    }
  }
  throw new Error(`cannot resolve ${spec} from ${fromFile}`);
}

function walk(dir: string, hit: (file: string) => void) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'warlord') continue;
      walk(full, hit);
    } else hit(full);
  }
}

/** The app tests that reach across into `functions/src`, and what they reach for. */
function entryPoints(): { test: string; target: string }[] {
  const found: { test: string; target: string }[] = [];
  walk(SRC, (file) => {
    if (!file.endsWith('.test.ts') && !file.endsWith('.test.tsx')) return;
    const code = readFileSync(file, 'utf8');
    for (const { spec } of importsOf(code)) {
      if (!isRelative(spec)) continue;
      const resolved = join(dirname(file), spec);
      if (resolved.includes(join(ROOT, 'functions'))) found.push({ test: file, target: spec });
    }
  });
  return found;
}

/** Every package import reachable from `entry` by relative edges, with the chain that got there. */
function packageImportsFrom(entry: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    for (const { spec, typeOnly } of importsOf(code)) {
      if (isRelative(spec)) {
        visit(resolveRelative(file, spec), [...chain, spec]);
        continue;
      }
      // A statement-level `import type` is erased before anything tries to resolve it, so it
      // costs nothing at run time and is allowed.
      if (typeOnly) continue;
      problems.push(`${[...chain, spec].join(' -> ')}  (in ${file.slice(ROOT.length + 1)})`);
    }
  };

  visit(entry, []);
  return problems;
}

describe('what the app tests borrow from functions/', () => {
  const entries = entryPoints();

  it('there are some, so this test is not passing on an empty list', () => {
    // A guard that checks nothing is worse than no guard: it reports green for ever.
    expect(entries.length).toBeGreaterThan(0);
  });

  it('nothing reachable from an app test imports a package', () => {
    // CI installs only the app's dependencies. A package import anywhere in this graph loads
    // fine here and fails there, which makes the local green meaningless.
    const problems: string[] = [];
    for (const { test, target } of entries) {
      const entry = resolveRelative(test, target);
      for (const p of packageImportsFrom(entry)) {
        problems.push(`${test.slice(ROOT.length + 1)} -> ${target}: ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the reminder arithmetic in particular imports no packages', () => {
    // Named on its own because this is the one that actually shipped broken.
    //
    // It asks about IMPORTS, not about the text of the file. The first version of this check
    // searched for the string 'firebase-functions' and failed on the header comment explaining
    // why it must not be imported — a guard that reads prose reports on prose.
    const core = join(ROOT, 'functions', 'src', 'remindersCore.ts');
    expect(existsSync(core)).toBe(true);
    const specs = importsOf(readFileSync(core, 'utf8'))
      .filter((i) => !isRelative(i.spec) && !i.typeOnly)
      .map((i) => i.spec);
    expect(specs).toEqual([]);
  });
});
