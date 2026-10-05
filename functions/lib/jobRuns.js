"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.markJobStart = markJobStart;
exports.markJobRun = markJobRun;
exports.finishJob = finishJob;
exports.failJob = failJob;
exports.runJob = runJob;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const errorLog_1 = require("./errorLog");
const markerRef = (name) => admin.firestore().doc(`jobRuns/${name}`);
/** The job's first write. MERGE: the last run that ended stays readable while this one runs. */
async function markJobStart(name) {
    try {
        await markerRef(name).set({ startedAt: Date.now(), startsSinceEnd: firestore_1.FieldValue.increment(1) }, { merge: true });
    }
    catch ( /* the job's work comes first */_a) { /* the job's work comes first */ }
}
/**
 * The end of a run: REPLACES the document, so `startedAt`, `startsSinceEnd` and `firstMissingAt` go.
 * `failStreak` counts failed runs in a row; its read is best-effort, and when it fails the streak
 * restarts at 1 — never at 0, which would turn a failure green.
 */
async function markJobRun(name, ok, detail) {
    try {
        let failStreak = 0;
        if (!ok) {
            let prev = {};
            try {
                prev = (await markerRef(name).get()).data() || {};
            }
            catch (_a) {
                prev = {};
            }
            const n = Number(prev.failStreak);
            failStreak = (prev.ok === false ? (Number.isFinite(n) && n > 0 ? Math.floor(n) : 1) : 0) + 1;
        }
        await markerRef(name).set({ at: Date.now(), ok, detail: String(detail || "").slice(0, 200), failStreak });
    }
    catch ( /* the job's work comes first */_b) { /* the job's work comes first */ }
}
/**
 * A run that ended without throwing. `ok` only if no item failed. A run with failures also leaves
 * ONE row in errorLogs — the count and the summary, not a row per item — so the panel's grouping has
 * something to show and a failure that repeats every five minutes stays one problem.
 */
async function finishJob(name, outcome) {
    const failed = Number.isFinite(outcome === null || outcome === void 0 ? void 0 : outcome.failed) && outcome.failed > 0 ? Math.floor(outcome.failed) : 0;
    const detail = String((outcome === null || outcome === void 0 ? void 0 : outcome.detail) || "");
    if (failed > 0)
        await (0, errorLog_1.logServerError)(`${name}: a run ended with failures (${detail})`, `job:${name}`);
    await markJobRun(name, failed === 0, detail);
}
/** A run that threw: into errorLogs (a console.error alone reaches nobody) and marked not ok. */
async function failJob(name, err) {
    const e = err;
    const message = String((e && e.message) || err || "job failed");
    await (0, errorLog_1.logServerError)(`${name}: ${message}`, `job:${name}`, { stack: e === null || e === void 0 ? void 0 : e.stack });
    await markJobRun(name, false, message.slice(0, 120));
}
/**
 * THE wrapper for every `onSchedule` handler: start marker, the job, end marker. A job that throws is
 * marked and re-thrown, so the platform still records the failure too. The parity test holds every
 * scheduled export to calling this with its own name.
 */
async function runJob(name, body) {
    await markJobStart(name);
    let outcome;
    try {
        outcome = await body();
    }
    catch (err) {
        await failJob(name, err);
        throw err;
    }
    await finishJob(name, outcome);
}
//# sourceMappingURL=jobRuns.js.map