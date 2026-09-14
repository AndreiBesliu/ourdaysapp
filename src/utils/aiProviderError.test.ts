// src/utils/aiProviderError.test.ts
//
// The predicate decides what does NOT reach the error log, so the expensive mistake is the false
// positive: widen it and a real defect is filed away as "the provider was busy" and nobody ever
// looks. Most of these tests are about things it must keep saying no to.

import { describe, it, expect } from 'vitest';
import {
  AI_QUOTA_CODE, isProviderQuotaError, providerErrorCode,
} from '../../functions/src/aiProviderError';

/** The real thing, copied from the production log on 2026-09-14. */
const REAL_429 = Object.assign(
  new Error('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.'),
  { status: 429, statusText: 'Too Many Requests', name: 'GoogleGenerativeAIFetchError' },
);

describe('recognising a quota refusal', () => {
  it('recognises the error that actually filled the log', () => {
    expect(isProviderQuotaError(REAL_429)).toBe(true);
  });

  it('recognises it by status alone, with no message to read', () => {
    expect(isProviderQuotaError({ status: 429 })).toBe(true);
  });

  it('recognises it by message alone, with no status', () => {
    // A 429 that reaches us re-wrapped, having lost its fields on the way.
    expect(isProviderQuotaError(new Error('Error: [429 Too Many Requests] try later'))).toBe(true);
    expect(isProviderQuotaError(new Error('8 RESOURCE_EXHAUSTED: quota'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isProviderQuotaError(new Error('YOU EXCEEDED YOUR CURRENT QUOTA'))).toBe(true);
  });
});

describe('what it must NOT swallow', () => {
  it('a provider that is merely overloaded is not a quota refusal', () => {
    // 503 is transient and worth seeing; filing it as "nothing to worry about" buries it.
    expect(isProviderQuotaError({ status: 503, message: 'The model is overloaded' })).toBe(false);
  });

  it('a malformed request is our bug, not their limit', () => {
    expect(isProviderQuotaError({ status: 400, message: 'Invalid JSON payload' })).toBe(false);
  });

  it('an ordinary crash stays an ordinary crash', () => {
    expect(isProviderQuotaError(new TypeError("Cannot read properties of null (reading 'text')"))).toBe(false);
  });

  it('the word "quota" on its own is not enough', () => {
    // The app has its own budget language; matching loosely would hide our own refusals too.
    expect(isProviderQuotaError(new Error('quota'))).toBe(false);
    expect(isProviderQuotaError(new Error('user quota settings updated'))).toBe(false);
  });

  it('does not throw on the things a catch block really receives', () => {
    for (const junk of [null, undefined, '', 'a string', 0, [], {}]) {
      expect(isProviderQuotaError(junk as unknown)).toBe(false);
    }
  });
});

describe('the ledger label', () => {
  it('turns the SDK error into something that names the status', () => {
    // It used to record "GoogleGenerativeAIFetchError" for a 429, a 400 and a 503 alike, so the
    // ledger could not answer the only question it is kept for.
    expect(providerErrorCode(REAL_429)).toBe('http-429');
    expect(providerErrorCode({ status: 503, name: 'GoogleGenerativeAIFetchError' })).toBe('http-503');
  });

  it('still prefers a real string code when there is one', () => {
    expect(providerErrorCode({ code: 'permission-denied' })).toBe('permission-denied');
  });

  it('falls back through code then name then a constant', () => {
    expect(providerErrorCode({ code: 429 })).toBe('http-429');
    expect(providerErrorCode({ name: 'TypeError' })).toBe('TypeError');
    expect(providerErrorCode({})).toBe('error');
    expect(providerErrorCode(null)).toBe('error');
  });

  it('never returns an empty label', () => {
    for (const junk of [{ code: '' }, { name: '' }, { code: '', name: '' }]) {
      expect(providerErrorCode(junk)).toBeTruthy();
    }
  });
});

describe('the code the client translates', () => {
  it('is the one src/ai.ts already looks for', () => {
    // aiErrorMessage() matches this literal; if it drifts the user gets a raw English provider URL.
    expect(AI_QUOTA_CODE).toBe('ai-budget/global-budget');
  });
});
