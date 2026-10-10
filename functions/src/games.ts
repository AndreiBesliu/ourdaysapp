// functions/src/games.ts
//
// Closing arcade sessions that nobody came back to.
//
// Andrei, 16.09.2026, asked for both halves: an End button (which already existed) AND "sesiune
// abandonata dupa 24 de ore de inactivitate". Only one of the two needed building — and before it
// could be built at all, the arcade had to start recording WHEN anything happened, because not one
// of its twenty-six writes did. See src/components/games/gameWrite.ts.
//
// What this does NOT do: delete anything. An expired session is marked finished, banked with the
// winner it already had, and flagged `abandoned` so the arcade can say the clock closed it rather
// than a person. Every board stays readable.

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import {
  IDLE_MS,
  expiryRefusal,
  closedSessionFields,
  type ExpiryRefusal,
} from "./gameSession";
import { runJob, type JobOutcome } from "./jobRuns";
import { addServerError } from "./errorLog";

/**
 * How many idle games one run tries to close.
 *
 * There is a backlog: every game ever abandoned is, by definition, idle, and the first runs work
 * through all of them. A cap drains it over hours instead of rewriting the whole collection at once,
 * and keeps a single run's cost bounded forever after. The games past the cap are NOT passed over:
 * the run stops in front of the first one it did not try, and the next run starts there.
 */
export const PER_RUN = 200;

/**
 * How many documents one run reads — a WINDOW that moves on from run to run (10.10.2026).
 *
 * The whole collection, deliberately, rather than a status filter. `status: 'finished'` in this
 * schema means the ROUND is over — the round-loop games set it at the end of every round and
 * "Next Round" sets it back — so filtering it out made the sweep blind to the commonest abandoned
 * state of all. There is no filter that selects "not finalized" either: the field is absent on every
 * document made before 16.09, and Firestore drops documents missing a field from an inequality.
 *
 * Until 10.10 every run read `limit(2000)`: the FIRST 2000 documents by id, every time. Anybody could
 * create that many games, in a group of their own, with ids that sort first (`!…`), and no game of any
 * other group would ever be looked at again. Now each run reads on from where the previous one
 * stopped (the cursor lives in `jobState/expireIdleGames`) and wraps round at the end, so the whole
 * collection is read in turn.
 */
export const SCAN_WINDOW = 2000;
/**
 * Documents per query within the window. Small on purpose: a document can be a megabyte, and the
 * verdict's own fields (`lastMoveAt`, `date`, `finalized`) were typed by the rules only from
 * 10.10.2026 — a game written before, or by a rule not yet published, may hold a megabyte in any of
 * them — so one page of padded games must not be able to run the function out of memory.
 */
const PAGE = 50;
/**
 * How long one run keeps trying to close games. It stops in front of the next idle game when the time
 * is up, as at the cap, so a run that a heavy window slows down ends with its work saved instead of
 * being cut off by the function's own timeout at the same place every hour.
 */
export const TIME_BUDGET_MS = 40_000;
/**
 * A full turn of the collection taking more runs than this — a day of hourly runs — means an idle
 * game can wait a day past its 24 hours before it is closed. Every run then counts as not ok, until a
 * turn ends within it again: a slow turn must not look like a clean one.
 */
export const MAX_LAP_RUNS = 24;
/** Where the window stops between runs. No rule matches `jobState`, so no client reads or writes it. */
export const SWEEP_STATE_DOC = "jobState/expireIdleGames";
/**
 * How many games that cannot be closed the sweep remembers (their ids, in `unclosable` on the state
 * document), so each is reported once rather than every hour. The latest met are kept: past this
 * many, the oldest goes, and is reported again if it is met again — a row an hour at most.
 */
export const UNCLOSABLE_KEPT = 500;
/**
 * And reported again this long after the last report, while such games are still met: one row
 * expires after 90 days (errorRetention.ts) and leaves the panel's newest 500 rows sooner, and a game
 * that is still there must not go back to being a number in a green line.
 */
export const UNCLOSABLE_REPORT_EVERY_MS = 7 * 86_400_000;
/**
 * The fields the expiry verdict reads (`expiryRefusal`), and the only ones the window reads. A game
 * padded to a megabyte costs the window nothing; only a game that is due is read whole, one at a time,
 * inside the transaction that closes it.
 */
const VERDICT_FIELDS = ["gameType", "finalized", "lastMoveAt", "createdAt", "date"];

export type SweepCounts = {
  scanned: number; due: number; closed: number; raced: number; failed: number; unclosable: number; slowLap: number;
  cut: number;
};

/**
 * The server refused the write for what the DOCUMENT is, not for anything this job did: gRPC
 * INVALID_ARGUMENT (3). A game padded to just under the 1 MiB a document may hold takes no more
 * fields, and closing it adds a few: "maximum entity size is 1048576 bytes" (measured on the
 * emulator, 10.10.2026). Nothing this job can do closes it.
 */
const isUnwritable = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === 3;

export interface SweepResult {
  /** Runs into the turn of the collection, this one included; 0 when this run completed a turn. */
  lapRuns: number;
  /** How many runs the last completed turn took, or null before the first one ends. */
  lastLapRuns: number | null;
}

export interface SweepOptions {
  window?: number;
  page?: number;
  perRun?: number;
  timeBudgetMs?: number;
  maxLapRuns?: number;
  /** The run's clock, for the time budget; the tests drive it. */
  clock?: () => number;
}

const wholeRuns = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/**
 * Read on from the cursor, closing the idle games met on the way, in id order. The cursor is saved
 * after every page, and — when the cap or the time budget stops the run — just behind the first idle
 * game it did not try, so nothing is passed over and a run that dies costs one page at most.
 * `counts` and `skipped` are filled as the run goes, so a run that dies half way still reports.
 */
export async function sweepIdleGames(
  db: FirebaseFirestore.Firestore,
  now: number,
  counts: SweepCounts,
  skipped: Record<string, number>,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const window = opts.window ?? SCAN_WINDOW;
  const page = opts.page ?? PAGE;
  const perRun = opts.perRun ?? PER_RUN;
  const timeBudgetMs = opts.timeBudgetMs ?? TIME_BUDGET_MS;
  const maxLapRuns = opts.maxLapRuns ?? MAX_LAP_RUNS;
  const clock = opts.clock ?? Date.now;
  const started = clock();

  const stateRef = db.doc(SWEEP_STATE_DOC);
  const prev = (await stateRef.get()).data() ?? {};
  const startedAfter = typeof prev.after === "string" && prev.after ? prev.after : null;
  const lapRunsBefore = wholeRuns(prev.lapRuns);
  const lastLapBefore: number | null = prev.lastLapRuns == null ? null : wholeRuns(prev.lastLapRuns);
  // The games already REPORTED as impossible to close, oldest first. A game leaves the list when it
  // is met and is no longer one (closed after all, or played again since), or when a turn ends and
  // it is not there any more. A game met for the first time joins it only once its report is written:
  // remembered before, a run that died, or a report that failed, would have kept it quiet for good.
  const unclosable = new Set<string>(
    (Array.isArray(prev.unclosable) ? prev.unclosable : [])
      .filter((id: unknown): id is string => typeof id === "string" && id !== "")
      .slice(-UNCLOSABLE_KEPT),
  );
  let unclosableReportedAt = typeof prev.unclosableReportedAt === "number" && Number.isFinite(prev.unclosableReportedAt)
    ? prev.unclosableReportedAt : 0;
  const newlyUnclosable: string[] = [];

  let after = startedAfter;
  // From the cursor to the end of the collection ("tail"), then — only when this run began part of
  // the way through — from the start up to the cursor ("head"), never past it: a window larger than
  // the collection reads every game once, not some of them twice.
  let phase: "tail" | "head" = "tail";
  let completedLap = false;
  const lapRuns = () => (completedLap ? 0 : lapRunsBefore + 1);
  const lastLapRuns = () => (completedLap ? lapRunsBefore + 1 : lastLapBefore);
  const save = () => stateRef.set({
    after, lapRuns: lapRuns(), lastLapRuns: lastLapRuns(), unclosable: [...unclosable].slice(-UNCLOSABLE_KEPT),
    unclosableReportedAt, at: Date.now(),
  });
  // Progress on the way is best-effort: the write at the end is the one that counts, and reports.
  const saveOnTheWay = async () => { try { await save(); } catch { /* the end writes it again */ } };

  let attempted = 0;
  pages: while (counts.scanned < window) {
    // Out of time between pages too, once anything was read: a slow window ends with its work saved.
    if (counts.scanned > 0 && clock() - started >= timeBudgetMs) {
      counts.cut = 1;
      break;
    }
    const want = Math.min(page, window - counts.scanned);
    let q = db.collection("games").orderBy(FieldPath.documentId()).select(...VERDICT_FIELDS).limit(want);
    if (after !== null) q = q.startAfter(after);
    if (phase === "head" && startedAfter !== null) q = q.endAt(startedAfter);
    const snap = await q.get();
    counts.scanned += snap.size;

    for (const d of snap.docs) {
      const refusal: ExpiryRefusal | null = expiryRefusal({ id: d.id, ...d.data() }, now);
      if (refusal !== null) {
        skipped[refusal] = (skipped[refusal] || 0) + 1;
        unclosable.delete(d.id);
        after = d.id;
        continue;
      }
      // Out of attempts or out of time: stop IN FRONT of this game, so the next run starts with it.
      if (attempted >= perRun || clock() - started >= timeBudgetMs) {
        counts.cut = 1;
        break pages;
      }
      counts.due += 1;
      attempted += 1;
      try {
        // A guarded write rather than a blind one: between the read above and here, somebody
        // may have made a move or pressed End, and the condition is re-asked inside the
        // transaction against the whole document as it stands now.
        //
        // The transaction RETURNS whether it wrote. Counting a closure because the call did not
        // throw would have counted every game the guard declined — so a run that touched
        // nothing at all would have reported closing two hundred.
        const wrote = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(d.ref);
          const data = fresh.data();
          if (!data) return false;
          if (expiryRefusal({ id: fresh.id, ...data }, Date.now()) !== null) return false;
          tx.update(d.ref, {
            ...closedSessionFields({ id: fresh.id, ...data }, true),
            endedAt: FieldValue.serverTimestamp(),
          });
          return true;
        });
        if (wrote) counts.closed += 1;
        else counts.raced += 1;
        unclosable.delete(d.id);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (isUnwritable(err)) {
          // Counted, and in the panel's line, but not a failure: it failed on every run that met it,
          // and kept the job red for good (10.10.2026). Every other refusal is still a failure.
          counts.unclosable += 1;
          console.warn("GAMES_EXPIRY_UNCLOSABLE " + JSON.stringify({ gameId: d.id, error }));
          // Tried again every turn — a game made small again is closed then — but reported once.
          if (unclosable.has(d.id)) {
            unclosable.delete(d.id);
            unclosable.add(d.id);
          } else {
            newlyUnclosable.push(d.id);
          }
        } else {
          counts.failed += 1;
          console.error("GAMES_EXPIRY_FAIL " + JSON.stringify({ gameId: d.id, error }));
        }
      }
      after = d.id;
    }

    if (snap.size < want) {
      if (phase === "tail") {
        // The end of the collection: the turn that ran from the start up to here is complete.
        completedLap = true;
        after = null;
        if (startedAfter !== null) {
          phase = "head";
          await saveOnTheWay();
          continue;
        }
      } else {
        // Back at where this run began: every game has been read in this one run.
        after = null;
      }
      break;
    }
    await saveOnTheWay();
  }

  // A turn ended in this run: the ids of games deleted since they were reported go. Only while the
  // list holds any, and once a turn; a read that fails leaves the list as it is for the next turn.
  if (completedLap && unclosable.size > 0) {
    try {
      const listed = await db.getAll(...[...unclosable].map((id) => db.doc(`games/${id}`)), { fieldMask: [] });
      for (const s of listed) if (!s.exists) unclosable.delete(s.id);
    } catch { /* the next turn checks again */ }
  }

  // ONE row for the games that cannot be closed, into errorLogs, where the Health panel's problems
  // and the digest read: a number in a green line reaches nobody. When one is met for the first time,
  // and again a week after the last row while any is still met. The same words every time (digits
  // aside), so it stays one problem; the ids are where the row says. A row that cannot be written is
  // a failure of the run, and its games are news again next time.
  const metUnclosable = counts.unclosable;
  if (newlyUnclosable.length > 0 || (metUnclosable > 0 && now - unclosableReportedAt >= UNCLOSABLE_REPORT_EVERY_MS)) {
    try {
      await addServerError(
        `expireIdleGames: ${metUnclosable} idle game(s) cannot be closed, the document is at its size limit; `
          + `the ids are in ${SWEEP_STATE_DOC}, field unclosable`,
        "job:expireIdleGames:unclosable",
      );
      for (const id of newlyUnclosable) unclosable.add(id);
      unclosableReportedAt = now;
    } catch (err) {
      counts.failed += 1;
      console.error("GAMES_EXPIRY_FAIL " + JSON.stringify({
        report: "unclosable", error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // The cursor once more at the end (also when the cap stopped the run mid-page). A run that dies
  // before this repeats at most the page it died in, never skips a game; a failed write is counted.
  try {
    await save();
  } catch (err) {
    counts.failed += 1;
    console.error("GAMES_EXPIRY_FAIL " + JSON.stringify({
      state: SWEEP_STATE_DOC, error: err instanceof Error ? err.message : String(err),
    }));
  }

  // Slow while this turn has already taken too long, AND until a turn ends within the limit again:
  // judging only where this run sits in the turn left most runs of an always-slow sweep green.
  counts.slowLap = Math.max(lapRunsBefore + 1, lastLapRuns() ?? 0) > maxLapRuns ? 1 : 0;
  return { lapRuns: lapRuns(), lastLapRuns: lastLapRuns() };
}

/** The run's line for the health panel: the same words every run, only the numbers change, so one
 *  recurring problem stays one group in the error log (errorGrouping.ts drops digits, not words). */
export function sweepDetail(c: SweepCounts, r: SweepResult): string {
  return `scanned ${c.scanned}, idle ${c.due}, closed ${c.closed}, failed ${c.failed}, unclosable ${c.unclosable}, `
    + `turn ${r.lapRuns}/${r.lastLapRuns ?? 0} (limit ${MAX_LAP_RUNS}), stopped early ${c.cut}`;
}

export const expireIdleGames = onSchedule(
  // Cron, not "every 60 minutes": that form restarts its count at every deploy (jobHealthCore.ts).
  { schedule: "0 * * * *", timeZone: "UTC", retryCount: 0 },
  () => runJob("expireIdleGames", async () => {
    const db = admin.firestore();
    const now = Date.now();

    // One line per run, whatever the run did — same shape as REMINDERS_RUN and ERROR_DIGEST, so
    // the same grep finds it. `skipped` is broken down by reason: a sweep that only reports what
    // it closed cannot be told apart from one that is silently skipping everything.
    const counts: SweepCounts = {
      scanned: 0, due: 0, closed: 0, raced: 0, failed: 0, unclosable: 0, slowLap: 0, cut: 0,
    };
    const skipped: Record<string, number> = {};
    let turn: SweepResult | null = null;
    const done = () => {
      console.log("GAMES_EXPIRY_RUN " + JSON.stringify({
        at: new Date(now).toISOString(), idleHours: IDLE_MS / 3_600_000, ...counts, skipped, turn,
      }));
    };

    try {
      turn = await sweepIdleGames(db, now, counts, skipped);
      // For the health panel. A slow turn counts against the run: an idle game may be waiting a day
      // past its 24 hours, and "closed 0" from a slow turn must not read as a clean one.
      const outcome: JobOutcome = { failed: counts.failed + counts.slowLap, detail: sweepDetail(counts, turn) };
      return outcome;
    } finally {
      // The promise above is one line per run, including a run that closed three games and then
      // died in the fourth — the same reason sendDueReminders wraps its counters in a finally.
      done();
    }
  }),
);
