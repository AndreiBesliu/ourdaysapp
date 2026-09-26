// src/utils/aiResponse.test.ts
//
// Reading a Claude reply (26.09.2026: the app moved from Gemini to Claude Opus 5.5).
//
// Both ways of getting it wrong are SILENT, which is why the adapter is tested against the real
// shape and not merely typechecked (it takes `unknown`):
//
//   · usage not found     → it used to be zeros: every call priced at $0, every budget hold
//                           refunded in full, the admin panel showing $0 — no error anywhere. It is
//                           now `null`, and the ledger keeps the pessimistic hold instead.
//   · text not found      → every feature answers "nothing" while every call is still billed.

import { describe, it, expect } from 'vitest';
import { usageOf, textOf, stopReasonOf, unfinishedReason, jsonOf } from '../../functions/src/aiResponse';

// The shape of an Anthropic Messages API `Message` (and the beta one the fallback opt-in returns).
const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: '{"items":["Milk","Bread"]}' },
  ],
  usage: {
    input_tokens: 120,
    output_tokens: 480,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  ...over,
});

describe('usage of a Claude reply', () => {
  it('reads input and output tokens, and which model served it', () => {
    expect(usageOf(message())).toEqual({ promptTokens: 120, completionTokens: 480, model: 'claude-opus-5-5' });
  });

  it('counts thinking as output, because that is what it is billed as', () => {
    // Opus 5.5 always thinks; `output_tokens` already includes it. Billing only the visible text
    // would repeat the Gemini-era mistake with `thoughtsTokenCount`.
    const r = message({ usage: { input_tokens: 10, output_tokens: 900, output_tokens_details: { thinking_tokens: 850 } } });
    expect(usageOf(r)?.completionTokens).toBe(900);
  });

  it('counts cache writes and reads as input', () => {
    const r = message({ usage: { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 40 } });
    expect(usageOf(r)?.promptTokens).toBe(145);
  });

  it('a fallback turn: every billed attempt, each with its own model, and the totals over all', () => {
    // Anthropic bills the DECLINED attempt too, at its own model's rate; the top-level usage
    // describes only the attempt that answered. `iterations` is the per-attempt record.
    const r = message({
      model: 'claude-opus-5',
      usage: {
        input_tokens: 300, output_tokens: 100,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 300, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 300, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ],
      },
    });
    const u = usageOf(r)!;
    expect(u.attempts).toEqual([
      { model: 'claude-opus-5-5', promptTokens: 300, completionTokens: 900 },
      { model: 'claude-opus-5', promptTokens: 300, completionTokens: 100 },
    ]);
    expect(u).toMatchObject({ promptTokens: 600, completionTokens: 1000, model: 'claude-opus-5' });
  });

  it('names the model that ACTUALLY served it — a fallback bills at its own rate', () => {
    expect(usageOf(message({ model: 'claude-opus-5' }))?.model).toBe('claude-opus-5');
  });

  it('returns null — never zeros — for anything it cannot read', () => {
    // Zeros priced every call at $0 and refunded every hold. Null makes the ledger keep the estimate.
    for (const junk of [null, undefined, 0, 'x', {}, [], { usage: null }, { usage: {} },
      { usage: { input_tokens: '120', output_tokens: 5 } },
      // The old Gemini shape: must not be mistaken for a readable Claude one.
      { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } }]) {
      expect(usageOf(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('refuses nonsense numbers instead of writing them to the ledger', () => {
    const r = message({ usage: { input_tokens: -5, output_tokens: Number.POSITIVE_INFINITY } });
    expect(usageOf(r)).toEqual({ promptTokens: 0, completionTokens: 0, model: 'claude-opus-5-5' });
  });

  it('floors fractional counts rather than storing a fraction of a token', () => {
    const r = message({ usage: { input_tokens: 10.7, output_tokens: 3.2 } });
    expect(usageOf(r)).toMatchObject({ promptTokens: 10, completionTokens: 3 });
  });
});

describe('the text of a Claude reply', () => {
  it('joins the text blocks and skips thinking', () => {
    const r = message({ content: [
      { type: 'thinking', thinking: 'secret reasoning' },
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'there' },
    ] });
    expect(textOf(r)).toBe('Hello there');
  });

  it('is empty, not a throw, for anything without text', () => {
    for (const junk of [null, undefined, {}, { content: null }, { content: [{ type: 'thinking' }] },
      // The old Gemini getter must not be read as a Claude reply either.
      { text: 'gemini text' }]) {
      expect(textOf(junk), JSON.stringify(junk)).toBe('');
    }
  });
});

describe('a reply that was billed but is not an answer', () => {
  it('a finished reply is an answer', () => {
    expect(stopReasonOf(message())).toBe('end_turn');
    expect(unfinishedReason(message())).toBeNull();
  });

  it('a refusal, a cut-off and anything unknown are not, each named for the ledger', () => {
    expect(unfinishedReason(message({ stop_reason: 'refusal' }))).toBe('refusal');
    expect(unfinishedReason(message({ stop_reason: 'max_tokens' }))).toBe('max-tokens');
    expect(unfinishedReason(message({ stop_reason: 'pause_turn' }))).toBe('stop-pause_turn');
    expect(unfinishedReason({})).toBe('stop-unknown');
  });

  it('structured output: parsed only from a finished reply', () => {
    expect(jsonOf(message())).toEqual({ items: ['Milk', 'Bread'] });
    // Cut off mid-JSON: not an answer, even if the fragment happened to parse.
    expect(jsonOf(message({ stop_reason: 'max_tokens' }))).toBeNull();
    expect(jsonOf(message({ stop_reason: 'refusal', content: [] }))).toBeNull();
    expect(jsonOf(message({ content: [{ type: 'text', text: 'not json' }] }))).toBeNull();
  });
});
