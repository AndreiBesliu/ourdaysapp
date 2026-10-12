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
//     reminders. Making it impossible needs reading by owner: BACKLOG.
// An edited occurrence keeps its series' original day from being reminded through the series' own
// exceptions: `createEventOverride` adds the day to them with every edit. The edit document itself
// (`expandInWindow`'s second dedupe) matters only for edits made before that, none on live; past a
// cut, such an edit may not have been read.

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FREQUENCIES, expandInWindow, type EventDoc } from "./recurrenceServer";
import { notify } from "./notify";
import { REMINDER_FIELDS, compactEvent, dueIn } from "./remindersCore";
import { isValidZone } from "./eventTime";
import { runJob, type JobOutcome } from "./jobRuns";

/** Delete dedupe rows older than this. They are only needed while their window is still in reach. */
const LOG_TTL_DAYS = 45;

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * How far ahead to look for events. A reminder may be set days in advance; beyond this it is not
 * delivered, and that is a stated bound rather than an accident — an unbounded lookahead means
 * expanding every recurring series in the database on every run.
 */
const MAX_LEAD_DAYS = 31;

/** How wide a net each run casts behind itself. Generous on purpose; the dedupe makes overlap free. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Events read per query and run, at most. Measured on live on 12.10.2026: 2 in the window and 1
 * series, out of 34 events. A family app is hundreds; this is that with room, and it bounds what one
 * account can make every run read (and what the project pays for it). Whichever comes first, this or
 * READ_BUDGET_MS, is the limit — at a page every ~50 ms, the time; REMINDERS_RUN logs each read's.
 */
export const MAX_CANDIDATES = 5000;
/** How long each query may take to read. Past it, as past the cap: stop, and the run is red. */
export const READ_BUDGET_MS = 15_000;
/**
 * Events per page. What one page holds, padded, is ten times what one event can — and a list of a
 * million nulls, which fits in a document, is tens of megabytes once decoded.
 */
export const READ_PAGE = 10;
/** Owners' zones read per call. */
const ZONE_CHUNK = 100;

export type ReminderCounts = {
  /** Events read, and how many of them could not be the app's (no id or date it writes). */
  read: number; skipped: number;
  /** 1 when a query stopped before its end: past the cap or the time. */
  cut: number;
  /** How long each read took, for the log line: the page latency on live, measured. */
  datedMs: number; seriesMs: number;
  candidates: number; occurrences: number; due: number;
  sent: number; dupes: number; rows: number; pushed: number; failed: number;
};

export const emptyCounts = (): ReminderCounts => ({
  read: 0, skipped: 0, cut: 0, datedMs: 0, seriesMs: 0, candidates: 0, occurrences: 0, due: 0,
  sent: 0, dupes: 0, rows: 0, pushed: 0, failed: 0,
});

/**
 * The run's line for the health panel, and whether it was ok: not when a reminder failed to send,
 * and not when the read stopped short — the reminders after the stop were never looked at.
 */
export function reminderOutcome(c: ReminderCounts): JobOutcome {
  return {
    failed: c.failed + c.cut,
    detail: `due ${c.due}, sent ${c.sent}, already sent ${c.dupes}, failed ${c.failed}, `
      + `read ${c.read}, stopped early ${c.cut}`,
  };
}

export interface RemindOptions {
  maxCandidates?: number;
  budgetMs?: number;
  page?: number;
  /** The run's clock, for the read budget; the tests drive it. */
  clock?: () => number;
}

type Candidate = EventDoc & Record<string, unknown>;

/**
 * Find and send the reminders due in (now − WINDOW_MS, now]. `counts` is filled as the run goes, so
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
  const page = opts.page ?? READ_PAGE;
  const clock = opts.clock ?? Date.now;
  const from = now - WINDOW_MS;

  // ── candidates ──────────────────────────────────────────────────────────
  //
  // Two queries rather than one unbounded scan, and neither can be served by a range on the
  // reminder instant, because there is no such field.
  //
  //   * events starting inside the lookahead — covers every non-recurring one;
  //   * series (a rule with a frequency the app knows), which start anywhere and are expanded below.
  //     Any other rule is not a series to `expandInWindow` either; inside the window the first query
  //     reads it, as before.
  const fromDay = dayString(now - 2 * 86_400_000);
  const toDay = dayString(now + MAX_LEAD_DAYS * 86_400_000);
  const byId = new Map<string, Candidate>();

  const keep = (d: QueryDocumentSnapshot): void => {
    const c = compactEvent(d.id, d.data(), fromDay, toDay);
    if (c) byId.set(d.id, c);
    else counts.skipped += 1;
  };

  /**
   * Reads one query to its end, page by page, or to its cap or its time: true when it stopped short.
   * Its own budget, so one query read to the limit leaves the other its full share.
   */
  const readAll = async (base: FirebaseFirestore.Query): Promise<boolean> => {
    const started = clock();
    const seen = new Set<string>();
    let last: QueryDocumentSnapshot | null = null;
    for (;;) {
      if (clock() - started >= budgetMs) return true;
      // One past the cap, to tell "exactly the cap" from "more than it".
      const want = Math.min(page, maxCandidates + 1 - seen.size);
      const snap = await (last ? base.startAfter(last) : base).limit(want).get();
      let fresh = 0;
      for (const d of snap.docs) {
        // A cursor on a value longer than Firestore indexes (1500 bytes) can repeat a page.
        if (seen.has(d.id)) continue;
        if (seen.size >= maxCandidates) return true;
        seen.add(d.id);
        fresh += 1;
        counts.read += 1;
        keep(d);
      }
      if (snap.size < want) return false;
      // A full page with nothing new would be read again for ever: stop, and say so.
      if (fresh === 0) return true;
      last = snap.docs[snap.docs.length - 1];
    }
  };
  const events = db.collection("events");
  let t0 = Date.now();
  const datedCut = await readAll(events
    .where("date", ">=", `${fromDay}T00:00:00.000Z`)
    .where("date", "<=", `${toDay}T23:59:59.999Z`)
    .select(...REMINDER_FIELDS));
  counts.datedMs = Date.now() - t0;
  t0 = Date.now();
  const seriesCut = await readAll(events
    .where("recurrenceRule.frequency", "in", [...FREQUENCIES])
    .select(...REMINDER_FIELDS));
  counts.seriesMs = Date.now() - t0;
  counts.cut = datedCut || seriesCut ? 1 : 0;

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

  // ── send, at most once each ─────────────────────────────────────────────
  for (const d of due) {
    const logRef = db.doc(`reminder_log/${d.key}`);
    try {
      // `create` throws if the document exists. That is the dedupe: the first run to get here
      // wins, and a second one stops before sending rather than having to coordinate.
      await logRef.create({ eventId: d.eventId, day: d.day, at: d.at, sentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      // Only ALREADY_EXISTS means an overlapping run got here first. Counting every rejection
      // as a dupe would have made a transient UNAVAILABLE read as "somebody else delivered it" —
      // a log line that lies is worse than the silence it replaced. (Review finding.)
      const code = (err as { code?: unknown })?.code;
      const already = code === 6 || code === "already-exists"
        || String((err as { message?: unknown })?.message || "").includes("ALREADY_EXISTS");
      if (already) {
        counts.dupes += 1;
      } else {
        counts.failed += 1;
        console.error("reminder: dedupe write failed", d.key, err);
      }
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
      });
      counts.sent += 1;
      counts.rows += delivered.rows;
      counts.pushed += delivered.pushed;
    } catch (err) {
      counts.failed += 1;
      console.error("reminder: could not deliver", d.key, err);
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
