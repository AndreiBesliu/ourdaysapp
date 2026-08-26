// src/utils/silentListeners.test.ts
// The sweep, kept swept.
//
// On 2026-08-25 an audit found 28 of the 30 `onSnapshot` calls in this app had no error callback.
// A denied read or a missing composite index makes such a listener never fire: state keeps its
// initial `[]`, and the screen renders its ordinary "nothing yet" copy. That is how the expenses
// collection stayed denied for three months without anyone seeing an error — the SDK does not
// throw and does not reject, so `reportError`'s global hooks never fired either.
//
// All of them now go through `liveQuery` / `liveDoc`, where the error argument is REQUIRED by the
// type. This test is what stops the next feature from quietly adding number 31.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..');

// `liveQuery.ts` is where the wrapper itself calls onSnapshot — that is the whole point of it.
// `ExpensesTab.tsx` predates the wrapper and passes its own handlers to both listeners; it is the
// screen the rule was learned on, and rewriting a correct file just to satisfy a grep is churn.
const ALLOWED = ['utils/liveQuery.ts', 'components/ExpensesTab.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // The game is a submodule with its own rules and no Firestore of its own.
    if (name === 'warlord' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no listener may fail in silence', () => {
  const files = walk(SRC);

  it('finds the app source at all (so a broken walk cannot pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith('liveQuery.ts'))).toBe(true);
  });

  it('every Firestore listener goes through liveQuery or liveDoc', () => {
    const offenders: string[] = [];
    for (const f of files) {
      // Windows hands back backslashes; the allowlist is written one way only.
      const rel = f.slice(SRC.length + 1).split(sep).join('/');
      if (ALLOWED.some((a) => rel === a)) continue;
      const src = readFileSync(f, 'utf8');
      // Only real calls: `onSnapshot(` with a paren. Prose in comments mentions the name.
      for (const line of src.split(/\r?\n/)) {
        const code = line.replace(/^\s*(\/\/|\*).*$/, '');
        if (/\bonSnapshot\s*\(/.test(code)) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders, `raw onSnapshot found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the two allowed files still exist, so the allowlist cannot rot into a blanket pass', () => {
    for (const a of ['utils/liveQuery.ts', 'components/ExpensesTab.tsx']) {
      expect(() => statSync(join(SRC, a))).not.toThrow();
    }
  });
});
