"use strict";
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
//   * and since 29.10.2026 they are read SHARE BY SHARE — a group's events, an owner's personal ones —
//     each with that cap and that time of its own, every share a first turn before any a second, so a
//     flood costs the share it was written into (see `remindDue`).
// An edited occurrence keeps its series' original day from being reminded through the series' own
// exceptions: `createEventOverride` adds the day to them with every edit. The edit document itself
// (`expandInWindow`'s second dedupe) matters only for edits made before that, none on live; past a
// cut, such an edit may not have been read.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDueReminders = exports.emptyCounts = exports.STALE_CLAIM_MS = exports.SEND_BUDGET_MS = exports.LATE_RUN_SLACK_MS = exports.RUN_EVERY_MS = exports.READ_PAGE = exports.SCAN_BOUNDS = exports.MAX_OWNERS = exports.SHARE_CONCURRENCY = exports.FIRST_SHARE = exports.SCAN_BUDGET_MS = exports.READS_DEADLINE_MS = exports.READ_BUDGET_MS = exports.MAX_CANDIDATES = void 0;
exports.reminderOutcome = reminderOutcome;
exports.ownerTurn = ownerTurn;
exports.findKeys = findKeys;
exports.remindDue = remindDue;
const crypto = require("crypto");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const recurrenceServer_1 = require("./recurrenceServer");
const notify_1 = require("./notify");
const remindersCore_1 = require("./remindersCore");
const eventTime_1 = require("./eventTime");
const jobRuns_1 = require("./jobRuns");
/** Delete dedupe rows older than this. They are only needed while their window is still in reach. */
const LOG_TTL_DAYS = 45;
const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);
/**
 * The earliest `date` a series of this frequency can have and still run on `fromDay` or after. One
 * range per frequency, each its own reach: a daily series runs 30 days, and the 400 days daily, weekly
 * and monthly shared until 17.10.2026 read a year of ended daily series first, in date order (review of
 * f1052b7).
 */
const seriesFrom = (fromDay, freq) => `${dayString(Date.parse(`${fromDay}T00:00:00.000Z`) - recurrenceServer_1.SERIES_REACH_DAYS[freq] * 86400000)}T00:00:00.000Z`;
/** Firestore's refusal of a query whose composite index is missing, or still being built. */
const missingIndex = (err) => {
    const code = err === null || err === void 0 ? void 0 : err.code;
    return (code === 9 || code === "failed-precondition")
        && /index/i.test(String((err === null || err === void 0 ? void 0 : err.message) || ""));
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
 * Events read per share (a group's events, or one owner's personal ones), read (dated, series) and run, at
 * most. Measured on live on 12.10.2026: 2 in the window and 1 series, out of 34 events. A family app is
 * hundreds; this is that with room, and it bounds what one account can make every run read (and what the
 * project pays for it). Whichever comes first, this or READ_BUDGET_MS, is the limit.
 */
exports.MAX_CANDIDATES = 5000;
/**
 * How long each of a share's two reads may take, counted over both its turns. The two run side by side.
 * Past it, as past the cap: stop, and the run is red.
 */
exports.READ_BUDGET_MS = 15000;
/**
 * The whole reading, every share's, from when the shares are found: past it, a share not yet read, or not
 * done, is cut like one past its cap. The two reads' time, as before reading went share by share, so the
 * sending still fits in the function's time.
 */
exports.READS_DEADLINE_MS = 2 * exports.READ_BUDGET_MS;
/** How long finding the shares may take, before the reading's deadline starts. */
exports.SCAN_BUDGET_MS = 10000;
/**
 * Events each read takes in its FIRST turn. Every share gets its first turn before any share gets a second,
 * so a few shares that fill their reads to the cap or the time cannot hold every worker until the deadline
 * and cut the shares behind them (review, 29.10.2026: eight accounts did). A family's window is well under it.
 */
exports.FIRST_SHARE = 100;
/** Shares read at the same time. With a page at ~120 ms (functions in us-central1, Firestore in europe-central2). */
exports.SHARE_CONCURRENCY = 16;
/** Owners, and groups, found per run, at most each; past it the run is red. A share costs six reads a run. */
exports.MAX_OWNERS = 1000;
/**
 * Where the scans for owners and groups split, so that they run side by side rather than one value after
 * another (review, 29.10.2026: one after another, a few hundred owners took the whole reading's time). The
 * ids are Firebase's: letters and digits. Any other string still falls in one of the ranges.
 */
exports.SCAN_BOUNDS = ["", "4", "8", "D", "H", "L", "P", "T", "X", "b", "f", "j", "n", "r", "v", "z"];
/** The runs that see one reminder: WINDOW_MS over RUN_EVERY_MS (both below). */
const RUNS_PER_REMINDER = 3;
/**
 * Events per page. What one page holds, padded, is ten times what one event can — and a list of a
 * million nulls, which fits in a document, is tens of megabytes once decoded.
 */
exports.READ_PAGE = 10;
/** Owners' zones read per call. */
const ZONE_CHUNK = 100;
/** Dedupe rows read per call, before the turns are drawn: only their state. */
const LOG_CHUNK = 100;
/** How often the job runs (its cron), and how much later than that the next run may start. */
exports.RUN_EVERY_MS = 5 * 60 * 1000;
exports.LATE_RUN_SLACK_MS = 2 * 60 * 1000;
/**
 * How long a run keeps starting sends. Past it, a reminder that a later run still sees waits for it;
 * one on its last chance is counted as dropped, and the run is red: lost, unless it is in the slack
 * band and the next run starts on time (`sendOrder`). With the reads' 2 × 15 s, inside the 150 s timeout.
 */
exports.SEND_BUDGET_MS = 60000;
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
exports.STALE_CLAIM_MS = exports.RUN_EVERY_MS - exports.LATE_RUN_SLACK_MS;
const emptyCounts = () => ({
    owners: 0, groups: 0, read: 0, skipped: 0, cut: 0, datedMs: 0, seriesMs: 0, candidates: 0, occurrences: 0, due: 0,
    deferred: 0, dropped: 0, retried: 0, seriesUnbounded: 0,
    sent: 0, dupes: 0, rows: 0, pushed: 0, failed: 0,
});
exports.emptyCounts = emptyCounts;
/**
 * The run's line for the health panel, and whether it was ok: not when a reminder failed to send,
 * not when the read stopped short — the reminders after the stop were never looked at — and not
 * when one on its last chance was left unsent.
 */
function reminderOutcome(c) {
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
function claimRunStart(row) {
    const claimedAt = row.claimedAt;
    const claimed = typeof (claimedAt === null || claimedAt === void 0 ? void 0 : claimedAt.toMillis) === "function" ? claimedAt.toMillis() : 0;
    const runAt = typeof row.runAt === "number" && Number.isFinite(row.runAt) ? row.runAt : Number.POSITIVE_INFINITY;
    return Math.min(runAt, claimed);
}
const alreadyExists = (err) => {
    const code = err === null || err === void 0 ? void 0 : err.code;
    return code === 6 || code === "already-exists"
        || String((err === null || err === void 0 ? void 0 : err.message) || "").includes("ALREADY_EXISTS");
};
/**
 * The shares, in the order this run reads them. The start moves a third of the ring every run: a reminder
 * is seen by three runs, and when a run cuts the tail of the queue, consecutive runs then cut different
 * tails, so no share is cut in all three unless a run reads less than a third (review, 29.10.2026: moved
 * one a run, the same share was cut run after run).
 */
function ownerTurn(shares, now) {
    const n = shares.length;
    if (n === 0)
        return [];
    const step = Math.ceil(n / RUNS_PER_REMINDER);
    const start = ((Math.floor(now / exports.RUN_EVERY_MS) % n) * step) % n;
    return [...shares.slice(start), ...shares.slice(0, start)];
}
/**
 * Every string value of `field` on an event, one document each: the ranges of SCAN_BOUNDS side by side,
 * each in order, the next past the last found. Exactly the owners (or groups) there are, whether their
 * account has a `users` document or not; a value costs one read however many events carry it. A range on a
 * string skips null, so the groups' scan finds no "group" for personal events. `cut` when the time ran
 * out, the cap was reached with more to find, or a value came back that the cursor cannot get past.
 */
async function findKeys(events, field, maxKeys, outOfTime) {
    const perRange = exports.SCAN_BOUNDS.map(() => []);
    let found = 0;
    let cut = false;
    await Promise.all(exports.SCAN_BOUNDS.map(async (lo, i) => {
        const hi = exports.SCAN_BOUNDS[i + 1];
        let base = events.where(field, ">=", lo);
        if (hi !== undefined)
            base = base.where(field, "<", hi);
        base = base.orderBy(field).select(field).limit(1);
        let last;
        for (;;) {
            if (cut)
                return;
            const snap = await (last === undefined ? base : base.startAfter(last)).get();
            if (snap.empty)
                return;
            const key = snap.docs[0].get(field);
            if (typeof key !== "string" || key === last || found >= maxKeys || outOfTime()) {
                cut = true;
                return;
            }
            found += 1;
            perRange[i].push(key);
            last = key;
        }
    }));
    return { keys: perRange.flat(), cut };
}
/**
 * Find and send the reminders due in (now − WINDOW_MS, now]. `now` is also the run's start, written in
 * its claims (`runAt`): the job passes `Date.now()` as it starts. `counts` is filled as the run goes, so
 * a run that dies half way still reports what it did.
 */
async function remindDue(db, now, counts, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const maxCandidates = (_a = opts.maxCandidates) !== null && _a !== void 0 ? _a : exports.MAX_CANDIDATES;
    const budgetMs = (_b = opts.budgetMs) !== null && _b !== void 0 ? _b : exports.READ_BUDGET_MS;
    const readsDeadlineMs = (_c = opts.readsDeadlineMs) !== null && _c !== void 0 ? _c : exports.READS_DEADLINE_MS;
    const scanBudgetMs = (_d = opts.scanBudgetMs) !== null && _d !== void 0 ? _d : exports.SCAN_BUDGET_MS;
    const firstShare = (_e = opts.firstShare) !== null && _e !== void 0 ? _e : exports.FIRST_SHARE;
    const concurrency = Math.max(1, (_f = opts.concurrency) !== null && _f !== void 0 ? _f : exports.SHARE_CONCURRENCY);
    const maxOwners = (_g = opts.maxOwners) !== null && _g !== void 0 ? _g : exports.MAX_OWNERS;
    const page = (_h = opts.page) !== null && _h !== void 0 ? _h : exports.READ_PAGE;
    const sendBudgetMs = (_j = opts.sendBudgetMs) !== null && _j !== void 0 ? _j : exports.SEND_BUDGET_MS;
    const clock = (_k = opts.clock) !== null && _k !== void 0 ? _k : Date.now;
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
    // SHARE BY SHARE since 29.10.2026 (BACKLOG, 5.3). Read with everybody's, one account's flood reached the
    // cap or the time first and cut everybody's reminders behind it. Now the events are read in shares, each
    // with its own cap and time, and a flood spends the share it was written into:
    //   * a GROUP's events are one share (`groupId ==`): only its members write there, the server's edits of
    //     an occurrence (`createEventOverride`) included — those carry the parent's owner, so shares by owner
    //     alone let a member fill another member's (review, 29.10.2026);
    //   * an owner's PERSONAL events are another (`ownerId ==`, `groupId == null`). Every writer writes the
    //     null, the installed APK included, and no event on live lacked it that day; one that did would not
    //     be read.
    // The owners and groups are found from the events (`findKeys`), over ranges of their ids side by side,
    // in their own time. Every share gets a first turn (`FIRST_SHARE` events a read) before any gets a second,
    // which goes on from where the first stopped: a few shares that fill their reads cannot hold every worker
    // until the deadline. Within a share the dated read and the series' four ranges run side by side, so a
    // share with little in it costs one round trip: with the functions in us-central1 and the database in
    // europe-central2, read one after another, a few hundred owners took the whole reading's time (review,
    // 29.10.2026). A reminder's recipients stay on its event, so naming people spends nobody's share. No new
    // index: (ownerId, date), (groupId, date) and (recurrenceRule.frequency, date) serve every shape, measured
    // on live that day.
    const fromDay = dayString(now - 2 * 86400000);
    const toDay = dayString(now + MAX_LEAD_DAYS * 86400000);
    const byId = new Map();
    const keep = (d) => {
        const c = (0, remindersCore_1.compactEvent)(d.id, d.data(), fromDay, toDay);
        if (c)
            byId.set(d.id, c);
        else
            counts.skipped += 1;
    };
    const events = db.collection("events");
    const inShare = (s) => s.kind === "group"
        ? events.where("groupId", "==", s.key)
        : events.where("ownerId", "==", s.key).where("groupId", "==", null);
    const dated = (s) => inShare(s)
        .where("date", ">=", `${fromDay}T00:00:00.000Z`)
        .where("date", "<=", `${toDay}T23:59:59.999Z`)
        .select(...remindersCore_1.REMINDER_FIELDS);
    // One frequency a range (`in` of one, the shape measured on live), each from its own reach back.
    const series = (s, freq) => inShare(s)
        .where("recurrenceRule.frequency", "in", [freq])
        .where("date", ">=", seriesFrom(fromDay, freq))
        .where("date", "<=", `${toDay}T23:59:59.999Z`)
        .select(...remindersCore_1.REMINDER_FIELDS);
    // When a range's index is missing, or still being built (it throws rather than returning less): every
    // series of the share, however old, as before 16.10.2026, by equalities alone, and the run says so.
    const allSeries = (s) => inShare(s)
        .where("recurrenceRule.frequency", "in", [...recurrenceServer_1.FREQUENCIES])
        .select(...remindersCore_1.REMINDER_FIELDS);
    // ── the shares ──
    const scanEnd = clock() + scanBudgetMs;
    const scanOutOfTime = () => clock() >= scanEnd;
    const [owners, groups] = await Promise.all([
        findKeys(events, "ownerId", maxOwners, scanOutOfTime),
        findKeys(events, "groupId", maxOwners, scanOutOfTime),
    ]);
    counts.owners = owners.keys.length;
    counts.groups = groups.keys.length;
    let cut = (owners.cut ? 1 : 0) + (groups.cut ? 1 : 0);
    const shares = [
        ...owners.keys.map((key) => ({ kind: "owner", key })),
        ...groups.keys.map((key) => ({ kind: "group", key })),
    ];
    // ── the reads ──
    // The whole reading's deadline, every share's, from here: the scan had its own time.
    const readsEnd = clock() + readsDeadlineMs;
    const outOfTime = () => clock() >= readsEnd;
    const cursor = (base) => ({ base, last: null, here: new Set(), done: false });
    const newRead = (ms, bases, fallback) => ({ queries: bases.map(cursor), seen: new Set(), spent: 0, state: "more", fallback, ms });
    /**
     * Reads on from where `read` stopped, its queries side by side, until each is done, the read is cut, or it
     * has taken `share` events this turn. One time and one cap for all of a read's queries and both its turns,
     * the fallback included (review, 17.10.2026: a refusal after a page started it over, counting twice, with
     * a second budget and a second cap).
     */
    const readOn = async (read, share) => {
        const started = clock() - read.spent;
        const t0 = Date.now();
        let taken = 0;
        let stop = null;
        let refused = false;
        const errors = [];
        const run = async (q) => {
            while (!q.done && stop === null) {
                const t = clock();
                if (t - started >= budgetMs || t >= readsEnd) {
                    stop = "cut";
                    return;
                }
                if (taken >= share) {
                    stop = "more";
                    return;
                }
                // One past the cap, to tell "exactly the cap" from "more than it".
                const want = Math.min(page, maxCandidates + 1 - read.seen.size);
                let snap;
                try {
                    snap = await (q.last ? q.base.startAfter(q.last) : q.base).limit(want).get();
                }
                catch (err) {
                    if (read.fallback && missingIndex(err))
                        refused = true;
                    else
                        errors.push(err);
                    return;
                }
                let fresh = 0;
                for (const d of snap.docs) {
                    // A cursor on a value longer than Firestore indexes (1500 bytes) can repeat a page.
                    if (q.here.has(d.id))
                        continue;
                    q.here.add(d.id);
                    fresh += 1;
                    // Read already by another query of this read (or before a fallback): once, and counted once.
                    if (read.seen.has(d.id))
                        continue;
                    if (read.seen.size >= maxCandidates) {
                        stop = "cut";
                        return;
                    }
                    read.seen.add(d.id);
                    taken += 1;
                    counts.read += 1;
                    keep(d);
                }
                if (snap.size < want) {
                    q.done = true;
                    return;
                }
                // A full page with nothing new would be read again for ever: stop, and say so.
                if (fresh === 0) {
                    stop = "cut";
                    return;
                }
                q.last = snap.docs[snap.docs.length - 1];
            }
        };
        try {
            for (;;) {
                await Promise.all(read.queries.map(run));
                if (errors.length > 0)
                    throw errors[0];
                if (!refused || !read.fallback)
                    break;
                // A range refused, perhaps after a page: the fallback goes on with this read's time, cap and count.
                counts.seriesUnbounded = 1;
                read.queries = [cursor(read.fallback)];
                read.fallback = undefined;
                refused = false;
            }
            read.state = stop !== null && stop !== void 0 ? stop : (read.queries.every((q) => q.done) ? "done" : "more");
        }
        finally {
            read.spent = clock() - started;
            counts[read.ms] += Date.now() - t0;
        }
    };
    const reads = new Map(shares.map((s) => [s, [
            newRead("datedMs", [dated(s)]),
            newRead("seriesMs", recurrenceServer_1.FREQUENCIES.map((f) => series(s, f)), allSeries(s)),
        ]]));
    /** A share's turn: its reads that have more, side by side, each to `share` events. */
    const turn = async (s, share) => {
        var _a;
        const open = ((_a = reads.get(s)) !== null && _a !== void 0 ? _a : []).filter((r) => r.state === "more");
        if (open.length === 0)
            return;
        if (outOfTime()) {
            for (const r of open)
                r.state = "cut";
            return;
        }
        await Promise.all(open.map((r) => readOn(r, share)));
    };
    const pool = async (list, share) => {
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
            while (next < list.length)
                await turn(list[next++], share);
        }));
    };
    const queue = ownerTurn(shares, now);
    await pool(queue, firstShare);
    await pool(queue.filter((s) => { var _a; return ((_a = reads.get(s)) !== null && _a !== void 0 ? _a : []).some((r) => r.state === "more"); }), Number.POSITIVE_INFINITY);
    for (const s of shares)
        if (((_l = reads.get(s)) !== null && _l !== void 0 ? _l : []).some((r) => r.state !== "done"))
            cut += 1;
    counts.cut = cut;
    const docs = [...byId.values()];
    counts.candidates = docs.length;
    if (docs.length === 0)
        return;
    const occurrences = (0, recurrenceServer_1.expandInWindow)(docs, fromDay, toDay)
        .map((o) => ({ source: o.source, day: o.day }));
    // Owners' zones, for the events that need them: a reminder, and no zone of their own. Only that
    // field, in chunks, every owner (it stopped at 400 owners, and read the whole profile).
    const needZone = [...new Set(docs
            .filter((d) => typeof d.reminderMinutes === "number" && d.reminderMinutes >= 0 && !(0, eventTime_1.isValidZone)(d.timezone))
            .map((d) => (typeof d.ownerId === "string" ? d.ownerId : ""))
            .filter(Boolean))];
    const ownerZones = {};
    for (let i = 0; i < needZone.length; i += ZONE_CHUNK) {
        const ids = needZone.slice(i, i + ZONE_CHUNK);
        const snaps = await db.getAll(...ids.map((u) => db.doc(`users/${u}`)), { fieldMask: ["timezone"] });
        snaps.forEach((s, j) => {
            const zone = s.get("timezone");
            if (typeof zone === "string" && zone.length <= 64)
                ownerZones[ids[j]] = zone;
        });
    }
    const due = (0, remindersCore_1.dueIn)(occurrences, ownerZones, from, now);
    counts.occurrences = occurrences.length;
    counts.due = due.length;
    if (due.length === 0)
        return;
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
    const pending = [];
    for (let i = 0; i < due.length; i += LOG_CHUNK) {
        const chunk = due.slice(i, i + LOG_CHUNK);
        let rows;
        try {
            rows = await db.getAll(...chunk.map((d) => db.doc(`reminder_log/${d.key}`)), { fieldMask: ["state"] });
        }
        catch (err) {
            console.error("reminder: could not read the dedupe rows; each is claimed instead", err);
            pending.push(...chunk);
            continue;
        }
        rows.forEach((row, j) => {
            if (row.exists && row.get("state") !== "sending")
                counts.dupes += 1;
            else
                pending.push(chunk[j]);
        });
    }
    const { order, lastChance } = (0, remindersCore_1.sendOrder)(pending, now, WINDOW_MS, exports.RUN_EVERY_MS, exports.LATE_RUN_SLACK_MS);
    /** "send" when this run owns the reminder now; "skip" when another run has it, or had it delivered. */
    const claim = async (d) => {
        const logRef = db.doc(`reminder_log/${d.key}`);
        // This claim's own mark, written with it. The SDK resends a write whose answer was lost: the
        // `create` on UNAVAILABLE, the whole transaction below on INTERNAL or DEADLINE_EXCEEDED. When the
        // first attempt had been applied, the resend meets this claim's own row, which without the mark
        // reads as another run's: not sent, counted "already sent", and lost on its last run. (Review,
        // 17.10.2026.) One per claim, not per run, so that only a resend of this very write matches it.
        const claimId = crypto.randomUUID();
        try {
            // `runAt`: when this run started, which is what a later run judges the claim by (STALE_CLAIM_MS).
            await logRef.create({ eventId: d.eventId, day: d.day, at: d.at, state: "sending", claimedAt: firestore_1.FieldValue.serverTimestamp(), runAt: now, claimId });
            return "send";
        }
        catch (err) {
            // Only ALREADY_EXISTS means the row is there: another run's, or this claim's own, resent.
            // Counting every rejection as a dupe would have made a transient UNAVAILABLE read as "somebody
            // else delivered it". (Review finding.)
            if (!alreadyExists(err))
                throw err;
        }
        // A row made before 13.10 has no state: it was sent. A claim made before 17.10 has no `claimId`
        // (never this one's) and no `runAt` (judged by when it was made, which is later than its run's start).
        let tookOver = false;
        const taken = await db.runTransaction(async (tx) => {
            const row = (await tx.get(logRef)).data();
            if (!row || row.state !== "sending")
                return false;
            if (row.claimId === claimId)
                return true;
            if (Date.now() - claimRunStart(row) < exports.STALE_CLAIM_MS)
                return false;
            // `runAt` moves with the claim: left as it was, a second run would read the claim this one has
            // just taken as still stale, and send it too.
            tx.update(logRef, { claimedAt: firestore_1.FieldValue.serverTimestamp(), runAt: now, claimId, retries: firestore_1.FieldValue.increment(1) });
            tookOver = true;
            return true;
        });
        if (!taken)
            return "skip";
        // Taken over from an earlier run, by this attempt or by one whose commit was applied unanswered.
        if (tookOver)
            counts.retried += 1;
        return "send";
    };
    for (const d of order) {
        if (clock() - sendStarted >= sendBudgetMs) {
            if (lastChance.has(d.key)) {
                counts.dropped += 1;
                console.error("reminder: out of time on its last run", d.key);
            }
            else {
                counts.deferred += 1;
            }
            continue;
        }
        let owned;
        try {
            owned = await claim(d);
        }
        catch (err) {
            counts.failed += 1;
            console.error("reminder: dedupe write failed", d.key, err);
            continue;
        }
        if (owned === "skip") {
            counts.dupes += 1;
            continue;
        }
        try {
            const delivered = await (0, notify_1.notify)({
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
        }
        catch (err) {
            // The claim stays "sending": a later run that still sees the reminder tries again. The bell rows
            // may be written already (their commit applied, then answered with DEADLINE_EXCEEDED or INTERNAL,
            // which the SDK does not retry); the retry rewrites them. No push went out: it follows the rows.
            counts.failed += 1;
            console.error("reminder: could not deliver", d.key, err);
            continue;
        }
        try {
            await db.doc(`reminder_log/${d.key}`).update({ state: "sent", sentAt: firestore_1.FieldValue.serverTimestamp() });
        }
        catch (err) {
            // Delivered; only the mark is missing, so a later run may send it again. Said, not counted.
            console.error("reminder: delivered but not marked sent", d.key, err);
        }
    }
}
exports.sendDueReminders = (0, scheduler_1.onSchedule)(
// Cron, not "every 5 minutes": that form restarts its count at every deploy (jobHealthCore.ts).
// Time and memory stated, not the platform's 60 s and 256 MiB: the read alone may take up to
// 2 × READ_BUDGET_MS, and the sending follows it. Under a fifth of jobHealthCore's STUCK_MS, so a
// run still inside its time never reads as stuck (jobRuns.test.ts holds the two together).
{ schedule: "*/5 * * * *", timeZone: "UTC", retryCount: 0, timeoutSeconds: 150, memory: "512MiB" }, () => (0, jobRuns_1.runJob)("sendDueReminders", async () => {
    const db = admin.firestore();
    const now = Date.now();
    // One line per run, whatever the run did. Until now this function wrote NOTHING — every
    // execution was an empty log line — so "did it find anything?" had no answer short of
    // reading the database. Same shape as ERROR_DIGEST: a fixed prefix and one JSON object, so it
    // can be grepped and parsed by the same means.
    const counts = (0, exports.emptyCounts)();
    // Everything below sits in a try so that the finally can keep the promise made above: one
    // REMINDERS_RUN line per run, whatever the run did — including a run that delivered three
    // reminders and then died in housekeeping. Without this, a throw anywhere lost the line and
    // the counters with it. (Review finding.)
    try {
        await remindDue(db, now, counts);
        // ── housekeeping ────────────────────────────────────────────────────────
        // Every run, also a quiet one (since 12.10; it ran only when something was due, so with nothing
        // due for weeks the old rows stayed).
        const cutoff = dayString(now - LOG_TTL_DAYS * 86400000);
        const stale = await db.collection("reminder_log").where("day", "<", cutoff).limit(400).get();
        if (!stale.empty) {
            const batch = db.batch();
            stale.docs.forEach((s) => batch.delete(s.ref));
            await batch.commit();
        }
        // The same counters, for the health panel. `failed` decides whether the run was ok: a run whose
        // every reminder failed to send is not a green run, and neither is one that stopped reading.
        return reminderOutcome(counts);
    }
    finally {
        console.log("REMINDERS_RUN " + JSON.stringify(Object.assign({ at: new Date(now).toISOString() }, counts)));
    }
}));
//# sourceMappingURL=reminders.js.map