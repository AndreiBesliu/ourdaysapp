// src/utils/modelSpendView.ts
//
// How the admin's AI Center reads the per-model answer of `adminGetAiSpend`. Pure.

import type { AiSpend } from '../serverActions';

export type ModelSpendState =
  /** A server from before 27.09.2026: no per-model answer at all. Not the same as "none". */
  | { kind: 'not-reported' }
  /** Nothing in the window, split or not. */
  | { kind: 'empty' }
  | { kind: 'rows'; rows: NonNullable<AiSpend['byModel']>; unsplit: NonNullable<AiSpend['modelUnsplit']> | null };

export function modelSpendState(spend: Pick<AiSpend, 'byModel' | 'modelUnsplit'> | null | undefined): ModelSpendState {
  if (!spend || !Array.isArray(spend.byModel)) return { kind: 'not-reported' };
  const unsplit = spend.modelUnsplit && spend.modelUnsplit.calls > 0 ? spend.modelUnsplit : null;
  if (spend.byModel.length === 0 && !unsplit) return { kind: 'empty' };
  return { kind: 'rows', rows: spend.byModel, unsplit };
}

/** 950 → "950", 12 400 → "12.4k", 3 200 000 → "3.2M". */
export function fmtTokens(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

/** "$4 / $20 per million tokens (in / out)", or why there is no rate. */
export function fmtRate(p: { inPerM: number; outPerM: number } | null): string {
  if (!p) return 'Not in the price table: charged at the dearest rate';
  const d = (x: number) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
  return `${d(p.inPerM)} / ${d(p.outPerM)} per million tokens (in / out)`;
}
