// functions/src/jobRuns.ts
//
// The run markers every scheduled job leaves in `jobRuns/{name}`, read by `adminGetHealth` and
// judged by jobHealthCore.ts. Why each field exists is written there; this file only writes them.
//
// Every write here is best-effort. A marker that cannot be written must never be the reason a
// reminder is not sent: the job's work comes first, and a missing marker shows up in the panel as
// "not run" — loudly — rather than as a silent failure of the job itself.
//
// Clients cannot read or write `jobRuns`: no rule matches it, so Firestore refuses both (pinned in
// rules-tests/games.test.ts). The server writes it with the Admin SDK, as epoch milliseconds only.

import * as admin from "firebase-admin";
import { logServerError } from "./errorLog";
import type { JobName } from "./jobHealthCore";

/** What a run reports when it ends without throwing. */
export interface JobOutcome {
  /** Items that failed. More than zero and the run was not ok — see jobHealthCore.ts. */
  failed: number;
  /** One short line for the panel: what the run did, in counts. Never a uid or an email. */
  detail: string;
}

const markerRef = (name: JobName) => admin.firestore().doc(`jobRuns/${name}`);

/** The job's first write. MERGE: the last run that ended stays readable while this one runs. */
export async function markJobStart(name: JobName): Promise<void> {
  try {
    await markerRef(name).set(
      { startedAt: Date.now(), startsSinceEnd: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    );
  } catch { /* the job's work comes first */ }
}

/**
 * The end of a run: REPLACES the document, so `startedAt`, `startsSinceEnd` and `firstMissingAt` go.
 * `failStreak` counts failed runs in a row; its read is best-effort, and when it fails the streak
 * restarts at 1 — never at 0, which would turn a failure green.
 */
export async function markJobRun(name: JobName, ok: boolean, detail: string): Promise<void> {
  try {
    let failStreak = 0;
    if (!ok) {
      let prev: Record<string, unknown> = {};
      try { prev = (await markerRef(name).get()).data() || {}; } catch { prev = {}; }
      const n = Number(prev.failStreak);
      failStreak = (prev.ok === false ? (Number.isFinite(n) && n > 0 ? Math.floor(n) : 1) : 0) + 1;
    }
    await markerRef(name).set({ at: Date.now(), ok, detail: String(detail || "").slice(0, 200), failStreak });
  } catch { /* the job's work comes first */ }
}

/**
 * A run that ended without throwing. `ok` only if no item failed. A run with failures also leaves
 * ONE row in errorLogs — the count and the summary, not a row per item — so the panel's grouping has
 * something to show and a failure that repeats every five minutes stays one problem.
 */
export async function finishJob(name: JobName, outcome: JobOutcome): Promise<void> {
  const failed = Number.isFinite(outcome?.failed) && outcome.failed > 0 ? Math.floor(outcome.failed) : 0;
  const detail = String(outcome?.detail || "");
  if (failed > 0) await logServerError(`${name}: a run ended with failures (${detail})`, `job:${name}`);
  await markJobRun(name, failed === 0, detail);
}

/** A run that threw: into errorLogs (a console.error alone reaches nobody) and marked not ok. */
export async function failJob(name: JobName, err: unknown): Promise<void> {
  const e = err as { message?: unknown; stack?: unknown } | null;
  const message = String((e && e.message) || err || "job failed");
  await logServerError(`${name}: ${message}`, `job:${name}`, { stack: e?.stack });
  await markJobRun(name, false, message.slice(0, 120));
}

/**
 * THE wrapper for every `onSchedule` handler: start marker, the job, end marker. A job that throws is
 * marked and re-thrown, so the platform still records the failure too. The parity test holds every
 * scheduled export to calling this with its own name.
 */
export async function runJob(name: JobName, body: () => Promise<JobOutcome>): Promise<void> {
  await markJobStart(name);
  let outcome: JobOutcome;
  try {
    outcome = await body();
  } catch (err) {
    await failJob(name, err);
    throw err;
  }
  await finishJob(name, outcome);
}
