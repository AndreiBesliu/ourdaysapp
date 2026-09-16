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
exports.expireIdleGames = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const gameSession_1 = require("./gameSession");
/**
 * How many to close per run.
 *
 * There is a backlog: every game ever abandoned is, by definition, idle, and the first runs will
 * work through all of them. A cap drains it over hours instead of rewriting the whole collection
 * in one transaction, and keeps a single run's cost bounded forever after.
 */
const PER_RUN = 200;
/**
 * How many documents one run will look at.
 *
 * The whole collection, deliberately, rather than a status filter. `status: 'finished'` in this
 * schema means the ROUND is over — the round-loop games set it at the end of every round and
 * "Next Round" sets it back — so filtering it out made the sweep blind to the commonest abandoned
 * state of all, and one of the eighteen games on live was sitting in it. There is no filter that
 * selects "not finalized" either: the field is absent on every document made before today, and
 * Firestore drops documents missing a field from an inequality.
 *
 * Eighteen documents today. If this ever saturates, the run says so out loud rather than looking
 * like a clean sweep.
 */
const SCAN_LIMIT = 2000;
exports.expireIdleGames = (0, scheduler_1.onSchedule)({ schedule: "every 60 minutes", timeZone: "UTC", retryCount: 0 }, async () => {
    const db = admin.firestore();
    const now = Date.now();
    // One line per run, whatever the run did — same shape as REMINDERS_RUN and ERROR_DIGEST, so
    // the same grep finds it. `skipped` is broken down by reason: a sweep that only reports what
    // it closed cannot be told apart from one that is silently skipping everything.
    const counts = { scanned: 0, due: 0, closed: 0, raced: 0, failed: 0, saturated: 0 };
    const skipped = {};
    const done = () => {
        console.log("GAMES_EXPIRY_RUN " + JSON.stringify(Object.assign(Object.assign({ at: new Date(now).toISOString(), idleHours: gameSession_1.IDLE_MS / 3600000 }, counts), { skipped })));
    };
    try {
        const snap = await db.collection("games").limit(SCAN_LIMIT).get();
        counts.scanned = snap.size;
        // Saturation is reported, not assumed away: at the limit, documents beyond it were never
        // looked at, and a run that says "closed 0" while blind to half the collection reads
        // exactly like a run that found nothing to do.
        counts.saturated = snap.size >= SCAN_LIMIT ? 1 : 0;
        const due = [];
        for (const d of snap.docs) {
            const refusal = (0, gameSession_1.expiryRefusal)(Object.assign({ id: d.id }, d.data()), now);
            if (refusal === null)
                due.push(d);
            else
                skipped[refusal] = (skipped[refusal] || 0) + 1;
        }
        counts.due = due.length;
        for (const d of due.slice(0, PER_RUN)) {
            const game = Object.assign({ id: d.id }, d.data());
            try {
                // A guarded write rather than a blind one: between the read above and here, somebody
                // may have made a move or pressed End, and the condition is re-asked inside the
                // transaction against the document as it stands now.
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
                    tx.update(d.ref, Object.assign(Object.assign({}, (0, gameSession_1.closedSessionFields)(Object.assign({ id: fresh.id }, data), true)), { endedAt: admin.firestore.FieldValue.serverTimestamp() }));
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
                    gameId: d.id, gameType: game.gameType, error: err instanceof Error ? err.message : String(err),
                }));
            }
        }
        if (due.length > PER_RUN) {
            // Said out loud rather than left implicit: a silent cap reads as "everything is handled".
            // The number reported is what was ATTEMPTED, not the constant — `closed` in the run line
            // is what actually landed.
            console.log("GAMES_EXPIRY_BACKLOG " + JSON.stringify({
                due: due.length, attemptedThisRun: PER_RUN, remaining: due.length - PER_RUN,
            }));
        }
    }
    finally {
        // The promise above is one line per run, including a run that closed three games and then
        // died in the fourth — the same reason sendDueReminders wraps its counters in a finally.
        done();
    }
});
//# sourceMappingURL=games.js.map