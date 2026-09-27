import { modelSpendState, fmtTokens, fmtRate } from '../utils/modelSpendView';
import type { AiSpend } from '../serverActions';

// The AI Center's per-model split: which model answered how many calls, with what tokens, for how
// much — and, beside it, what the split does not cover. Admin-only, so English like the rest of the
// admin screen. No hooks: it renders what it is given.

const box = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl';

export default function ModelSpendList({ spend, format }: {
  spend: Pick<AiSpend, 'byModel' | 'modelUnsplit'> | null | undefined;
  /** The screen's own money format, so the same amount never reads two ways on one page. */
  format: (n: number) => string;
}) {
  const state = modelSpendState(spend);

  if (state.kind === 'not-reported') {
    return <div className={`${box} p-4 text-sm text-zinc-500`}>The per-model split appears after the next functions deploy.</div>;
  }
  if (state.kind === 'empty') {
    return <div className={`${box} p-4 text-sm text-zinc-500`}>No AI calls in this window.</div>;
  }

  return (
    <div className={`${box} divide-y divide-zinc-100 dark:divide-zinc-800`}>
      {state.rows.map((r) => (
        <div key={r.model} className="p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono break-all">{r.model}</span>
              {r.current && <span className="text-[10px] uppercase font-bold text-primary">in use</span>}
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5">
              {r.calls} {r.calls === 1 ? 'call' : 'calls'}
              {r.failures > 0 && <span className="text-red-500"> · {r.failures} failed</span>}
              {' · '}{fmtTokens(r.promptTokens)} in / {fmtTokens(r.completionTokens)} out
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">{fmtRate(r.pricing)}</p>
          </div>
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums shrink-0">{format(r.usd)}</span>
        </div>
      ))}
      {/* Said, not left out: without this line a window reaching back before the split reads as
          if every dollar in it had been the models above. */}
      {state.unsplit && (
        <div className="p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-500">Not split by model</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {state.unsplit.calls} {state.unsplit.calls === 1 ? 'call' : 'calls'} over {state.unsplit.days} {state.unsplit.days === 1 ? 'day' : 'days'}.
              {' '}The per-model record began on 27.09.2026; older calls count only in the totals above.
            </p>
          </div>
          <span className="text-sm font-bold text-zinc-500 tabular-nums shrink-0">{format(state.unsplit.usd)}</span>
        </div>
      )}
    </div>
  );
}
