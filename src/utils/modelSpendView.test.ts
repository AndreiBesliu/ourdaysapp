// src/utils/modelSpendView.test.ts
//
// How the AI Center reads the per-model answer. "Not reported" (a server from before 27.09.2026),
// "nothing in the window" and "these models" are three different answers, and the first two must
// not look alike: an empty list from an old server would read as "no AI spend".

import { describe, it, expect } from 'vitest';
import { modelSpendState, fmtTokens, fmtRate } from './modelSpendView';

const row = { model: 'claude-opus-5-5', calls: 3, failures: 0, promptTokens: 900, completionTokens: 100, usd: 0.008, pricing: { inPerM: 4, outPerM: 20 }, current: true };

describe('modelSpendState', () => {
  it('a server without the field has not reported — not "empty"', () => {
    expect(modelSpendState(undefined).kind).toBe('not-reported');
    expect(modelSpendState({}).kind).toBe('not-reported');
    expect(modelSpendState({ byModel: 'x' as never }).kind).toBe('not-reported');
  });

  it('no rows and nothing unsplit is empty', () => {
    expect(modelSpendState({ byModel: [], modelUnsplit: { calls: 0, usd: 0, days: 0 } }).kind).toBe('empty');
    expect(modelSpendState({ byModel: [] }).kind).toBe('empty');
  });

  it('rows, with the unsplit part only when there is one', () => {
    const a = modelSpendState({ byModel: [row], modelUnsplit: { calls: 0, usd: 0, days: 0 } });
    expect(a).toEqual({ kind: 'rows', rows: [row], unsplit: null });
    const b = modelSpendState({ byModel: [row], modelUnsplit: { calls: 7, usd: 0.012, days: 3 } });
    expect(b).toEqual({ kind: 'rows', rows: [row], unsplit: { calls: 7, usd: 0.012, days: 3 } });
  });

  it('a window with ONLY unsplit calls (all before the record began) is not "empty"', () => {
    const s = modelSpendState({ byModel: [], modelUnsplit: { calls: 4, usd: 0.003, days: 2 } });
    expect(s).toEqual({ kind: 'rows', rows: [], unsplit: { calls: 4, usd: 0.003, days: 2 } });
  });
});

describe('formatting', () => {
  it('tokens', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(1_459)).toBe('1.5k');
    expect(fmtTokens(12_400)).toBe('12k');
    expect(fmtTokens(3_200_000)).toBe('3.2M');
    expect(fmtTokens(NaN)).toBe('0');
    expect(fmtTokens(-5)).toBe('0');
  });

  it('rates, and what a missing rate means', () => {
    expect(fmtRate({ inPerM: 4, outPerM: 20 })).toBe('$4 / $20 per million tokens (in / out)');
    expect(fmtRate({ inPerM: 0.75, outPerM: 3.75 })).toBe('$0.75 / $3.75 per million tokens (in / out)');
    expect(fmtRate(null)).toMatch(/dearest rate/);
  });
});
