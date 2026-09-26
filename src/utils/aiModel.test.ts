// src/utils/aiModel.test.ts
//
// The model the app pays for and the price the ledger charges for it. A row is priced ONCE, when it
// is written, and never again — so a missing or wrong price is not a display bug, it is history that
// cannot be corrected. Nothing pinned this before 26.09.2026: a Claude id absent from the table
// would have been priced silently at Gemini 2.5 Flash rates, up to ten times too little.

import { describe, it, expect } from 'vitest';
import { AI_MODEL, MODEL_PRICING, UNKNOWN_MODEL_PRICING, priceUsd } from '../../functions/src/aiModel';

describe('the model the app pays for', () => {
  it('is Claude Opus 5.5, Andrei\'s choice of 26.09.2026', () => {
    expect(AI_MODEL).toBe('claude-opus-5-5');
  });

  it('has a price row — never the fallback for an unknown model', () => {
    expect(MODEL_PRICING[AI_MODEL]).toEqual({ inPerM: 4, outPerM: 20 });
  });

  it('prices a call from its tokens', () => {
    // 1,000 in and 500 out on Opus 5.5: $0.004 + $0.01.
    expect(priceUsd(AI_MODEL, 1_000, 500)).toBeCloseTo(0.014, 10);
  });

  it('every model a server-side fallback may serve has a row of its own', () => {
    // The fallback bills at the model that ran; the ledger prices by the reply's `model`.
    for (const m of ['claude-opus-5', 'claude-opus-4-8']) expect(MODEL_PRICING[m], m).toBeDefined();
  });
});

describe('an unknown model', () => {
  it('is priced at the dearest rate in the table, not the cheapest', () => {
    // Over-charging is recoverable and the budget still bounds it; under-charging is neither.
    for (const [m, p] of Object.entries(MODEL_PRICING)) {
      expect(UNKNOWN_MODEL_PRICING.inPerM, m).toBeGreaterThanOrEqual(p.inPerM);
      expect(UNKNOWN_MODEL_PRICING.outPerM, m).toBeGreaterThanOrEqual(p.outPerM);
    }
    expect(priceUsd('claude-something-new', 1_000_000, 1_000_000))
      .toBe(UNKNOWN_MODEL_PRICING.inPerM + UNKNOWN_MODEL_PRICING.outPerM);
  });
});
