// src/utils/aiErrorKey.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiErrorKey } from './aiErrorKey';
import { translations } from './i18n';

describe('recognising the refusals the server states', () => {
  it('maps each budget code to its key', () => {
    expect(aiErrorKey({ message: 'ai-budget/user-budget' })).toBe('aiBudgetUser');
    expect(aiErrorKey({ message: 'ai-budget/global-budget' })).toBe('aiBudgetGlobal');
    expect(aiErrorKey({ message: 'ai-budget/kill-switch' })).toBe('aiBudgetOff');
  });

  it('finds the code inside the wrapper Firebase puts around it', () => {
    // A callable rejection arrives as `FirebaseError: <code> <message>`, not as the bare code.
    expect(aiErrorKey({ message: 'FirebaseError: resource-exhausted ai-budget/user-budget' }))
      .toBe('aiBudgetUser');
    expect(aiErrorKey('INTERNAL: ai-budget/kill-switch happened')).toBe('aiBudgetOff');
  });

  it('does not confuse the user budget with the global one', () => {
    // Both contain "budget"; a looser match would tell one person the whole app had stopped.
    expect(aiErrorKey({ message: 'ai-budget/global-budget' })).not.toBe('aiBudgetUser');
  });
});

describe('everything else stays generic on purpose', () => {
  it('returns null rather than a provider string', () => {
    // The alternative puts a raw English URL or HTTP code in front of somebody's family. The raw
    // text still goes to the error log, which is where it is useful.
    expect(aiErrorKey({ message: 'Request failed with status 503' })).toBeNull();
    expect(aiErrorKey({ message: 'See https://ai.google.dev/gemini-api/docs/rate-limits' })).toBeNull();
  });

  it('survives every shape an error can arrive in', () => {
    for (const junk of [null, undefined, '', {}, 0, [], new Error(''), { message: null }]) {
      expect(aiErrorKey(junk as unknown)).toBeNull();
    }
  });

  it('reads a real Error object, not only a plain one', () => {
    expect(aiErrorKey(new Error('ai-budget/user-budget'))).toBe('aiBudgetUser');
  });
});

describe('the keys it names actually exist', () => {
  it('has all three in all six languages', () => {
    // A key that does not resolve renders as its own name: `t()` ends in `|| key`. Six buttons
    // reading "aiBudgetUser" aloud is the failure this pins.
    for (const key of ['aiBudgetUser', 'aiBudgetGlobal', 'aiBudgetOff']) {
      for (const lang of Object.keys(translations)) {
        expect(typeof translations[lang][key], `${lang}.${key}`).toBe('string');
      }
    }
  });
});

describe('a busy provider (26.09.2026, Claude)', () => {
  it('has its own sentence, in all six languages, and it is not the daily-limit one', () => {
    expect(aiErrorKey('ai-budget/provider-busy')).toBe('aiBusy');
    expect(aiErrorKey({ message: 'unavailable: ai-budget/provider-busy' })).toBe('aiBusy');
    for (const lang of Object.keys(translations)) {
      expect(typeof translations[lang].aiBusy, `${lang}.aiBusy`).toBe('string');
      expect(translations[lang].aiBusy, lang).not.toBe(translations[lang].aiBudgetGlobal);
    }
  });

  it('is the code the server throws for it', () => {
    const errs = readFileSync(join(process.cwd(), 'functions', 'src', 'aiProviderError.ts'), 'utf8');
    expect(errs).toContain('export const AI_BUSY_CODE = "ai-budget/provider-busy";');
    const index = readFileSync(join(process.cwd(), 'functions', 'src', 'index.ts'), 'utf8');
    expect(index.match(/throw new HttpsError\('unavailable', AI_BUSY_CODE\)/g)?.length).toBe(4);
  });
});

describe('the codes still match what the server throws', () => {
  it('every code this file knows is still produced by aiLedger.ts', () => {
    // The two sides are a contract across a network boundary, and the server can rename a code
    // without anything here failing to compile. Then the message silently goes generic again.
    const ledger = readFileSync(
      join(process.cwd(), 'functions', 'src', 'aiLedger.ts'), 'utf8');
    // The CALL, not merely the string. My first draft asserted the bare quoted code and was
    // satisfied by the type union on the declaration line — a mutation that renamed only the
    // call site left the union intact and the test green.
    for (const suffix of ['user-budget', 'global-budget', 'kill-switch']) {
      expect(ledger, `refuse("${suffix}") missing from aiLedger.ts`)
        .toContain(`refuse("${suffix}")`);
    }
    // ...and the prefix the client matches on is the one the server builds.
    expect(ledger).toContain('ai-budget/');
  });
});
