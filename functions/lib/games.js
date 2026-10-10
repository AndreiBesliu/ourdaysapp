"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireIdleGames = exports.SWEEP_STATE_DOC = exports.MAX_LAP_RUNS = exports.TIME_BUDGET_MS = exports.SCAN_WINDOW = exports.PER_RUN = void 0;
exports.sweepIdleGames = sweepIdleGames;
exports.sweepDetail = sweepDetail;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const gameSession_1 = require("./gameSession");
const jobRuns_1 = require("./jobRuns");
/**
 * How many idle games one run tries to close.
 *
 * There is a backlog: every game ever abandoned is, by definition, idle, and the first runs work
 * through all of them. A cap drains it over hours instead of rewriting the whole collection at once,
 * and keeps a single run's cost bounded forever after. The games past the cap are NOT passed over:
 * the run stops in front of the first one it did not try, and the next run starts there.
 */
exports.PER_RUN = 200;
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
exports.SCAN_WINDOW = 2000;
/**
 * Documents per query within the window. Small on purpose: a document can be a megabyte, and the
 * verdict's own fields (`lastMoveAt`, `date`, `finalized`) are not typed by the rules yet, so one page
 * of padded games must not be able to run the function out of memory (review of 10.10.2026).
 */
const PAGE = 50;
/**
 * How long one run keeps trying to close games. It stops in front of the next idle game when the time
 * is up, as at the cap, so a run that a heavy window slows down ends with its work saved instead of
 * being cut off by the function's own timeout at the same place every hour.
 */
exports.TIME_BUDGET_MS = 40000;
/**
 * A full turn of the collection taking more runs than this — a day of hourly runs — means an idle
 * game can wait a day past its 24 hours before it is closed. Every run then counts as not ok, until a
 * turn ends within it again: a slow turn must not look like a clean one.
 */
exports.MAX_LAP_RUNS = 24;
/** Where the window stops between runs. No rule matches `jobState`, so no client reads or writes it. */
exports.SWEEP_STATE_DOC = "jobState/expireIdleGames";
/**
 * The fields the expiry verdict reads (`expiryRefusal`), and the only ones the window reads. A game
 * padded to a megabyte costs the window nothing; only a game that is due is read whole, one at a time,
 * inside the transaction that closes it.
 */
const VERDICT_FIELDS = ["gameType", "finalized", "lastMoveAt", "createdAt", "date"];
const wholeRuns = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
/**
 * Read on from the cursor, closing the idle games met on the way, in id order. The cursor is saved
 * after every page, and — when the cap or the time budget stops the run — just behind the first idle
 * game it did not try, so nothing is passed over and a run that dies costs one page at most.
 * `counts` and `skipped` are filled as the run goes, so a run that dies half way still reports.
 */
async function sweepIdleGames(db, now, counts, skipped, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const window = (_a = opts.window) !== null && _a !== void 0 ? _a : exports.SCAN_WINDOW;
    const page = (_b = opts.page) !== null && _b !== void 0 ? _b : PAGE;
    const perRun = (_c = opts.perRun) !== null && _c !== void 0 ? _c : exports.PER_RUN;
    const timeBudgetMs = (_d = opts.timeBudgetMs) !== null && _d !== void 0 ? _d : exports.TIME_BUDGET_MS;
    const maxLapRuns = (_e = opts.maxLapRuns) !== null && _e !== void 0 ? _e : exports.MAX_LAP_RUNS;
    const clock = (_f = opts.clock) !== null && _f !== void 0 ? _f : Date.now;
    const started = clock();
    const stateRef = db.doc(exports.SWEEP_STATE_DOC);
    const prev = (_g = (await stateRef.get()).data()) !== null && _g !== void 0 ? _g : {};
    const startedAfter = typeof prev.after === "string" && prev.after ? prev.after : null;
    const lapRunsBefore = wholeRuns(prev.lapRuns);
    const lastLapBefore = prev.lastLapRuns == null ? null : wholeRuns(prev.lastLapRuns);
    let after = startedAfter;
    // From the cursor to the end of the collection ("tail"), then — only when this run began part of
    // the way through — from the start up to the cursor ("head"), never past it: a window larger than
    // the collection reads every game once, not some of them twice.
    let phase = "tail";
    let completedLap = false;
    const lapRuns = () => (completedLap ? 0 : lapRunsBefore + 1);
    const lastLapRuns = () => (completedLap ? lapRunsBefore + 1 : lastLapBefore);
    const save = () => stateRef.set({ after, lapRuns: lapRuns(), lastLapRuns: lastLapRuns(), at: Date.now() });
    // Progress on the way is best-effort: the write at the end is the one that counts, and reports.
    const saveOnTheWay = async () => { try {
        await save();
    }
    catch ( /* the end writes it again */_a) { /* the end writes it again */ } };
    let attempted = 0;
    pages: while (counts.scanned < window) {
        // Out of time between pages too, once anything was read: a slow window ends with its work saved.
        if (counts.scanned > 0 && clock() - started >= timeBudgetMs) {
            counts.cut = 1;
            break;
        }
        const want = Math.min(page, window - counts.scanned);
        let q = db.collection("games").orderBy(firestore_1.FieldPath.documentId()).select(...VERDICT_FIELDS).limit(want);
        if (after !== null)
            q = q.startAfter(after);
        if (phase === "head" && startedAfter !== null)
            q = q.endAt(startedAfter);
        const snap = await q.get();
        counts.scanned += snap.size;
        for (const d of snap.docs) {
            const refusal = (0, gameSession_1.expiryRefusal)(Object.assign({ id: d.id }, d.data()), now);
            if (refusal !== null) {
                skipped[refusal] = (skipped[refusal] || 0) + 1;
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
                    if (!data)
                        return false;
                    if ((0, gameSession_1.expiryRefusal)(Object.assign({ id: fresh.id }, data), Date.now()) !== null)
                        return false;
                    tx.update(d.ref, Object.assign(Object.assign({}, (0, gameSession_1.closedSessionFields)(Object.assign({ id: fresh.id }, data), true)), { endedAt: firestore_1.FieldValue.serverTimestamp() }));
                    return true;
                });
                if (wrote)
                    counts.closed += 1;
                else
                    counts.raced += 1;
            }
            catch (err) {
                counts.failed += 1;
                console.error("GAMES_EXPIRY_FAIL " + JSON.stringify({
                    gameId: d.id, error: err instanceof Error ? err.message : String(err),
                }));
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
            }
            else {
                // Back at where this run began: every game has been read in this one run.
                after = null;
            }
            break;
        }
        await saveOnTheWay();
    }
    // The cursor once more at the end (also when the cap stopped the run mid-page). A run that dies
    // before this repeats at most the page it died in, never skips a game; a failed write is counted.
    try {
        await save();
    }
    catch (err) {
        counts.failed += 1;
        console.error("GAMES_EXPIRY_FAIL " + JSON.stringify({
            state: exports.SWEEP_STATE_DOC, error: err instanceof Error ? err.message : String(err),
        }));
    }
    // Slow while this turn has already taken too long, AND until a turn ends within the limit again:
    // judging only where this run sits in the turn left most runs of an always-slow sweep green.
    counts.slowLap = Math.max(lapRunsBefore + 1, (_h = lastLapRuns()) !== null && _h !== void 0 ? _h : 0) > maxLapRuns ? 1 : 0;
    return { lapRuns: lapRuns(), lastLapRuns: lastLapRuns() };
}
/** The run's line for the health panel: the same words every run, only the numbers change, so one
 *  recurring problem stays one group in the error log (errorGrouping.ts drops digits, not words). */
function sweepDetail(c, r) {
    var _a;
    return `scanned ${c.scanned}, idle ${c.due}, closed ${c.closed}, failed ${c.failed}, `
        + `turn ${r.lapRuns}/${(_a = r.lastLapRuns) !== null && _a !== void 0 ? _a : 0} (limit ${exports.MAX_LAP_RUNS}), stopped early ${c.cut}`;
}
exports.expireIdleGames = (0, scheduler_1.onSchedule)(
// Cron, not "every 60 minutes": that form restarts its count at every deploy (jobHealthCore.ts).
{ schedule: "0 * * * *", timeZone: "UTC", retryCount: 0 }, () => (0, jobRuns_1.runJob)("expireIdleGames", async () => {
    const db = admin.firestore();
    const now = Date.now();
    // One line per run, whatever the run did — same shape as REMINDERS_RUN and ERROR_DIGEST, so
    // the same grep finds it. `skipped` is broken down by reason: a sweep that only reports what
    // it closed cannot be told apart from one that is silently skipping everything.
    const counts = { scanned: 0, due: 0, closed: 0, raced: 0, failed: 0, slowLap: 0, cut: 0 };
    const skipped = {};
    let turn = null;
    const done = () => {
        console.log("GAMES_EXPIRY_RUN " + JSON.stringify(Object.assign(Object.assign({ at: new Date(now).toISOString(), idleHours: gameSession_1.IDLE_MS / 3600000 }, counts), { skipped, turn })));
    };
    try {
        turn = await sweepIdleGames(db, now, counts, skipped);
        // For the health panel. A slow turn counts against the run: an idle game may be waiting a day
        // past its 24 hours, and "closed 0" from a slow turn must not read as a clean one.
        const outcome = { failed: counts.failed + counts.slowLap, detail: sweepDetail(counts, turn) };
        return outcome;
    }
    finally {
        // The promise above is one line per run, including a run that closed three games and then
        // died in the fourth — the same reason sendDueReminders wraps its counters in a finally.
        done();
    }
}));
//# sourceMappingURL=games.js.map