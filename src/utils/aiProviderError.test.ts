// src/utils/aiProviderError.test.ts
//
// The predicate decides what does NOT reach the error log, so the expensive mistake is the false
// positive: widen it and a real defect is filed away as "the provider was busy" and nobody ever
// looks. Most of these tests are about things it must keep saying no to.

import { describe, it, expect } from 'vitest';
import {
  AI_QUOTA_CODE, AI_BUSY_CODE, isProviderQuotaError, isProviderBusy, isProviderOutOfCredit,
  isOwnBudgetRefusal, providerErrorCode,
} from '../../functions/src/aiProviderError';

/**
 * What the Anthropic SDK throws on a rate limit (26.09.2026, the app moved from Gemini to Claude):
 * an `APIError` subclass with a numeric `status` and the API's error `type`. Duck-typed on purpose —
 * the predicate cannot import the SDK (functionsPurity.test.ts).
 */
class AnthropicLikeError extends Error {
  status: number;
  type: string;
  constructor(status: number, type: string, message: string, name: string) {
    super(message);
    this.status = status;
    this.type = type;
    this.name = name;
  }
}
const RATE_LIMIT = new AnthropicLikeError(429, 'rate_limit_error', '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}', 'RateLimitError');

describe('recognising a capacity or billing refusal', () => {
  it('a rate limit, by status and by type', () => {
    expect(isProviderQuotaError(RATE_LIMIT)).toBe(true);
    expect(isProviderQuotaError({ status: 429 })).toBe(true);
    expect(isProviderQuotaError({ type: 'rate_limit_error' })).toBe(true);
  });

  it('an overloaded API (529) is capacity, not a defect', () => {
    expect(isProviderQuotaError(new AnthropicLikeError(529, 'overloaded_error', 'Overloaded', 'InternalServerError'))).toBe(true);
    expect(isProviderQuotaError({ type: 'overloaded_error' })).toBe(true);
  });

  it('an account out of credit — 402, or a 400 whose message says so', () => {
    expect(isProviderQuotaError(new AnthropicLikeError(402, 'billing_error', 'billing', 'APIError'))).toBe(true);
    expect(isProviderQuotaError(new AnthropicLikeError(400, 'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API.', 'BadRequestError'))).toBe(true);
  });

  it('is case-insensitive about the credit message', () => {
    expect(isProviderQuotaError(new Error('YOUR CREDIT BALANCE IS TOO LOW'))).toBe(true);
  });
});

describe('busy for a minute, or out of credit — two different things to tell a person', () => {
  it('busy: 429 and 529, by status or type — and not out of credit', () => {
    for (const e of [RATE_LIMIT, { status: 529 }, { type: 'overloaded_error' }, { type: 'rate_limit_error' }]) {
      expect(isProviderBusy(e), JSON.stringify(e)).toBe(true);
      expect(isProviderOutOfCredit(e), JSON.stringify(e)).toBe(false);
    }
  });

  it('out of credit: 402, billing_error, or the credit message — and not busy', () => {
    for (const e of [{ status: 402 }, { type: 'billing_error' }, new Error('Your credit balance is too low')]) {
      expect(isProviderOutOfCredit(e)).toBe(true);
      expect(isProviderBusy(e)).toBe(false);
    }
  });

  it('the two codes the client translates differ', () => {
    expect(AI_BUSY_CODE).toBe('ai-budget/provider-busy');
    expect(AI_BUSY_CODE).not.toBe(AI_QUOTA_CODE);
  });
});

describe('what it must NOT swallow', () => {
  it('an internal server error (500, 503) is not capacity — somebody should see it', () => {
    expect(isProviderQuotaError({ status: 500, message: 'Internal server error' })).toBe(false);
    expect(isProviderQuotaError({ status: 503, message: 'Service unavailable' })).toBe(false);
  });

  it('authentication and a wrong model id are ours to fix: the federation setup, the model name', () => {
    expect(isProviderQuotaError(new AnthropicLikeError(401, 'authentication_error', 'Authentication failed', 'AuthenticationError'))).toBe(false);
    expect(isProviderQuotaError(new AnthropicLikeError(403, 'permission_error', 'forbidden', 'PermissionDeniedError'))).toBe(false);
    expect(isProviderQuotaError(new AnthropicLikeError(404, 'not_found_error', 'model: claude-x', 'NotFoundError'))).toBe(false);
  });

  it('the Gemini-era quota messages no longer count: nothing produces them now', () => {
    expect(isProviderQuotaError(new Error('You exceeded your current quota'))).toBe(false);
    expect(isProviderQuotaError(new Error('8 RESOURCE_EXHAUSTED: quota'))).toBe(false);
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
    expect(providerErrorCode(RATE_LIMIT)).toBe('http-429');
    expect(providerErrorCode(new AnthropicLikeError(529, 'overloaded_error', 'x', 'InternalServerError'))).toBe('http-529');
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

  it('names a failed federation exchange by its status, not as "Error"', () => {
    // The SDK's WorkloadIdentityError carries `statusCode`, not `status`.
    expect(providerErrorCode(Object.assign(new Error('Authentication failed'), { statusCode: 401 }))).toBe('federation-http-401');
  });

  it('names an SDK error by its class when `name` is the generic "Error"', () => {
    // The SDK never sets `name`, so a timeout, an abort and a connection failure all read "Error".
    class APIConnectionTimeoutError extends Error {}
    class APIUserAbortError extends Error {}
    expect(providerErrorCode(new APIConnectionTimeoutError('Request timed out.'))).toBe('APIConnectionTimeoutError');
    expect(providerErrorCode(new APIUserAbortError('Request was aborted.'))).toBe('APIUserAbortError');
    expect(providerErrorCode(new Error('plain'))).toBe('Error');
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

describe('our own refusal is not an error', () => {
  it('recognises what holdBudget throws, in the shape a callable rethrows it', () => {
    // `HttpsError('resource-exhausted', 'ai-budget/kill-switch')`. The code is on `.code` as a
    // STRING; the message is the bare path.
    expect(isOwnBudgetRefusal({ message: 'ai-budget/kill-switch' })).toBe(true);
    expect(isOwnBudgetRefusal({ message: 'ai-budget/user-budget' })).toBe(true);
    expect(isOwnBudgetRefusal({ message: 'ai-budget/global-budget' })).toBe(true);
    expect(isOwnBudgetRefusal(new Error('ai-budget/kill-switch'))).toBe(true);
  });

  it('still recognises it once a wrapper has prefixed the message', () => {
    // Some paths rethrow as `AI Error: <message>`. Losing it there would put the burst back in
    // the health panel.
    expect(isOwnBudgetRefusal({ message: 'AI Error: ai-budget/user-budget' })).toBe(true);
  });

  it('says NO to a provider error, so the two stay separable', () => {
    // They are thrown for different reasons and one of them IS worth looking at.
    expect(isOwnBudgetRefusal(RATE_LIMIT)).toBe(false);
    expect(isOwnBudgetRefusal({ message: 'resource_exhausted' })).toBe(false);
    expect(isOwnBudgetRefusal({ code: 'resource-exhausted' })).toBe(false);
  });

  it('says NO to junk rather than swallowing a real bug', () => {
    // A false positive here is a defect that never reaches the error log at all.
    for (const junk of [null, undefined, '', {}, 0, [], new Error('Cannot read properties of null')]) {
      expect(isOwnBudgetRefusal(junk as unknown)).toBe(false);
    }
  });

  it('is not fooled by the phrase appearing mid-word', () => {
    expect(isOwnBudgetRefusal({ message: 'notai-budget/user-budget' })).toBe(false);
  });

  it('leaves the client able to translate it', () => {
    // The callable rethrows the MESSAGE, and `aiErrorKey` matches by substring, so the six
    // translated sentences survive the change. Pinned here because the two live in different
    // files and nothing else connects them.
    expect('ai-budget/kill-switch').toContain('ai-budget/kill-switch');
  });
});
