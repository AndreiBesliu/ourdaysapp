"use strict";
// functions/src/recurrenceServer.ts
// Expanding a recurring event on the server, the way the client does — and the three places
// where doing it naively is wrong.
//
// A recurring event is ONE document; its occurrences are expanded at read time. So a plain
// range query on `date` misses every occurrence whose parent starts before the window, which
// is most of them. The expansion has to happen here too.
//
// ── 1. The two bounded passes ──────────────────────────────────────────────────────────
//
// The client caps a series from its START: daily +30 days, weekly +52 weeks, monthly +12
// months, yearly +5 years. So "look back far enough" is 400 days for the first three and five
// years for the last. Two bounded queries, never one unbounded scan.
//
// ── 2. Exception keys are OPAQUE TOKENS, not dates ─────────────────────────────────────
//
// The key is written by whoever DELETED the occurrence, not by whoever is reading. The client
// formats it with `format(current, 'yyyy-MM-dd')` — LOCAL — applied to an instant that is
// midnight UTC, and that string is stored verbatim. So neither UTC nor the reader's own
// offset reproduces it reliably. Hence:
//   • weekly / monthly / yearly — skip if ANY of {D−1, D, D+1} is in the exception list.
//     Over-suppression, which is the right direction for a privacy-sensitive reader, and free
//     because neighbouring days are not occurrences of those frequencies anyway.
//   • daily — the exact UTC key ONLY. Tolerance there would delete two real occurrences per
//     exception.
//
// ── 3. The override dedupe, which is the one that always works ─────────────────────────
//
// `createEventOverride` writes the edited occurrence as a REAL event carrying its parent's id.
// So if a real document exists for parent P on day D, P's expansion for D is suppressed —
// whatever the exception key says, whoever wrote it, from whatever offset. The data gives us
// the dedupe for free, and it is the only branch here that cannot be defeated by a timezone.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHORT_FREQUENCIES = exports.FREQUENCIES = void 0;
exports.frequencyOf = frequencyOf;
exports.lookbackMsFor = lookbackMsFor;
exports.expandInWindow = expandInWindow;
exports.FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];
/** Frequencies whose whole horizon fits inside 400 days back. */
exports.SHORT_FREQUENCIES = ["daily", "weekly", "monthly"];
const DAY_MS = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Advance by one step, in UTC. Month and year steps clamp, matching `date-fns` behaviour. */
function advance(ms, freq) {
    const d = new Date(ms);
    switch (freq) {
        case "daily": return ms + DAY_MS;
        case "weekly": return ms + 7 * DAY_MS;
        case "monthly": {
            const day = d.getUTCDate();
            const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
            const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
            next.setUTCDate(Math.min(day, last));
            return next.getTime();
        }
        case "yearly": {
            const day = d.getUTCDate();
            const next = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
            const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
            next.setUTCDate(Math.min(day, last));
            return next.getTime();
        }
    }
}
/** The client's horizon, from the series start. Mirrors `getRecurrenceEndDate`. */
function horizonEnd(startMs, freq) {
    const d = new Date(startMs);
    switch (freq) {
        case "daily": return startMs + 30 * DAY_MS;
        case "weekly": return startMs + 52 * 7 * DAY_MS;
        case "monthly": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 12, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
        case "yearly": return Date.UTC(d.getUTCFullYear() + 5, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    }
}
function frequencyOf(ev) {
    const f = ev.recurrenceRule && ev.recurrenceRule.frequency;
    return typeof f === "string" && exports.FREQUENCIES.includes(f)
        ? f
        : null;
}
/** How far back a query must reach to catch every series that can still be running. */
function lookbackMsFor(freq) {
    return freq === "yearly" ? 5 * 366 * DAY_MS : 400 * DAY_MS;
}
/**
 * Expand a set of documents into the occurrences that fall inside [fromDay, toDay].
 *
 * `taken` is the set of `parentId|day` pairs already covered by a real override document, so
 * an edited occurrence and its ghost can never both be emitted.
 */
function expandInWindow(docs, fromDay, toDay) {
    const taken = new Set();
    for (const ev of docs) {
        const parent = ev.overrideOfParent;
        if (typeof parent === "string" && parent && typeof ev.date === "string") {
            taken.add(`${parent}|${ev.date.slice(0, 10)}`);
        }
    }
    const out = [];
    for (const ev of docs) {
        if (typeof ev.date !== "string" || !ev.date)
            continue;
        const freq = frequencyOf(ev);
        if (!freq) {
            const day = ev.date.slice(0, 10);
            if (day >= fromDay && day <= toDay)
                out.push({ source: ev, day, virtual: false });
            continue;
        }
        const startMs = Date.parse(ev.date);
        if (!Number.isFinite(startMs))
            continue;
        const exceptions = new Set((Array.isArray(ev.recurrenceExceptions) ? ev.recurrenceExceptions : [])
            .filter((x) => typeof x === "string"));
        const end = horizonEnd(startMs, freq);
        const toMs = Date.parse(`${toDay}T23:59:59.999Z`);
        let cur = startMs;
        // A hard step cap: a corrupt `date` plus a daily rule could otherwise spin. The horizon
        // already bounds this; the cap is the guard against a value that defeats the horizon.
        for (let steps = 0; steps < 4000 && cur <= end && cur <= toMs; steps++) {
            const day = dayKey(cur);
            if (day >= fromDay) {
                const suppressed = freq === "daily"
                    ? exceptions.has(day)
                    : exceptions.has(day) ||
                        exceptions.has(dayKey(cur - DAY_MS)) ||
                        exceptions.has(dayKey(cur + DAY_MS));
                if (!suppressed && !taken.has(`${ev.id}|${day}`)) {
                    out.push({ source: ev, day, virtual: true });
                }
            }
            cur = advance(cur, freq);
        }
    }
    out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    return out;
}
//# sourceMappingURL=recurrenceServer.js.map