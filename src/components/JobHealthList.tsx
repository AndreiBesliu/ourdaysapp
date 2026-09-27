import { CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { jobsState, type JobStatus } from '../utils/jobHealthView';

// The scheduled jobs, one line each, as judged by the server (functions/src/jobHealthCore.ts).
// Admin-only, so English like the rest of the admin screen. No hooks: it renders what it is given.

const TONE: Record<JobStatus, { icon: typeof CheckCircle2; className: string; word: string }> = {
  ok: { icon: CheckCircle2, className: 'text-emerald-500', word: 'Running' },
  info: { icon: Clock, className: 'text-zinc-400', word: 'Waiting' },
  warn: { icon: AlertTriangle, className: 'text-amber-500', word: 'Check' },
  fail: { icon: XCircle, className: 'text-red-500', word: 'Broken' },
};

const box = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl';

export default function JobHealthList({ jobs }: { jobs: unknown }) {
  const state = jobsState(jobs);

  if (state.kind === 'not-reported') {
    return (
      <div className={`${box} p-4 text-sm text-zinc-500`}>
        This server does not report its scheduled jobs yet. They appear after the next functions deploy.
      </div>
    );
  }
  if (state.kind === 'unreadable') {
    return (
      <div className={`${box} p-4 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2`}>
        <AlertTriangle className="w-4 h-4 shrink-0" /> The job markers could not be read, so there is no answer — not a clean one.
      </div>
    );
  }

  return (
    <div className={`${box} divide-y divide-zinc-100 dark:divide-zinc-800`}>
      {state.lines.map((j) => {
        const tone = TONE[j.status];
        const Icon = tone.icon;
        return (
          <div key={j.name} className="p-3 flex items-start gap-3">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone.className}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex flex-wrap items-baseline gap-x-2">
                <span>{j.label}</span>
                <span className={`text-[10px] uppercase font-bold ${tone.className}`}>{tone.word}</span>
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5 break-words">{j.message}</p>
              {j.hint && <p className="text-[11px] text-zinc-400 mt-0.5 break-words">{j.hint}</p>}
              <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">{j.name}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
