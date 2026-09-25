// scripts/functionsEnvGuard.test.mjs
//
// The guard that keeps a functions deploy from setting the wrong environment. See functionsEnvGuard.mjs.

import { describe, it, expect } from 'vitest';
import { envGuardProblems, keyNames, filledNames, loadKind } from './functionsEnvGuard.mjs';

const P = 'our-days-2a939';
const A = ['default', 'live'];
const GOOD = '# owner\nBOOTSTRAP_ADMIN_EMAILS=a@example.test\n';
const ok = (files) => expect(envGuardProblems(files, P, A)).toEqual([]);
const refused = (files, re) => {
  const r = envGuardProblems(files, P, A);
  expect(r.length).toBeGreaterThan(0);
  if (re) expect(r.join('\n')).toMatch(re);
  return r;
};

describe('the functions env guard', () => {
  it('passes the file as it should be: the bootstrap address, nothing else', () => {
    ok([{ name: '.env', text: GOOD }]);
    ok([{ name: `.env.${P}`, text: GOOD }]);
  });

  it('refuses a deploy with no dotenv at all — the 25.09 deploy that demoted the owner', () => {
    refused([], /BOOTSTRAP_ADMIN_EMAILS is missing or empty/);
  });

  it('refuses a dotenv without the address', () => {
    refused([{ name: '.env', text: 'OTHER=1\n' }], /missing or empty/);
  });

  it('refuses the address present but EMPTY — the same silent loss as no line at all', () => {
    for (const v of ['', ' ', '""', "''", ' # to fill in', '#x']) {
      refused([{ name: '.env', text: `BOOTSTRAP_ADMIN_EMAILS=${v}\n` }], /missing or empty/);
    }
  });

  it('reads the value the CLI keeps: the LAST line, and .env.<projectId> over .env', () => {
    refused([{ name: '.env', text: `${GOOD}BOOTSTRAP_ADMIN_EMAILS=\n` }], /missing or empty/);
    ok([{ name: '.env', text: `BOOTSTRAP_ADMIN_EMAILS=\n${GOOD}` }]);
    refused([{ name: '.env', text: GOOD }, { name: `.env.${P}`, text: 'BOOTSTRAP_ADMIN_EMAILS=\n' }], /missing or empty/);
    // Order of the list must not matter — the CLI's order does.
    refused([{ name: `.env.${P}`, text: 'BOOTSTRAP_ADMIN_EMAILS=\n' }, { name: '.env', text: GOOD }], /missing or empty/);
    ok([{ name: `.env.${P}`, text: GOOD }, { name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=\n' }]);
    expect(filledNames('A="x"\nB=\nC=y # note\nD=a#b\nA=\n')).toEqual(['C', 'D']);
  });

  it('refuses a per-alias file outright: the predeploy step is not told which alias the deploy uses', () => {
    for (const name of ['.env.live', '.env.default', '.ENV.LIVE']) {
      expect(loadKind(name, P, A), name).toBe('alias');
      refused([{ name: '.env', text: GOOD }, { name, text: GOOD }], /cannot tell which one/);
    }
    // And it cannot stand in for .env: with only an alias file, the address counts as missing too.
    refused([{ name: '.env.live', text: GOOD }], /missing or empty/);
  });

  it('sees a differently-cased name the way Windows does', () => {
    expect(loadKind('.ENV', P, A)).toBe('always');
    ok([{ name: '.ENV', text: GOOD }]);
    refused([{ name: '.Env', text: `${GOOD}GEMINI_KEY=x\n` }], /\.Env contains GEMINI_KEY/);
  });

  it('refuses the Gemini key written into a dotenv, under any of its names, and never echoes a value', () => {
    for (const k of ['GEMINI_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_LOCAL']) {
      const r = refused([{ name: '.env', text: `${GOOD}${k}=secret-value-xyz\n` }], new RegExp(`functions/\\.env contains ${k}`));
      expect(r.join('\n')).not.toMatch(/secret-value-xyz|a@example\.test/);
    }
  });

  it('files the CLI does not load at deploy are ignored, whatever they hold', () => {
    for (const name of ['.env.local', '.env.example', '.env.bak']) {
      expect(loadKind(name, P, A), name).toBe(null);
      ok([{ name: '.env', text: GOOD }, { name, text: 'GEMINI_KEY=x\nBOOTSTRAP_ADMIN_EMAILS=\n' }]);
    }
    refused([{ name: '.env.local', text: GOOD }], /missing or empty/);
  });

  it('reads names, not comments', () => {
    expect(keyNames('# GEMINI_KEY=nope\n\nA=1\nexport B = 2\n')).toEqual(['A', 'B']);
    ok([{ name: '.env', text: `${GOOD}# GEMINI_KEY=old note\n` }]);
  });
});
