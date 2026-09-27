// src/utils/jobHealthView.ts
//
// What the admin Health tab does with the scheduled-job lines `adminGetHealth` returns. The
// judgement itself is the server's (functions/src/jobHealthCore.ts); this only decides how the
// screen reads the three states the answer can be in. Pure.

export type JobStatus = 'ok' | 'info' | 'warn' | 'fail';

/** One line, as the server sends it. Mirrors `JobCheck` in functions/src/jobHealthCore.ts. */
export interface JobCheckView {
  name: string;
  label: string;
  everyMinutes: number;
  status: JobStatus;
  message: string;
  hint: string;
  lastRunAt: number | null;
  failStreak: number;
}

/**
 * The three things `health.jobs` can be, kept apart on purpose:
 *   * `undefined` — a server from before 27.09.2026, which does not report jobs at all;
 *   * `null`      — a server that tried and could not read the markers;
 *   * an array    — the answer.
 * Neither of the first two may render as an empty list: no lines reads as "nothing wrong".
 */
export type JobsState =
  | { kind: 'not-reported' }
  | { kind: 'unreadable' }
  | { kind: 'lines'; lines: JobCheckView[] };

const STATUSES: readonly JobStatus[] = ['ok', 'info', 'warn', 'fail'];

export function jobsState(jobs: unknown): JobsState {
  if (jobs === undefined) return { kind: 'not-reported' };
  if (!Array.isArray(jobs)) return { kind: 'unreadable' };
  const lines = jobs.filter((j): j is JobCheckView =>
    !!j && typeof j === 'object'
    && typeof (j as JobCheckView).name === 'string'
    && typeof (j as JobCheckView).message === 'string'
    && STATUSES.includes((j as JobCheckView).status));
  // A list that arrived but held nothing readable is not "all fine" either.
  return lines.length === 0 ? { kind: 'unreadable' } : { kind: 'lines', lines };
}

/** Jobs that need somebody: stopped, stuck, failing or late. For the badge on the Health tab. */
export function jobsNeedingAttention(jobs: unknown): number {
  const s = jobsState(jobs);
  return s.kind === 'lines' ? s.lines.filter((j) => j.status === 'warn' || j.status === 'fail').length : 0;
}
