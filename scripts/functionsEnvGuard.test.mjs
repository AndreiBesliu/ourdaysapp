// scripts/functionsEnvGuard.test.mjs
//
// The guard that keeps a functions deploy from dropping the Gemini key. See functionsEnvGuard.mjs.

import { describe, it, expect } from 'vitest';
import { envGuardProblems, keyNames, deployLoaded } from './functionsEnvGuard.mjs';

const P = 'our-days-2a939';
const A = ['default', 'live'];

describe('the functions env guard', () => {
  it('no dotenv at all: the live environment is kept, nothing to refuse', () => {
    expect(envGuardProblems([], P, A)).toEqual([]);
  });

  it('refuses the file that existed on 24.09: bootstrap email only, no key', () => {
    const r = envGuardProblems([{ name: '.env', text: '# note\nBOOTSTRAP_ADMIN_EMAILS=a@example.test\n' }], P, A);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/functions\/\.env .*GEMINI_API_KEY_LOCAL/);
    // Names only: a value never appears in what the guard says.
    expect(r[0]).not.toMatch(/a@example\.test/);
  });

  it('the per-project and per-alias files count too', () => {
    for (const name of [`.env.${P}`, '.env.live', '.env.default']) {
      expect(envGuardProblems([{ name, text: 'X=1' }], P, A), name).toHaveLength(1);
    }
  });

  it('the emulator-only file does not', () => {
    expect(deployLoaded('.env.local', P, A)).toBe(false);
    expect(envGuardProblems([{ name: '.env.local', text: 'X=1' }], P, A)).toEqual([]);
  });

  it('passes a dotenv that carries the key, in any of the loaded files', () => {
    expect(envGuardProblems([
      { name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=x' },
      { name: '.env.live', text: 'export GEMINI_API_KEY_LOCAL=redacted' },
    ], P, A)).toEqual([]);
  });

  it('reads names, not comments', () => {
    expect(keyNames('# GEMINI_API_KEY_LOCAL=nope\n\nA=1\nexport B = 2\n')).toEqual(['A', 'B']);
  });
});
