// scripts/functionsEnvGuard.test.mjs
//
// The guard that keeps a functions deploy from setting the wrong environment. See functionsEnvGuard.mjs.

import { describe, it, expect } from 'vitest';
import { envGuardProblems, envGuardWarnings, keyNames, filledNames, loadKind, FEDERATION } from './functionsEnvGuard.mjs';

const P = 'our-days-2a939';
const A = ['default', 'live'];
// The file as it is before the Claude federation exists: the address, and the param's blank line.
const GOOD = '# owner\nBOOTSTRAP_ADMIN_EMAILS=a@example.test\nAI_SERVICE_ACCOUNT=\n';
// And after: the four federation values filled.
const FEDERATED = 'BOOTSTRAP_ADMIN_EMAILS=a@example.test\nAI_SERVICE_ACCOUNT=ourdays-ai@\n'
  + 'ANTHROPIC_FEDERATION_RULE_ID=fdrl_1\nANTHROPIC_ORGANIZATION_ID=org-1\nANTHROPIC_SERVICE_ACCOUNT_ID=svac_1\n';
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

  it('refuses an AI key written into a dotenv, Gemini or Anthropic, and never echoes a value', () => {
    for (const k of ['GEMINI_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_LOCAL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) {
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

  it('refuses a file with no line for the declared param — the deploy would stop in prepare', () => {
    // firebase-tools: a --non-interactive deploy refuses a declared param missing from the dotenv,
    // default or not. A blank line is enough.
    refused([{ name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=a@example.test\n' }], /no AI_SERVICE_ACCOUNT line/);
    ok([{ name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=a@example.test\nAI_SERVICE_ACCOUNT=\n' }]);
    // In .env.<projectId> counts too; in an ignored file it does not.
    ok([{ name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=a@example.test\n' }, { name: `.env.${P}`, text: 'AI_SERVICE_ACCOUNT=\n' }]);
    refused([{ name: '.env', text: 'BOOTSTRAP_ADMIN_EMAILS=a@example.test\n' }, { name: '.env.local', text: 'AI_SERVICE_ACCOUNT=\n' }], /no AI_SERVICE_ACCOUNT line/);
  });

  it('the Claude federation: all four values, or none', () => {
    ok([{ name: '.env', text: GOOD }]);
    ok([{ name: '.env', text: FEDERATED }]);
    // Each one left out on its own is refused, and named.
    for (const k of FEDERATION) {
      const text = FEDERATED.split('\n').map((l) => (l.startsWith(`${k}=`) ? `${k}=` : l)).join('\n');
      refused([{ name: '.env', text }], new RegExp(`half set up: ${k} is missing or empty`));
    }
  });

  it('refuses an AI_SERVICE_ACCOUNT that is not a service account address', () => {
    const withSa = (sa) => FEDERATED.replace('AI_SERVICE_ACCOUNT=ourdays-ai@', `AI_SERVICE_ACCOUNT=${sa}`);
    for (const sa of ['ourdays-ai@', 'ourdays-ai@our-days-2a939.iam.gserviceaccount.com', '"ourdays-ai@"']) {
      ok([{ name: '.env', text: withSa(sa) }]);
    }
    for (const sa of ['ourdays-ai', 'someone@gmail.com', 'x@']) {
      refused([{ name: '.env', text: withSa(sa) }], /not a service account address/);
    }
  });

  it('warns — does not refuse — when the federation is not set up at all', () => {
    expect(envGuardWarnings([{ name: '.env', text: GOOD }], P, A)).toHaveLength(1);
    expect(envGuardWarnings([{ name: '.env', text: GOOD }], P, A)[0]).toMatch(/Claude is not configured/);
    expect(envGuardWarnings([{ name: '.env', text: FEDERATED }], P, A)).toEqual([]);
  });

  it('reads names, not comments', () => {
    expect(keyNames('# GEMINI_KEY=nope\n\nA=1\nexport B = 2\n')).toEqual(['A', 'B']);
    ok([{ name: '.env', text: `${GOOD}# GEMINI_KEY=old note\n` }]);
  });
});
