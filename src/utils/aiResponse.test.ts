// src/utils/aiResponse.test.ts
//
// The app moved from `@google/generative-ai` (retired 30 November 2025, unmaintained, no access to
// recent models) to `@google/genai`, and from gemini-2.5-flash-lite to gemini-3.8-flash.
//
// The two SDKs hand back different shapes, and both ways of getting it wrong are SILENT:
//
//   · usage in the wrong place  → zeros → a ledger row that looks perfectly ordinary and prices
//                                 every call at nothing.
//   · text as a getter vs a method → `.text()` throws "text is not a function" at runtime, on a
//                                 path that only runs when somebody actually uses the feature.
//
// Neither is caught by a typecheck against `unknown`, which is what these adapters take. So they
// are tested against both shapes, on purpose.

import { describe, it, expect } from 'vitest';
import { usageOf, textOf } from '../../functions/src/aiResponse';

// What @google/genai returns: usage on the result, `text` a string getter.
const modern = (over: Record<string, unknown> = {}) => ({
  text: 'hello',
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  ...over,
});

// What @google/generative-ai returned: everything under `response`, `text` a method.
const legacy = (over: Record<string, unknown> = {}) => ({
  response: {
    text: () => 'hello',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    ...over,
  },
});

describe('usage, from either SDK', () => {
  it('reads the current shape', () => {
    expect(usageOf(modern())).toEqual({ promptTokens: 100, completionTokens: 20 });
  });

  it('still reads the retired shape', () => {
    expect(usageOf(legacy())).toEqual({ promptTokens: 100, completionTokens: 20 });
  });

  it('counts thinking tokens as output, because that is what they are charged as', () => {
    // Gemini 3 models reason before answering and report those tokens separately. Counting only
    // `candidatesTokenCount` would have billed a fraction of the real output — quietly, and in the
    // direction nobody checks a bill.
    expect(usageOf(modern({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 480 },
    }))).toEqual({ promptTokens: 100, completionTokens: 500 });
  });

  it('returns zeros rather than throwing on anything unexpected', () => {
    for (const junk of [null, undefined, 42, 'text', {}, { response: {} }, { usageMetadata: null }]) {
      expect(() => usageOf(junk)).not.toThrow();
      expect(usageOf(junk)).toEqual({ promptTokens: 0, completionTokens: 0 });
    }
  });

  it('refuses nonsense numbers instead of writing them to the ledger', () => {
    expect(usageOf(modern({
      usageMetadata: { promptTokenCount: -5, candidatesTokenCount: Number.NaN },
    }))).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(usageOf(modern({
      usageMetadata: { promptTokenCount: '100', candidatesTokenCount: Infinity },
    }))).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('floors fractional counts rather than storing a fraction of a token', () => {
    expect(usageOf(modern({
      usageMetadata: { promptTokenCount: 10.9, candidatesTokenCount: 2.4 },
    }))).toEqual({ promptTokens: 10, completionTokens: 2 });
  });
});

describe('reply text, from either SDK', () => {
  it('reads the current getter', () => {
    expect(textOf(modern())).toBe('hello');
  });

  it('still calls the retired method', () => {
    expect(textOf(legacy())).toBe('hello');
  });

  it('returns empty rather than undefined when the model produced no text', () => {
    // A refusal or a safety stop yields a result with no text part. Callers do `.trim()` on this
    // immediately, so undefined here is a crash on the user's screen.
    expect(textOf(modern({ text: undefined }))).toBe('');
    expect(textOf({ usageMetadata: {} })).toBe('');
  });

  it('survives a method that throws', () => {
    expect(textOf({ response: { text: () => { throw new Error('no candidates'); } } })).toBe('');
  });

  it('never throws and always returns a string', () => {
    for (const junk of [null, undefined, 42, {}, { text: 42 }, { response: null }, { response: { text: 7 } }]) {
      expect(() => textOf(junk)).not.toThrow();
      expect(typeof textOf(junk)).toBe('string');
    }
  });
});
