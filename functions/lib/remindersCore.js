"use strict";
// functions/src/remindersCore.ts
// Which reminders are due, and when — the arithmetic, with nothing plugged into it.
//
// This is split out of `reminders.ts` for a reason that is easy to lose: the app's own test suite
// exercises this, and CI installs only the APP's dependencies. `reminders.ts` imports
// `firebase-functions` and `firebase-admin`, which live in `functions/node_modules` and are simply
// absent when the app's tests run. A test that reaches into a module importing them passes on a
// developer machine — where both trees happen to be installed — and fails in CI, which is the one
// place the answer is honest.
//
// So the rule this file exists to keep: everything reachable from an app test stays free of
// package imports. `functionsPurity.test.ts` enforces it rather than trusting it.
//
// The boundary is worth having on its own merits. The part most likely to be wrong here is a
// window boundary, and a boundary bug is a reminder that never fires or fires twice — neither of
// which anybody reports, because there is nothing to see.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMINDER_FIELDS = void 0;
exports.compactEvent = compactEvent;
exports.bodyFor = bodyFor;
exports.dueIn = dueIn;
exports.sendOrder = sendOrder;
const eventTime_1 = require("./eventTime");
/**
 * Every field the reminder is computed from: `expandInWindow` (the series, its exceptions and
 * overrides, the span) and `dueIn` (the lead, the clock, the zone, who to tell, the title). The job
 * reads ONLY these (12.10.2026): an event can hold a megabyte of description and checklist, and the
 * job reads thousands of events every five minutes. Of the rule, only the two parts a series is
 * expanded from: the rest of the map could be a megabyte too. A field read below and missing here reads as
 * absent, and the reminder quietly changes — remindersCompact.test.ts holds the two together.
 */
exports.REMINDER_FIELDS = [
    "date", "recurrenceRule.frequency", "recurrenceRule.onlyOn", "recurrenceExceptions", "overrideOfParent",
    "overrideDate", "ownerId", "groupId", "endDayOffset", "reminderMinutes", "timezone", "time", "assigneeIds",
    "assigneeId", "title",
];
/** Bounds of what the app writes; anything longer is not the app's, and is not kept. */
const MAX_ID = 128;
const MAX_DOC_ID = 1500;
const MAX_DATE = 32;
const MAX_ZONE = 64;
const MAX_ASSIGNEES = 50;
const TITLE_CHARS = 120;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** A copy that holds no reference into `s` (a slice of a megabyte keeps the megabyte alive in V8). */
const flat = (s) => Array.from(s).join("");
const shortText = (v, max) => typeof v === "string" && v.length <= max ? v : undefined;
/**
 * An event reduced, as it is read, to what the reminder is computed from, each part bounded.
 *
 * A personal event's fields are not checked by the rules, so any of them can be a megabyte, and the
 * job keeps every candidate until it has expanded them all (the override dedupe needs them together).
 * For every event the app writes the result is the same: `dueIn(expandInWindow(...))` over the copy
 * equals it over the original (remindersCompact.test.ts). What does not fit the app's shapes is
 * dropped field by field, and the whole event when its id or date cannot be one of the app's.
 */
function compactEvent(id, raw, fromDay, toDay) {
    var _a, _b;
    // The id goes into the dedupe key (`<id>__<day>`), which Firestore refuses past 1500 bytes.
    if (typeof id !== "string" || !id || id.length > MAX_ID)
        return null;
    const date = shortText(raw.date, MAX_DATE);
    if (!date)
        return null;
    const out = { id, date };
    const rule = raw.recurrenceRule;
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
        const frequency = shortText(rule.frequency, 16);
        const onlyOn = shortText(rule.onlyOn, 16);
        out.recurrenceRule = Object.assign(Object.assign({}, (frequency !== undefined ? { frequency } : {})), (onlyOn !== undefined ? { onlyOn } : {}));
    }
    else {
        out.recurrenceRule = null;
    }
    // Only an exception that can suppress an occurrence of this window matters: an occurrence starts
    // in the window, or up to its span before it (a multi-day event still running on the first day),
    // and the weekly tolerance looks one day either side. A few dozen at most, whatever was stored.
    const span = (0, eventTime_1.isValidDayOffset)(raw.endDayOffset) ? raw.endDayOffset : 0;
    const lo = (_a = (0, eventTime_1.dayPlus)(fromDay, -(span + 1))) !== null && _a !== void 0 ? _a : fromDay;
    const hi = (_b = (0, eventTime_1.dayPlus)(toDay, 1)) !== null && _b !== void 0 ? _b : toDay;
    if (Array.isArray(raw.recurrenceExceptions)) {
        const kept = new Set();
        for (const x of raw.recurrenceExceptions) {
            if (typeof x === "string" && x.length === 10 && DAY_KEY.test(x) && x >= lo && x <= hi)
                kept.add(x);
        }
        out.recurrenceExceptions = [...kept];
    }
    const parent = shortText(raw.overrideOfParent, MAX_DOC_ID);
    if (parent !== undefined)
        out.overrideOfParent = parent;
    const overrideDate = shortText(raw.overrideDate, 10);
    if (overrideDate !== undefined)
        out.overrideDate = overrideDate;
    const ownerId = shortText(raw.ownerId, MAX_ID);
    if (ownerId !== undefined)
        out.ownerId = ownerId;
    const groupId = shortText(raw.groupId, MAX_DOC_ID);
    if (groupId !== undefined)
        out.groupId = groupId;
    if (typeof raw.endDayOffset === "number")
        out.endDayOffset = raw.endDayOffset;
    if (typeof raw.reminderMinutes === "number")
        out.reminderMinutes = raw.reminderMinutes;
    const timezone = shortText(raw.timezone, MAX_ZONE);
    if (timezone !== undefined)
        out.timezone = timezone;
    const time = shortText(raw.time, 5);
    if (time !== undefined)
        out.time = time;
    if (Array.isArray(raw.assigneeIds)) {
        const people = new Set();
        for (const x of raw.assigneeIds) {
            if (people.size >= MAX_ASSIGNEES)
                break;
            if (typeof x === "string" && x && x.length <= MAX_ID)
                people.add(x);
        }
        out.assigneeIds = [...people];
    }
    const single = shortText(raw.assigneeId, MAX_ID);
    if (single !== undefined)
        out.assigneeId = single;
    if (typeof raw.title === "string")
        out.title = flat(raw.title.slice(0, TITLE_CHARS));
    return out;
}
/**
 * When an ALL-DAY event is treated as starting.
 *
 * Every event in this app was all-day until the clock shipped, so refusing to remind for them
 * would silently drop every reminder anybody has ever set. Nine in the morning is the convention
 * every calendar uses, and it is resolved in the OWNER's zone so one occurrence has one instant —
 * a per-recipient instant would need a per-recipient dedupe key.
 */
const ALL_DAY_HOUR = "09:00";
/**
 * The assistant an event can be assigned to. It is nobody's phone: as a recipient it only wrote a
 * bell row for an account that does not exist, once per reminder (13.10.2026).
 */
const AI_ASSISTANT = "ai_assistant";
const DAY_MS = 86400000;
/** The calendar day of instant `ms` in `zone`, as `yyyy-MM-dd`. */
function dayIn(ms, zone) {
    return new Date(ms + (0, eventTime_1.zoneOffsetMs)(ms, zone)).toISOString().slice(0, 10);
}
/**
 * What the reminder says about WHEN.
 *
 * It said "Starts at 09:00" in every case. The eve of an all-day event therefore read as "today at
 * nine" — and nine is only where an all-day reminder is placed, not when anything starts. A timed
 * event reminded a day ahead said "Starts at 14:00" with no day either. So: relative to the day the
 * reminder arrives, in the event's zone, which every language can say without formatting a date —
 * today, tomorrow, and past that the date itself (ISO, the one form nobody misreads).
 */
function bodyFor(day, at, zone, clockText) {
    const ahead = Math.round((Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${dayIn(at, zone)}T00:00:00.000Z`)) / DAY_MS);
    if (clockText === null) {
        if (ahead <= 0)
            return { bodyKey: "notifReminderAllDayToday", bodyParam: "" };
        if (ahead === 1)
            return { bodyKey: "notifReminderAllDayTomorrow", bodyParam: "" };
        return { bodyKey: "notifReminderAllDayOn", bodyParam: day };
    }
    if (ahead <= 0)
        return { bodyKey: "notifReminderAt", bodyParam: clockText };
    if (ahead === 1)
        return { bodyKey: "notifReminderTomorrowAt", bodyParam: clockText };
    return { bodyKey: "notifReminderOn", bodyParam: `${day}, ${clockText}` };
}
/** The name Intl itself uses for a zone it accepts ('eUrOpE/bUcHaReSt' is Europe/Bucharest). */
function canonicalZone(zone) {
    try {
        return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone || zone;
    }
    catch (_a) {
        return zone;
    }
}
/**
 * Which reminders fall inside (from, to].
 *
 * Exported and pure so the window arithmetic can be exercised without a database — the part most
 * likely to be off by one is the boundary, and a boundary bug here is a reminder that never fires
 * or fires twice.
 */
function dueIn(occurrences, ownerZones, from, to) {
    var _a;
    const out = [];
    // The zone of each EVENT, resolved once and by its canonical name: a series has dozens of
    // occurrences, and the zone caches (eventTime.ts) are keyed by name — the same zone spelt in a
    // hundred capitalisations, which Intl accepts, would otherwise rebuild a formatter for every
    // occurrence (review, 12.10.2026).
    const zoneOf = new Map();
    for (const occ of occurrences) {
        const ev = occ.source;
        const minutes = typeof ev.reminderMinutes === "number" && Number.isFinite(ev.reminderMinutes)
            ? ev.reminderMinutes
            : null;
        if (minutes === null || minutes < 0)
            continue;
        const ownerId = typeof ev.ownerId === "string" ? ev.ownerId : "";
        // The event's own zone when it has one; otherwise the owner's, so that one occurrence has one
        // instant for everybody rather than a different one per reader.
        let zone = zoneOf.get(ev);
        if (zone === undefined) {
            zone = canonicalZone((0, eventTime_1.isValidZone)(ev.timezone)
                ? ev.timezone
                : ((0, eventTime_1.isValidZone)(ownerZones[ownerId]) ? ownerZones[ownerId] : "UTC"));
            zoneOf.set(ev, zone);
        }
        const hasClock = typeof ev.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(ev.time);
        const clock = hasClock ? ev.time : ALL_DAY_HOUR;
        // The occurrence's own day, not the series start — that is the whole point of expanding.
        const start = (0, eventTime_1.startInstant)({ date: `${occ.day}T00:00:00.000Z`, time: clock, timezone: zone }, zone);
        if (start === null)
            continue;
        const at = start - minutes * 60000;
        // Half-open on purpose: `from` was covered by the previous run, `to` by this one. A closed
        // interval on both ends double-counts the boundary every single run.
        if (!(at > from && at <= to))
            continue;
        const assignees = Array.isArray(ev.assigneeIds)
            ? ev.assigneeIds.filter((x) => typeof x === "string" && !!x)
            : [];
        const single = typeof ev.assigneeId === "string" && ev.assigneeId ? [ev.assigneeId] : [];
        const recipients = [...new Set([ownerId, ...assignees, ...single])].filter((u) => u && u !== AI_ASSISTANT);
        if (recipients.length === 0)
            continue;
        out.push(Object.assign({ 
            // Per OCCURRENCE, not per event: a weekly series has to remind every week.
            key: `${ev.id}__${occ.day}`, eventId: ev.id, ownerId, day: occ.day, title: (typeof ev.title === "string" ? ev.title : "").slice(0, 120), at,
            zone,
            recipients }, bodyFor(occ.day, at, zone, hasClock ? (((_a = (0, eventTime_1.displayTime)({ date: `${occ.day}T00:00:00.000Z`, time: clock, timezone: zone }, zone)) === null || _a === void 0 ? void 0 : _a.text) || clock) : null)));
    }
    return out;
}
/**
 * The order the due reminders are sent in, and which of them are on their LAST run (13.10.2026).
 *
 * A reminder is due in every run whose look-back (`windowMs`) holds its instant — three runs, five
 * minutes apart. One that the next run will no longer see is on its last chance: those go first, so
 * a run that runs out of time loses as few as it can, and each one it does lose is counted. Within
 * each part the turns go round the OWNERS, one reminder each: one account's thousand reminders at the
 * same minute wait behind everybody else's first one, instead of in front of all of them.
 * `slackMs` treats a reminder as on its last chance a little early, for a next run that starts late.
 */
function sendOrder(due, now, windowMs, everyMs, slackMs) {
    const lastChance = new Set(due.filter((d) => d.at <= now + everyMs + slackMs - windowMs).map((d) => d.key));
    const roundRobin = (items) => {
        const byOwner = new Map();
        for (const d of items) {
            const q = byOwner.get(d.ownerId);
            if (q)
                q.push(d);
            else
                byOwner.set(d.ownerId, [d]);
        }
        const queues = [...byOwner.values()];
        const out = [];
        for (let i = 0; out.length < items.length; i++) {
            for (const q of queues)
                if (i < q.length)
                    out.push(q[i]);
        }
        return out;
    };
    return {
        order: [...roundRobin(due.filter((d) => lastChance.has(d.key))), ...roundRobin(due.filter((d) => !lastChance.has(d.key)))],
        lastChance,
    };
}
//# sourceMappingURL=remindersCore.js.map