// functions/src/reminders.ts
// Event reminders that actually fire.
//
// ── What this replaces ───────────────────────────────────────────────────────────────
//
// Nothing. Reminders have never worked on any platform. `CalendarHome` schedules them through
// `@capacitor/local-notifications`, which is not in `android/app/capacitor.build.gradle` at all —
// so on a phone the plugin is simply absent — and whose web implementation uses `setTimeout`, so
// in a browser a reminder only fires if the tab is still open at the moment. A reminder set for
// tomorrow morning arrived for nobody, ever.
//
// A scheduled function has neither problem: it does not care whether anybody has the app open,
// it reaches a phone through FCM, and it needs no Android rebuild.
//
// ── The three things that make this hard ─────────────────────────────────────────────
//
// 1. THE INSTANT IS COMPUTED, so it cannot be queried. A reminder is due at
//    (event start − reminderMinutes), and the start is a wall clock in a zone. There is no field
//    to range-query on. So the window is bounded by the LEAD TIME instead: an event whose reminder
//    is due now must start within the maximum lead of now.
//
// 2. RECURRING EVENTS ARE ONE DOCUMENT. A weekly series that began last year has a `date` far
//    outside any window around today, so a plain range query misses every occurrence of it. The
//    same expansion the calendar does has to happen here — `recurrenceServer.ts` exists for this.
//
// 3. IT MUST NOT SEND TWICE. Overlapping runs, retries and a redeployment mid-window all happen.
//    Dedupe is a document per (event, occurrence day) created with `create`, which fails if it is
//    already there — so the FIRST writer wins and a second run sends nothing, without needing the
//    two runs to agree about anything.
//
// ── 4. ONE ACCOUNT MUST NOT STOP EVERYBODY'S (12.10.2026) ─────────────────────────────
//
// A personal event's fields are not checked by the rules, and anybody can create as many as they
// like. Until 12.10 the job read two queries of at most 2000 WHOLE events: the recurring one ordered
// by the rule's VALUE (`true` sorts before every real rule, so 2000 junk events pushed every real
// series out), the dated one by date (2000 events at the start of the window pushed the rest out),
// and a few hundred padded events ran it out of memory. Now:
//   * the recurring query asks for the frequencies a series can have, so junk values are not read;
//   * both are read in small pages, only the fields the reminder is computed from, each event
//     reduced on arrival to a bounded copy (`compactEvent`), so a padded event costs its few fields
//     and a page its ten events. Pages, not a stream: leaving a stream early does not end its
//     request, and what it had already received stayed in memory for minutes (review, 12.10);
//   * each query has its own cap and its own time; past either the run stops reading and is RED —
//     an abuse becomes a problem in Admin → Health instead of quietly costing other people their
//     reminders;
//   * and since 29.10.2026 they are read OWNER BY OWNER, each owner with that cap and that time of
//     their own, so a flood costs only the account that made it (see `remindDue`).
// An edited occurrence keeps its series' original day from being reminded through the series' own
// exceptions: `createEventOverride` adds the day to them with every edit. The edit document itself
// (`expandInWindow`'s second dedupe) matters only for edits made before that, none on live; past a
// cut, such an edit may not have been read.

import * as crypto from "crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  FREQUENCIES, SERIES_REACH_DAYS, expandInWindow, type EventDoc, type Frequency,
} from "./recurrenceServer";
import { notify } from "./notify";
import { REMINDER_FIELDS, compactEvent, dueIn, sendOrder, type Due } from "./remindersCore";
import { isValidZone } from "./eventTime";
import { runJob, type JobOutcome } from "./jobRuns";

/** Delete dedupe rows older than this. They are only needed while their window is still in reach. */
const LOG_TTL_DAYS = 45;

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The earliest `date` a series of this frequency can have and still run on `fromDay` or after. One
 * range per frequency, each its own reach: a daily series runs 30 days, and the 400 days daily, weekly
 * and monthly shared until 17.10.2026 read a year of ended daily series first, in date order (review of
 * f1052b7).
 */
const seriesFrom = (fromDay: string, freq: Frequency): string =>
  `${dayString(Date.parse(`${fromDay}T00:00:00.000Z`) - SERIES_REACH_DAYS[freq] * 86_400_000)}T00:00:00.000Z`;

/** Firestore's refusal of a query whose composite index is missing, or still being built. */
const missingIndex = (err: unknown): boolean => {
  const code = (err as { code?: unknown })?.code;
  return (code === 9 || code === "failed-precondition")
    && /index/i.test(String((err as { message?: unknown })?.message || ""));
};

/**
 * How far ahead to look for events. A reminder may be set days in advance; beyond this it is not
 * delivered, and that is a stated bound rather than an accident — an unbounded lookahead means
 * expanding every recurring series in the database on every run.
 */
const MAX_LEAD_DAYS = 31;

/** How wide a net each run casts behind itself. Generous on purpose; the dedupe makes overlap free. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Events read per owner, read (dated, series) and run, at most. Measured on live on 12.10.2026: 2 in the
 * window and 1 series, out of 34 events. A family app is hundreds; this is that with room, and it bounds
 * what one account can make every run read (and what the project pays for it). Whichever comes first,
 * this or READ_BUDGET_MS, is the limit — at a page every ~50 ms, the time; REMINDERS_RUN logs the reads'.
 */
export const MAX_CANDIDATES = 5000;
/** How long each of an owner's two reads may take. Past it, as past the cap: stop, and the run is red. */
export const READ_BUDGET_MS = 15_000;
/**
 * The whole reading, every owner's: past it, an owner not yet read, or not done, is cut like one past
 * its cap. The two reads' time, as before reading went owner by owner, so the sending still fits.
 */
export const READS_DEADLINE_MS = 2 * READ_BUDGET_MS;
/** Owners read at the same time. */
export const OWNER_CONCURRENCY = 8;
/** Owners found per run, at most; past it the run is red. Each costs five queries a run (BACKLOG, 5.3). */
export const MAX_OWNERS = 1000;
/**
 * Events per page. What one page holds, padded, is ten times what one event can — and a list of a
 * million nulls, which fits in a document, is tens of megabytes once decoded.
 */
export const READ_PAGE = 10;
/** Owners' zones read per call. */
const ZONE_CHUNK = 100;
/** Dedupe rows read per call, before the turns are drawn: only their state. */
const LOG_CHUNK = 100;
/** How often the job runs (its cron), and how much later than that the next run may start. */
export const RUN_EVERY_MS = 5 * 60 * 1000;
export const LATE_RUN_SLACK_MS = 2 * 60 * 1000;
/**
 * How long a run keeps starting sends. Past it, a reminder that a later run still sees waits for it;
 * one on its last chance is counted as dropped, and the run is red: lost, unless it is in the slack
 * band and the next run starts on time (`sendOrder`). With the reads' 2 × 15 s, inside the 150 s timeout.
 */
export const SEND_BUDGET_MS = 60_000;
/**
 * A claim (`state: "sending"`) whose RUN started this long ago was left by a run that is over: it died,
 * or its send failed. The next run that still sees the reminder takes it over.
 *
 * Counted from the run's start (`runAt`), not from the claim (review, 17.10.2026). A run claims for as
 * long as it sends, up to a minute and a half after it starts, and the next run starts five minutes
 * after this one STARTED: four minutes from the claim was not yet reached when the next run looked at
 * a claim made late in a heavy run, or made by a run that started a minute late, and on the reminder's
 * last run that was a loss counted as "already sent". Two bounds, held by remindersStale.test.ts:
 *   * past the timeout (150 s), with room: a run still alive never loses its claim;
 *   * the cadence less the slack: the next run takes the claim over even when the claiming run
 *     started LATE_RUN_SLACK_MS later in its slot than the next one does.
 */
export const STALE_CLAIM_MS = RUN_EVERY_MS - LATE_RUN_SLACK_MS;

export type ReminderCounts = {
  /** Owners found, whose events were read each on their own. */
  owners: number;
  /** Events read, and how many of them could not be the app's (no id or date it writes). */
  read: number; skipped: number;
  /**
   * Owners whose read stopped before its end (past their cap, their time, or the deadline), plus one
   * when the owners themselves could not all be found. Any is red; nobody else's reminders are lost.
   */
  cut: number;
  /** How long each read took, for the log line: the page latency on live, measured. */
  datedMs: number; seriesMs: number;
  candidates: number; occurrences: number; due: number;
  /**
   * Not sent this run, and not known to have been sent by an earlier one: waiting for a later run
   * (deferred), or on their last chance (dropped, red). An upper bound on the lost: the slack band is in
   * it, and an on-time next run still sends those.
   */
  deferred: number; dropped: number;
  /** Claims left by an earlier run and taken over by this one. */
  retried: number;
  /** 1 when the series were read without a bound on their start: the index was not there yet. */
  seriesUnbounded: number;
  sent: number; dupes: number; rows: number; pushed: number; failed: number;
};

export const emptyCounts = (): ReminderCounts => ({
  owners: 0, read: 0, skipped: 0, cut: 0, datedMs: 0, seriesMs: 0, candidates: 0, occurrences: 0, due: 0,
  deferred: 0, dropped: 0, retried: 0, seriesUnbounded: 0,
  sent: 0, dupes: 0, rows: 0, pushed: 0, failed: 0,
});

/**
 * The run's line for the health panel, and whether it was ok: not when a reminder failed to send,
 * not when the read stopped short — the reminders after the stop were never looked at — and not
 * when one on its last chance was left unsent.
 */
export function reminderOutcome(c: ReminderCounts): JobOutcome {
  return {
    failed: c.failed + c.cut + c.dropped,
    detail: `due ${c.due}, sent ${c.sent}, already sent ${c.dupes}, failed ${c.failed}, `
      + `read ${c.read}, stopped early ${c.cut}, deferred ${c.deferred}, dropped ${c.dropped}, retried ${c.retried}`
      // Not red: nothing is lost. Said, so that a read longer than it should be has its reason beside it.
      + (c.seriesUnbounded ? ", series read without their index" : ""),
  };
}

/**
 * When the run holding a claim started, at the latest: the row's `runAt`, or, for a claim written before
 * 17.10.2026 (it has none), the claim itself. That run started before either, so the earlier of the two
 * is the nearest to its start. A row with neither was never the job's claim: stale, as before.
 */
function claimRunStart(row: FirebaseFirestore.DocumentData): number {
  const claimedAt = row.claimedAt as { toMillis?: () => number } | undefined;
  const claimed = typeof claimedAt?.toMillis === "function" ? claimedAt.toMillis() : 0;
  const runAt = typeof row.runAt === "number" && Number.isFinite(row.runAt) ? row.runAt : Number.POSITIVE_INFINITY;
  return Math.min(runAt, claimed);
}

const alreadyExists = (err: unknown): boolean => {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === "already-exists"
    || String((err as { message?: unknown })?.message || "").includes("ALREADY_EXISTS");
};

export interface RemindOptions {
  /** Per owner and read. */
  maxCandidates?: number;
  /** Per owner and read. */
  budgetMs?: number;
  /** The whole reading. */
  readsDeadlineMs?: number;
  concurrency?: number;
  maxOwners?: number;
  page?: number;
  sendBudgetMs?: number;
  /** The run's clock, for the read and send budgets; the tests drive it. */
  clock?: () => number;
}

type Candidate = EventDoc & Record<string, unknown>;

/**
 * The owners, in the order this run reads them: from a place that moves one owner every run, so that
 * when there are more owners than run at once, a slow one is not always ahead of the same others.
 */
export function ownerTurn<T>(owners: readonly T[], now: number): T[] {
  if (owners.length === 0) return [];
  const start = Math.floor(now / RUN_EVERY_MS) % owners.length;
  return [...owners.slice(start), ...owners.slice(0, start)];
}

/**
 * Every value of `ownerId` on an event, one document each: in `ownerId` order, the next past the last
 * found. Exactly the owners there are, whether their account has a `users` document or not, and an
 * owner costs one read however many events they have. `cut` when the time ran out, the cap was reached
 * with more to find, or a value came back that the cursor cannot get past.
 */
export async function findOwners(
  events: FirebaseFirestore.Query,
  maxOwners: number,
  outOfTime: () => boolean,
): Promise<{ owners: unknown[]; cut: boolean }> {
  const base = events.orderBy("ownerId").select("ownerId").limit(1);
  const owners: unknown[] = [];
  let snap = await base.get();
  while (!snap.empty) {
    const owner = snap.docs[0].get("ownerId");
    if (owners.length > 0 && JSON.stringify(owner) === JSON.stringify(owners[owners.length - 1])) {
      return { owners, cut: true };
    }
    if (owners.length >= maxOwners || outOfTime()) return { owners, cut: true };
    owners.push(owner);
    snap = await base.startAfter(owner).get();
  }
  return { owners, cut: false };
}

/**
 * Find and send the reminders due in (now − WINDOW_MS, now]. `now` is also the run's start, written in
 * its claims (`runAt`): the job passes `Date.now()` as it starts. `counts` is filled as the run goes, so
 * a run that dies half way still reports what it did.
 */
export async function remindDue(
  db: FirebaseFirestore.Firestore,
  now: number,
  counts: ReminderCounts,
  opts: RemindOptions = {},
): Promise<void> {
  const maxCandidates = opts.maxCandidates ?? MAX_CANDIDATES;
  const budgetMs = opts.budgetMs ?? READ_BUDGET_MS;
  const readsDeadlineMs = opts.readsDeadlineMs ?? READS_DEADLINE_MS;
  const concurrency = Math.max(1, opts.concurrency ?? OWNER_CONCURRENCY);
  const maxOwners = opts.maxOwners ?? MAX_OWNERS;
  const page = opts.page ?? READ_PAGE;
  const sendBudgetMs = opts.sendBudgetMs ?? SEND_BUDGET_MS;
  const clock = opts.clock ?? Date.now;
  const from = now - WINDOW_MS;

  // ── candidates ──────────────────────────────────────────────────────────
  //
  // Two queries rather than one unbounded scan, and neither can be served by a range on the
  // reminder instant, because there is no such field.
  //
  //   * events starting inside the lookahead — covers every non-recurring one;
  //   * series (a rule with a frequency the app knows), expanded below. Any other rule is not a series
  //     to `expandInWindow` either; inside the window the first query reads it, as before. Only those
  //     that can still have an occurrence from `fromDay` on (16.10.2026): a series ends at its horizon,
  //     counted from its start (recurrenceCore.ts), so it began at most its frequency's reach before
  //     (`SERIES_REACH_DAYS`: 31 days, 365, 367, 1828) — and not after the lookahead. Until then every
  //     run read every series ever made.
  //
  // OWNER BY OWNER since 29.10.2026 (BACKLOG, 5.3): the same queries, each filtered on one owner, with
  // that owner's own cap and time. Read with everybody's, one account's flood reached the cap or the
  // time first and cut everybody's reminders behind it; now it spends its own share, and the run is red
  // for that owner alone. The owners come from the events (`findOwners`). A few are read at a time, from
  // a place that moves every run (`ownerTurn`), all inside one deadline. A reminder's recipients (the
  // owner and the assignees) stay on its owner's event, so an account cannot spend anybody else's share
  // by naming them. No new index: (ownerId, date) is the AI sources', and the series' shape is served by
  // merging it with (recurrenceRule.frequency, date) — both measured on live that day.
  const fromDay = dayString(now - 2 * 86_400_000);
  const toDay = dayString(now + MAX_LEAD_DAYS * 86_400_000);
  const byId = new Map<string, Candidate>();

  const keep = (d: QueryDocumentSnapshot): void => {
    const c = compactEvent(d.id, d.data(), fromDay, toDay);
    if (c) byId.set(d.id, c);
    else counts.skipped += 1;
  };

  /** One read: when it started and what it has read, so that a fallback continues it rather than starting over. */
  type Read = { started: number; seen: Set<string> };
  const startRead = (): Read => ({ started: clock(), seen: new Set<string>() });
  // The whole reading's deadline, every owner's.
  const readsEnd = clock() + readsDeadlineMs;
  const outOfTime = (): boolean => clock() >= readsEnd;

  /**
   * Reads queries in turn, each to its end, page by page, or to the cap or the time: true when it
   * stopped short. One budget and one cap for the queries of one read, so the dated read and the series
   * read each have their own full share — the series read's fallback included (review, 17.10.2026: a
   * refusal after a page started it over, counting twice, with a second budget and a second cap). One
   * read is one owner's; the deadline is everybody's.
   */
  const readAll = async (read: Read, ...bases: FirebaseFirestore.Query[]): Promise<boolean> => {
    const { started, seen } = read;
    for (const base of bases) {
      let last: QueryDocumentSnapshot | null = null;
      // This query's own documents, for the guard below; not `seen`, which also holds what an earlier
      // query of the read brought. A fallback reads those again, and that is progress, not a page coming
      // back: judged on `seen`, its first page stopped the read (red) before the rest was reached.
      const here = new Set<string>();
      for (;;) {
        const t = clock();
        if (t - started >= budgetMs || t >= readsEnd) return true;
        // One past the cap, to tell "exactly the cap" from "more than it".
        const want = Math.min(page, maxCandidates + 1 - seen.size);
        const snap = await (last ? base.startAfter(last) : base).limit(want).get();
        let fresh = 0;
        for (const d of snap.docs) {
          // A cursor on a value longer than Firestore indexes (1500 bytes) can repeat a page.
          if (here.has(d.id)) continue;
          here.add(d.id);
          fresh += 1;
          // Read already by an earlier query of this read: once is enough, and counted once.
          if (seen.has(d.id)) continue;
          if (seen.size >= maxCandidates) return true;
          seen.add(d.id);
          counts.read += 1;
          keep(d);
        }
        if (snap.size < want) break;
        // A full page with nothing new would be read again for ever: stop, and say so.
        if (fresh === 0) return true;
        last = snap.docs[snap.docs.length - 1];
      }
    }
    return false;
  };
  const events = db.collection("events");
  const dated = (owner: unknown) => events
    .where("ownerId", "==", owner)
    .where("date", ">=", `${fromDay}T00:00:00.000Z`)
    .where("date", "<=", `${toDay}T23:59:59.999Z`)
    .select(...REMINDER_FIELDS);
  // One frequency a range (`in` of one, the shape measured on live), each from its own reach back.
  const series = (owner: unknown, freq: Frequency) => events
    .where("ownerId", "==", owner)
    .where("recurrenceRule.frequency", "in", [freq])
    .where("date", ">=", seriesFrom(fromDay, freq))
    .where("date", "<=", `${toDay}T23:59:59.999Z`)
    .select(...REMINDER_FIELDS);

  const found = await findOwners(events, maxOwners, outOfTime);
  counts.owners = found.owners.length;
  let ownersCut = found.cut ? 1 : 0;

  /** One owner's two reads, each with its own cap and time, inside the deadline. */
  const readOwner = async (owner: unknown): Promise<void> => {
    if (outOfTime()) {
      ownersCut += 1;
      return;
    }
    let t0 = Date.now();
    const datedCut = await readAll(startRead(), dated(owner));
    counts.datedMs += Date.now() - t0;
    t0 = Date.now();
    const seriesRead = startRead();
    let seriesCut: boolean;
    try {
      seriesCut = await readAll(seriesRead, ...FREQUENCIES.map((f) => series(owner, f)));
    } catch (err) {
      // A shape whose index is missing, or still being built, throws rather than returning less.
      // Then: every series of this owner, however old, as before 16.10.2026, and the run says so.
      // Inside the same read, should the refusal come after a page: its time, its cap, its count.
      if (!missingIndex(err)) throw err;
      counts.seriesUnbounded = 1;
      seriesCut = await readAll(seriesRead, events
        .where("ownerId", "==", owner)
        .where("recurrenceRule.frequency", "in", [...FREQUENCIES])
        .select(...REMINDER_FIELDS));
    }
    counts.seriesMs += Date.now() - t0;
    if (datedCut || seriesCut) ownersCut += 1;
  };

  const queue = ownerTurn(found.owners, now);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (next < queue.length) await readOwner(queue[next++]);
  }));
  counts.cut = ownersCut;

  const docs = [...byId.values()];
  counts.candidates = docs.length;
  if (docs.length === 0) return;

  const occurrences = expandInWindow(docs, fromDay, toDay)
    .map((o) => ({ source: o.source as Candidate, day: o.day }));

  // Owners' zones, for the events that need them: a reminder, and no zone of their own. Only that
  // field, in chunks, every owner (it stopped at 400 owners, and read the whole profile).
  const needZone = [...new Set(docs
    .filter((d) => typeof d.reminderMinutes === "number" && d.reminderMinutes >= 0 && !isValidZone(d.timezone))
    .map((d) => (typeof d.ownerId === "string" ? d.ownerId : ""))
    .filter(Boolean))];
  const ownerZones: Record<string, string | undefined> = {};
  for (let i = 0; i < needZone.length; i += ZONE_CHUNK) {
    const ids = needZone.slice(i, i + ZONE_CHUNK);
    const snaps = await db.getAll(...ids.map((u) => db.doc(`users/${u}`)), { fieldMask: ["timezone"] });
    snaps.forEach((s, j) => {
      const zone = s.get("timezone");
      if (typeof zone === "string" && zone.length <= 64) ownerZones[ids[j]] = zone;
    });
  }

  const due = dueIn(occurrences, ownerZones, from, now);
  counts.occurrences = occurrences.length;
  counts.due = due.length;
  if (due.length === 0) return;

  // ── send, at most once each, in turns ───────────────────────────────────
  //
  // Each send is CLAIMED first — a `reminder_log` row created with `state: "sending"`, which fails if
  // the row exists, so an overlapping run sends nothing twice — and marked `sent` after. Until
  // 13.10.2026 the row was the whole record: a run that died between it and the send, or a send that
  // failed, lost the reminder for good, every later run reading it as delivered. Now a claim still
  // "sending" whose run started STALE_CLAIM_MS ago is taken over by the next run that still sees the
  // reminder, however late in its run it was made. The price is the rare reminder sent twice
  // (delivered, then the mark failed), not a lost one; the bell rows are keyed by the reminder
  // (`rowKey`), so a second send rewrites them, and the push goes again. A claim whose run started less
  // long ago may still be on its way (a run started alongside this one: a delivery twice, a run by
  // hand): it is left to that run, which counts its own failure.
  const sendStarted = clock();
  // What an earlier run already sent is neither this run's to send nor to count as lost (review,
  // 17.10.2026). A reminder is due in three runs, and each of them sent it through `claim`: a create
  // that fails and a transaction, three round trips, at the head of its owner's turns, and past the
  // budget one delivered runs before was counted dropped (red) or deferred. So its row is read first,
  // only the state, a hundred a call, inside the send time: "sent", or no state at all (a row from
  // before 13.10, or from that code until it is replaced), is a dupe now; a row still "sending" goes
  // on to `claim`, which alone decides whether it is taken over. A read that fails costs only its
  // price: its reminders go to `claim`, as before.
  const pending: Due[] = [];
  for (let i = 0; i < due.length; i += LOG_CHUNK) {
    const chunk = due.slice(i, i + LOG_CHUNK);
    let rows: FirebaseFirestore.DocumentSnapshot[];
    try {
      rows = await db.getAll(...chunk.map((d) => db.doc(`reminder_log/${d.key}`)), { fieldMask: ["state"] });
    } catch (err) {
      console.error("reminder: could not read the dedupe rows; each is claimed instead", err);
      pending.push(...chunk);
      continue;
    }
    rows.forEach((row, j) => {
      if (row.exists && row.get("state") !== "sending") counts.dupes += 1;
      else pending.push(chunk[j]);
    });
  }
  const { order, lastChance } = sendOrder(pending, now, WINDOW_MS, RUN_EVERY_MS, LATE_RUN_SLACK_MS);

  /** "send" when this run owns the reminder now; "skip" when another run has it, or had it delivered. */
  const claim = async (d: Due): Promise<"send" | "skip"> => {
    const logRef = db.doc(`reminder_log/${d.key}`);
    // This claim's own mark, written with it. The SDK resends a write whose answer was lost: the
    // `create` on UNAVAILABLE, the whole transaction below on INTERNAL or DEADLINE_EXCEEDED. When the
    // first attempt had been applied, the resend meets this claim's own row, which without the mark
    // reads as another run's: not sent, counted "already sent", and lost on its last run. (Review,
    // 17.10.2026.) One per claim, not per run, so that only a resend of this very write matches it.
    const claimId = crypto.randomUUID();
    try {
      // `runAt`: when this run started, which is what a later run judges the claim by (STALE_CLAIM_MS).
      await logRef.create({ eventId: d.eventId, day: d.day, at: d.at, state: "sending", claimedAt: FieldValue.serverTimestamp(), runAt: now, claimId });
      return "send";
    } catch (err) {
      // Only ALREADY_EXISTS means the row is there: another run's, or this claim's own, resent.
      // Counting every rejection as a dupe would have made a transient UNAVAILABLE read as "somebody
      // else delivered it". (Review finding.)
      if (!alreadyExists(err)) throw err;
    }
    // A row made before 13.10 has no state: it was sent. A claim made before 17.10 has no `claimId`
    // (never this one's) and no `runAt` (judged by when it was made, which is later than its run's start).
    let tookOver = false;
    const taken = await db.runTransaction(async (tx) => {
      const row = (await tx.get(logRef)).data();
      if (!row || row.state !== "sending") return false;
      if (row.claimId === claimId) return true;
      if (Date.now() - claimRunStart(row) < STALE_CLAIM_MS) return false;
      // `runAt` moves with the claim: left as it was, a second run would read the claim this one has
      // just taken as still stale, and send it too.
      tx.update(logRef, { claimedAt: FieldValue.serverTimestamp(), runAt: now, claimId, retries: FieldValue.increment(1) });
      tookOver = true;
      return true;
    });
    if (!taken) return "skip";
    // Taken over from an earlier run, by this attempt or by one whose commit was applied unanswered.
    if (tookOver) counts.retried += 1;
    return "send";
  };

  for (const d of order) {
    if (clock() - sendStarted >= sendBudgetMs) {
      if (lastChance.has(d.key)) {
        counts.dropped += 1;
        console.error("reminder: out of time on its last run", d.key);
      } else {
        counts.deferred += 1;
      }
      continue;
    }

    let owned: "send" | "skip";
    try {
      owned = await claim(d);
    } catch (err) {
      counts.failed += 1;
      console.error("reminder: dedupe write failed", d.key, err);
      continue;
    }
    if (owned === "skip") {
      counts.dupes += 1;
      continue;
    }

    try {
      const delivered = await notify({
        userIds: d.recipients,
        // Nobody caused this; the schedule did. An empty `createdBy` also means `notify` drops
        // nobody from the recipients — the owner is meant to be reminded of their own event.
        createdBy: "",
        type: "reminder",
        titleKey: "notifReminder",
        titleParam: d.title,
        bodyKey: d.bodyKey,
        param: d.bodyParam,
        data: { route: "/", eventId: d.eventId },
        rowKey: `reminder:${d.key}`,
      });
      counts.sent += 1;
      counts.rows += delivered.rows;
      counts.pushed += delivered.pushed;
    } catch (err) {
      // The claim stays "sending": a later run that still sees the reminder tries again. The bell rows
      // may be written already (their commit applied, then answered with DEADLINE_EXCEEDED or INTERNAL,
      // which the SDK does not retry); the retry rewrites them. No push went out: it follows the rows.
      counts.failed += 1;
      console.error("reminder: could not deliver", d.key, err);
      continue;
    }
    try {
      await db.doc(`reminder_log/${d.key}`).update({ state: "sent", sentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      // Delivered; only the mark is missing, so a later run may send it again. Said, not counted.
      console.error("reminder: delivered but not marked sent", d.key, err);
    }
  }
}

export const sendDueReminders = onSchedule(
  // Cron, not "every 5 minutes": that form restarts its count at every deploy (jobHealthCore.ts).
  // Time and memory stated, not the platform's 60 s and 256 MiB: the read alone may take up to
  // 2 × READ_BUDGET_MS, and the sending follows it. Under a fifth of jobHealthCore's STUCK_MS, so a
  // run still inside its time never reads as stuck (jobRuns.test.ts holds the two together).
  { schedule: "*/5 * * * *", timeZone: "UTC", retryCount: 0, timeoutSeconds: 150, memory: "512MiB" },
  () => runJob("sendDueReminders", async () => {
    const db = admin.firestore();
    const now = Date.now();

    // One line per run, whatever the run did. Until now this function wrote NOTHING — every
    // execution was an empty log line — so "did it find anything?" had no answer short of
    // reading the database. Same shape as ERROR_DIGEST: a fixed prefix and one JSON object, so it
    // can be grepped and parsed by the same means.
    const counts = emptyCounts();
    // Everything below sits in a try so that the finally can keep the promise made above: one
    // REMINDERS_RUN line per run, whatever the run did — including a run that delivered three
    // reminders and then died in housekeeping. Without this, a throw anywhere lost the line and
    // the counters with it. (Review finding.)
    try {
      await remindDue(db, now, counts);

      // ── housekeeping ────────────────────────────────────────────────────────
      // Every run, also a quiet one (since 12.10; it ran only when something was due, so with nothing
      // due for weeks the old rows stayed).
      const cutoff = dayString(now - LOG_TTL_DAYS * 86_400_000);
      const stale = await db.collection("reminder_log").where("day", "<", cutoff).limit(400).get();
      if (!stale.empty) {
        const batch = db.batch();
        stale.docs.forEach((s) => batch.delete(s.ref));
        await batch.commit();
      }
      // The same counters, for the health panel. `failed` decides whether the run was ok: a run whose
      // every reminder failed to send is not a green run, and neither is one that stopped reading.
      return reminderOutcome(counts);
    } finally {
      console.log("REMINDERS_RUN " + JSON.stringify({ at: new Date(now).toISOString(), ...counts }));
    }
  }),
);
