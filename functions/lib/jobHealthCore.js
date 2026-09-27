"use strict";
// functions/src/jobHealthCore.ts
//
// Are the scheduled jobs actually RUNNING? Pure: no Firebase, tested directly
// (src/utils/jobHealth.test.ts). The writes live in jobRuns.ts, the reading in `adminGetHealth`.
//
// ── Why this exists ─────────────────────────────────────────────────────────────────────────
//
// A job that throws can be logged. A job that never STARTS produces nothing at all — a Cloud
// Scheduler entry deleted or paused, a deploy that did not create it — and that looks exactly like
// a job that runs fine. Reminders are the one feature here that works while nobody has the app open,
// so a stopped reminder job is invisible to everybody until somebody notices a reminder that never
// came. Andrei's rule for every project (11.07.2026): error monitoring AND a health view. Presto and
// DataRead got this on 25–26.09.2026; this is the same pattern, with the traps they paid for:
//
//   * `startedAt` and `startsSinceEnd` (merge, an atomic increment) are the job's first write, and
//     `{ at, ok, detail, failStreak }` REPLACES the document when it ends. A job killed by its
//     timeout never reaches its catch, so without the start marker it looked like a job that never
//     started — and the hint blamed the schedule;
//   * "never ran" gets an age: `firstMissingAt`, stamped by the health check the first time it finds
//     no document. Without it, a deploy that never created the schedule read "normal right after the
//     first deploy" for ever — precisely the case this is for;
//   * `ok` only when the job did its job: items that failed are COUNTED and make the run not ok. A
//     job whose every item fails is not a green job;
//   * a failure that repeats is red: `failStreak` counts failures in a row, and the second one in a
//     row is no longer "maybe transient";
//   * one type in the time fields: every marker is written by the server, as epoch milliseconds.
//
// ── Every schedule is unix-cron (27.09.2026) ─────────────────────────────────────────────────
//
// "every 6 hours" counts its six hours from the last time the Cloud Scheduler job was UPDATED, and
// every functions deploy updates it. Measured on 27.09: the error digest ran at 03:48, the deploy at
// 08:45 moved its next run to 14:45 — eleven hours with no digest. A cron expression names the
// minutes of the day, so a deploy changes nothing. `cronMinutes` reads only cron, so a job declared
// the other way fails the parity test instead of being judged against a clock it does not keep.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERRORS_HINT = exports.LOGS_HINT = exports.SCHEDULER_HINT = exports.STARTS_WITHOUT_END_FAIL = exports.FAIL_STREAK_FAIL = exports.STUCK_MS = exports.DEAD_FACTOR = exports.LATE_FACTOR = exports.JOB_SCHEDULE = void 0;
exports.cronMinutes = cronMinutes;
exports.coerceMarker = coerceMarker;
exports.fmtAgo = fmtAgo;
exports.fmtEvery = fmtEvery;
exports.jobHealthChecks = jobHealthChecks;
exports.jobsNeedingMissingStamp = jobsNeedingMissingStamp;
/**
 * Every scheduled job, with how often it runs. MUST mirror the `onSchedule` exports: the parity test
 * reads them from the source and fails on any difference in name or interval, so a new job cannot
 * stay out of the panel.
 */
exports.JOB_SCHEDULE = [
    { name: "sendDueReminders", everyMinutes: 5, label: "Event reminders" },
    { name: "expireIdleGames", everyMinutes: 60, label: "Idle arcade sessions" },
    { name: "logErrorDigest", everyMinutes: 360, label: "Error digest (function logs)" },
];
/** Late past 1.5× the interval, stopped past 3× — the tolerance Presto and DataRead use. */
exports.LATE_FACTOR = 1.5;
exports.DEAD_FACTOR = 3;
/**
 * A start this old with no end after it was killed (timeout, memory). Every job runs with the
 * platform's 60 s timeout; this must stay well above the longest one, or a run still in progress
 * would read as stuck. The parity test holds it against each job's real timeout.
 */
exports.STUCK_MS = 15 * 60 * 1000;
/** Failures in a row from which a failed run is a fault (red), not a possible accident (amber). */
exports.FAIL_STREAK_FAIL = 2;
/**
 * Starts in a row with no end, from which the job is killed rather than slow. `STUCK_MS` alone cannot
 * see this for a job that runs every five minutes: each new start refreshes `startedAt` before it
 * could age, so a reminder job killed on every run would have read "running for the first time" for
 * ever. The count survives the refresh; an end resets it.
 */
exports.STARTS_WITHOUT_END_FAIL = 3;
/**
 * Minutes between runs for the cron forms these jobs use, or null for anything else:
 *   `*\/N * * * *`  every N minutes (N divides 60)
 *   `M * * * *`     every hour, at minute M
 *   `M *\/N * * *`  every N hours (N divides 24), at minute M
 *   `M H * * *`     every day
 * A form that does not divide the hour or the day evenly has no single interval, and is refused.
 */
function cronMinutes(expr) {
    const f = String(expr !== null && expr !== void 0 ? expr : "").trim().split(/\s+/);
    if (f.length !== 5 || f[2] !== "*" || f[3] !== "*" || f[4] !== "*")
        return null;
    const [min, hour] = f;
    const minuteOf = (s) => (/^\d{1,2}$/.test(s) && Number(s) < 60 ? Number(s) : null);
    const step = /^\*\/(\d{1,2})$/;
    const m = step.exec(min);
    if (m) {
        const n = Number(m[1]);
        return hour === "*" && n > 0 && 60 % n === 0 ? n : null;
    }
    if (minuteOf(min) === null)
        return null;
    if (hour === "*")
        return 60;
    const h = step.exec(hour);
    if (h) {
        const n = Number(h[1]);
        return n > 0 && 24 % n === 0 ? n * 60 : null;
    }
    return /^\d{1,2}$/.test(hour) && Number(hour) < 24 ? 1440 : null;
}
/** Any stored value — a document, garbage, nothing — as a marker. Pure. */
function coerceMarker(v) {
    const o = v && typeof v === "object" ? v : {};
    const n = (x) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
    return {
        at: n(o.at),
        ok: o.ok !== false,
        detail: typeof o.detail === "string" ? o.detail.slice(0, 200) : "",
        startedAt: n(o.startedAt),
        startsSinceEnd: Math.floor(n(o.startsSinceEnd)),
        firstMissingAt: n(o.firstMissingAt),
        failStreak: Math.floor(n(o.failStreak)),
    };
}
/** "4 min", "3 h", "2 days". */
function fmtAgo(ms) {
    const m = Math.max(0, ms) / 60000;
    if (m < 90)
        return `${Math.round(m)} min`;
    if (m < 48 * 60)
        return `${Math.round(m / 60)} h`;
    return `${Math.round(m / 1440)} days`;
}
/** "5 min", "hour", "6 hours", "day". */
function fmtEvery(minutes) {
    if (minutes % 1440 === 0)
        return minutes === 1440 ? "day" : `${minutes / 1440} days`;
    if (minutes % 60 === 0)
        return minutes === 60 ? "hour" : `${minutes / 60} hours`;
    return `${minutes} min`;
}
exports.SCHEDULER_HINT = "Check in Google Cloud → Cloud Scheduler that the job exists and is not paused.";
exports.LOGS_HINT = "It starts but does not finish — probably a timeout or a crash. Read its logs in Cloud Logging.";
exports.ERRORS_HINT = "Details under Distinct problems below, context job:";
/**
 * One line per scheduled job. The rule of the whole panel: no fact, no green tick. Order:
 *   1. a start with no end after it — killed if the start is old, still running if it is recent;
 *   2. no run has ever ended — "not yet" only while that is plausible, then late, then stopped;
 *   3. the age of the last run that ended — a job that stopped is worse than one that failed once;
 *   4. how that run went.
 */
function jobHealthChecks(markers, nowMs) {
    const src = markers && typeof markers === "object" ? markers : {};
    return exports.JOB_SCHEDULE.map((j) => {
        const m = coerceMarker(src[j.name]);
        const every = j.everyMinutes * 60000;
        const line = (status, message, hint = "") => ({
            name: j.name, label: j.label, everyMinutes: j.everyMinutes, status, message, hint,
            lastRunAt: m.at || null, failStreak: m.failStreak,
        });
        const sinceAt = nowMs - m.at;
        if (m.startedAt > m.at) {
            // Started, and nothing has ended since.
            if (nowMs - m.startedAt > exports.STUCK_MS) {
                const neverEnded = !m.at || sinceAt > every * exports.DEAD_FACTOR;
                return line(neverEnded ? "fail" : "warn", `Started ${fmtAgo(nowMs - m.startedAt)} ago and never finished `
                    + (m.at ? `(last finished run: ${fmtAgo(sinceAt)} ago).` : "(no run has finished yet)."), exports.LOGS_HINT);
            }
            // A recent start: running now, or killed so recently the start is still fresh. A job that runs
            // every few minutes refreshes its start before the check above could age, so "it keeps
            // starting and nothing finishes" is read from how many starts have had no end.
            if (m.startsSinceEnd >= exports.STARTS_WITHOUT_END_FAIL) {
                return line("fail", `Started ${m.startsSinceEnd} times in a row without finishing `
                    + (m.at ? `(last finished run: ${fmtAgo(sinceAt)} ago).` : "(no run has finished yet)."), exports.LOGS_HINT);
            }
            if (!m.at)
                return line("info", "Running for the first time.");
            // Otherwise a run is simply in progress: judge the last one that ended, below.
        }
        if (!m.at) {
            const watched = m.firstMissingAt ? nowMs - m.firstMissingAt : 0;
            if (m.firstMissingAt && watched > every * exports.DEAD_FACTOR) {
                return line("fail", `Has NEVER run: nothing in the ${fmtAgo(watched)} since this panel first looked (it should run every ${fmtEvery(j.everyMinutes)}).`, exports.SCHEDULER_HINT);
            }
            if (m.firstMissingAt && watched > every * exports.LATE_FACTOR) {
                return line("warn", `Has not run yet, ${fmtAgo(watched)} after this panel first looked.`, exports.SCHEDULER_HINT);
            }
            return line("info", "Has not run yet (normal right after the first deploy).");
        }
        if (sinceAt > every * exports.DEAD_FACTOR) {
            return line("fail", `Has not run for ${fmtAgo(sinceAt)} (it should run every ${fmtEvery(j.everyMinutes)}).`, exports.SCHEDULER_HINT);
        }
        if (sinceAt > every * exports.LATE_FACTOR) {
            return line("warn", `Late: last run ${fmtAgo(sinceAt)} ago (it should run every ${fmtEvery(j.everyMinutes)}).`, exports.SCHEDULER_HINT);
        }
        const detail = m.detail ? `: ${m.detail}` : ".";
        if (!m.ok && m.failStreak >= exports.FAIL_STREAK_FAIL) {
            return line("fail", `The last ${m.failStreak} runs failed${detail}`, exports.ERRORS_HINT + j.name);
        }
        if (!m.ok) {
            return line("warn", `The last run (${fmtAgo(sinceAt)} ago) failed${detail}`, exports.ERRORS_HINT + j.name);
        }
        return line("ok", `Ran ${fmtAgo(sinceAt)} ago${m.detail ? ` — ${m.detail}` : "."}`);
    });
}
/**
 * Jobs with NO marker document at all: the health check stamps `firstMissingAt` on them (merge), so
 * "never ran" gets an age and can escalate. A job that has started even once already has one. Pure.
 */
function jobsNeedingMissingStamp(markers) {
    const src = markers && typeof markers === "object" ? markers : {};
    return exports.JOB_SCHEDULE.filter((j) => !src[j.name] || typeof src[j.name] !== "object").map((j) => j.name);
}
//# sourceMappingURL=jobHealthCore.js.map