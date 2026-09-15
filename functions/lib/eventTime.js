"use strict";
// src/utils/eventTime.ts
// When an event actually happens.
//
// ── What was wrong ───────────────────────────────────────────────────────────────────
//
// Events had no time of day at all. The form is `type="date"`, and saving does
// `new Date('2026-09-20').toISOString()` — which JavaScript parses as MIDNIGHT UTC. So every
// event in the app sits at 00:00Z.
//
// Three places already read `ev.time` and none of them ever got one: the calendar grid and the
// home list both draw a clock icon beside it, and the reminder scheduler splits it into hours and
// minutes. A reader with no writer, three times over — so the clock has never appeared for
// anybody, and "remind me 30 minutes before" resolved to 23:30 UTC the previous day, which in
// Bucharest is half past two in the morning.
//
// ── The model ────────────────────────────────────────────────────────────────────────
//
// An event carries:
//   date     — the calendar day, as it always did: an ISO instant at midnight UTC. The DAY is the
//              UTC date part of it, and nothing here changes that, so every existing query, grid
//              bucket and recurrence expansion keeps working untouched.
//   time     — 'HH:mm', wall clock. Absent means an all-day event, which is what every event in
//              the app is today.
//   timezone — the IANA zone that wall clock is written in, captured when it was saved.
//
//   endDayOffset — whole days after the start day on which the event ENDS. Absent or 0 means the
//              same day, which is every event saved before this existed. A trip is 2; a party that
//              runs past midnight is 1.
//   endTime  — 'HH:mm' wall clock the event ends at, in the SAME `timezone` as `time`. Only
//              meaningful when `time` is set; an all-day span has days and no clocks.
//
// The end is stored RELATIVE to the start — an offset, never an absolute end date — for one
// reason that decides everything else: a recurring occurrence is `{ ...parent, date: thatDay }`,
// every other field copied verbatim. An absolute end would be right for the first occurrence and
// wrong for every later one; an offset is right for all of them by construction, and moving a
// whole series (shiftedSeriesStart) moves its end for free.
//
// The zone is stored ON THE EVENT rather than assumed to be the reader's. "Dinner at 19:00" means
// 19:00 where the dinner is; a family member reading it from another country wants to know that,
// not to see it silently shifted. Rendering says which zone when it differs from the reader's.
//
// ── Why the offset is computed and not looked up ─────────────────────────────────────
//
// No timezone library is installed, and `date-fns` alone cannot do zones. `Intl.DateTimeFormat`
// can, in both the browser and Node, and it is DST-correct because the platform owns the rules.
// The two-pass correction below is the standard way to invert it.
//
// Pure: no React, no Firestore. Usable unchanged on the server, which slice 2 will need.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMON_ZONES = exports.MAX_SPAN_DAYS = void 0;
exports.isValidTime = isValidTime;
exports.isValidZone = isValidZone;
exports.localZone = localZone;
exports.zoneOffsetMs = zoneOffsetMs;
exports.localDayKey = localDayKey;
exports.dayOf = dayOf;
exports.startInstant = startInstant;
exports.reminderInstant = reminderInstant;
exports.displayTime = displayTime;
exports.displayEndTime = displayEndTime;
exports.timeFieldsFor = timeFieldsFor;
exports.isValidDayOffset = isValidDayOffset;
exports.dayPlus = dayPlus;
exports.dayOffsetBetween = dayOffsetBetween;
exports.spanOf = spanOf;
exports.occursOn = occursOn;
exports.daysOf = daysOf;
exports.endInstant = endInstant;
exports.spanProblem = spanProblem;
exports.endFieldsFor = endFieldsFor;
exports.zoneChoices = zoneChoices;
exports.zoneLabel = zoneLabel;
function isValidTime(t) {
    return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
/** An IANA zone this runtime actually knows. Anything else is refused rather than guessed. */
function isValidZone(tz) {
    if (typeof tz !== 'string' || !tz)
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    }
    catch (_a) {
        return false;
    }
}
/** The viewer's own zone, or UTC if the runtime will not say. */
function localZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    catch (_a) {
        return 'UTC';
    }
}
/**
 * How far `zone` is ahead of UTC at a given instant, in milliseconds.
 *
 * Asked of `Intl` rather than of a table: the platform owns the DST rules, and they change by
 * government decree more often than a hand-written table gets updated.
 */
function zoneOffsetMs(utcMs, zone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (type) => { var _a, _b; return Number((_b = (_a = parts.find((p) => p.type === type)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : 0); };
    // `hour` comes back as 24 for midnight in some engines under hour12:false.
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asIfUtc - utcMs;
}
/**
 * The day a LOCAL Date falls on, as `yyyy-MM-dd` — the label a calendar cell carries.
 *
 * This is the other half of `dayOf`: events are stored by day label (midnight UTC of the label),
 * cells are local Dates, and the two meet on the label. Comparing the stored instant with the
 * local cell instead (`isSameDay(new Date(ev.date), cell)`) put every event on the previous
 * evening for anyone west of Greenwich — a skew that had been in eight places.
 */
function localDayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The calendar day of an event, as `yyyy-MM-dd`. Read in UTC, because that is how it is stored. */
function dayOf(dateIso) {
    const ms = Date.parse(dateIso);
    if (!Number.isFinite(ms))
        return null;
    return new Date(ms).toISOString().slice(0, 10);
}
/**
 * The instant an event starts, in epoch milliseconds — or null for an all-day event, which does
 * not have one.
 *
 * Two passes, and the second is not optional: the first guess uses the offset in force at the
 * WRONG instant (the wall time read as if it were UTC), which lands on the other side of a DST
 * change twice a year. Correcting once and re-reading the offset at the corrected instant fixes
 * it. In the spring-forward gap the wall time does not exist at all; this converges on the
 * instant just after the jump, which is the conventional answer and never throws.
 */
function startInstant(ev, fallbackZone = 'UTC') {
    if (typeof ev.date !== 'string')
        return null;
    if (!isValidTime(ev.time))
        return null;
    const day = dayOf(ev.date);
    if (!day)
        return null;
    const zone = isValidZone(ev.timezone) ? ev.timezone : fallbackZone;
    const [y, m, d] = day.split('-').map(Number);
    const [hh, mm] = ev.time.split(':').map(Number);
    const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    const firstPass = naive - zoneOffsetMs(naive, zone);
    return naive - zoneOffsetMs(firstPass, zone);
}
/** When to fire a reminder, or null when there is nothing to fire. */
function reminderInstant(ev, fallbackZone = 'UTC') {
    const minutes = typeof ev.reminderMinutes === 'number' && Number.isFinite(ev.reminderMinutes)
        ? ev.reminderMinutes
        : null;
    if (minutes === null || minutes < 0)
        return null;
    const start = startInstant(ev, fallbackZone);
    if (start === null)
        return null;
    return start - minutes * 60000;
}
/**
 * The wall clock to SHOW a reader, and whether to name the zone.
 *
 * The zone is named only when it differs from the reader's, because "19:00" is what somebody
 * wants to read nine times out of ten and "19:00 (Europe/Bucharest)" is noise at home.
 */
function displayTime(ev, readerZone) {
    if (!isValidTime(ev.time))
        return null;
    const evZone = isValidZone(ev.timezone) ? ev.timezone : null;
    if (!evZone || evZone === readerZone || !isValidZone(readerZone)) {
        // No zone recorded (every event saved before this existed) — show the wall clock as written
        // rather than converting it with a guess that could be hours off.
        return { text: ev.time, zoneNote: null };
    }
    const instant = startInstant(ev, evZone);
    if (instant === null)
        return { text: ev.time, zoneNote: null };
    const text = new Intl.DateTimeFormat('en-GB', {
        timeZone: readerZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(instant));
    return { text, zoneNote: evZone };
}
/**
 * The wall clock an event ENDS at, for a reader — the mirror of `displayTime`, same rules: shown as
 * written unless both zones are known and differ, in which case it is converted and the zone named.
 */
function displayEndTime(ev, readerZone) {
    if (!isValidTime(ev.endTime))
        return null;
    const evZone = isValidZone(ev.timezone) ? ev.timezone : null;
    if (!evZone || evZone === readerZone || !isValidZone(readerZone)) {
        return { text: ev.endTime, zoneNote: null };
    }
    const instant = endInstant(ev, evZone);
    if (instant === null)
        return { text: ev.endTime, zoneNote: null };
    const text = new Intl.DateTimeFormat('en-GB', {
        timeZone: readerZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(instant));
    return { text, zoneNote: evZone };
}
/**
 * What to write on an event being saved.
 *
 * The zone is captured at save time and travels with the event. An empty time clears both, so
 * turning a timed event back into an all-day one does not leave a stale zone behind claiming a
 * precision the event no longer has.
 */
function timeFieldsFor(time, zone) {
    if (!isValidTime(time))
        return { time: null, timezone: null };
    return { time, timezone: isValidZone(zone) ? zone : localZone() };
}
// ── Spans ────────────────────────────────────────────────────────────────────────────
//
// Everything below reads the two end fields and nothing else changes: `startInstant`, `dayOf`
// and `reminderInstant` keep answering about the START, which is what a reminder is anchored to.
// Self-contained on purpose — this file is copied verbatim to functions/src and may import nothing.
/** The most days an event may span. Longer than any family plan; a cap, not a feature. */
exports.MAX_SPAN_DAYS = 366;
/** Whole days after the start day on which the event ends. 0 or absent means the same day. */
function isValidDayOffset(n) {
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= exports.MAX_SPAN_DAYS;
}
/**
 * `yyyy-MM-dd` plus `n` whole days. Calendar arithmetic in UTC, where the day strings live —
 * no zone is involved, so no DST can move it. `Date.UTC` normalises an overflowing day-of-month.
 */
function dayPlus(day, n) {
    const [y, m, d] = String(day).split('-').map(Number);
    if (![y, m, d].every(Number.isFinite) || !Number.isInteger(n))
        return null;
    const ms = Date.UTC(y, m - 1, d + n);
    if (!Number.isFinite(ms))
        return null;
    return new Date(ms).toISOString().slice(0, 10);
}
/**
 * Whole days from `startDay` to `endDay`, or null when either is unreadable or the end is before
 * the start.
 *
 * The form asks a person for an end DATE, because that is what a person means; the event stores an
 * OFFSET, because that is what a recurring occurrence can inherit. This is the join between them,
 * and it is here rather than in the form so both the form and its tests can use it.
 */
function dayOffsetBetween(startDay, endDay) {
    if (typeof startDay !== 'string' || typeof endDay !== 'string')
        return null;
    const a = Date.parse(`${startDay}T00:00:00.000Z`);
    const b = Date.parse(`${endDay}T00:00:00.000Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return null;
    const days = Math.round((b - a) / 86400000);
    return isValidDayOffset(days) ? days : null;
}
/** The days an event covers, from its stored fields. An unknown or absent span means one day. */
function spanOf(ev) {
    var _a;
    if (typeof ev.date !== 'string')
        return null;
    const startDay = dayOf(ev.date);
    if (!startDay)
        return null;
    const offset = isValidDayOffset(ev.endDayOffset) ? ev.endDayOffset : 0;
    const endDay = (_a = dayPlus(startDay, offset)) !== null && _a !== void 0 ? _a : startDay;
    return { startDay, endDay, offset, endTime: isValidTime(ev.endTime) ? ev.endTime : null };
}
/**
 * Is `day` (yyyy-MM-dd) one of the days this event is on?
 *
 * This is THE membership question, and it used to be written by hand as
 * `isSameDay(new Date(ev.date), day)` in eight places. String order is date order for this shape,
 * so the comparison is exact and zone-free.
 */
function occursOn(ev, day) {
    const span = spanOf(ev);
    return !!span && day >= span.startDay && day <= span.endDay;
}
/** Every day the event is on, first to last. Empty for an event with no readable date. */
function daysOf(ev) {
    const span = spanOf(ev);
    if (!span)
        return [];
    const out = [];
    for (let i = 0; i <= span.offset; i++) {
        const d = dayPlus(span.startDay, i);
        if (d)
            out.push(d);
    }
    return out;
}
/**
 * The instant a timed event ends, in epoch milliseconds — or null when there is no such instant:
 * an all-day event, or a timed one with no end time (drawn at a nominal length instead).
 *
 * Same two-pass DST correction as `startInstant`, on the END day. An end on a later day crosses a
 * DST change more often than a start does — 23:00 on the last Saturday of March to 04:00 on the
 * Sunday is four hours of clock and three of elapsed time, and this returns the three.
 */
function endInstant(ev, fallbackZone = 'UTC') {
    if (!isValidTime(ev.time) || !isValidTime(ev.endTime))
        return null;
    const span = spanOf(ev);
    if (!span)
        return null;
    const zone = isValidZone(ev.timezone) ? ev.timezone : fallbackZone;
    const [y, m, d] = span.endDay.split('-').map(Number);
    const [hh, mm] = ev.endTime.split(':').map(Number);
    const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    const firstPass = naive - zoneOffsetMs(naive, zone);
    return naive - zoneOffsetMs(firstPass, zone);
}
/**
 * Why a span cannot be saved as given, or null when it can.
 *
 * Used by the form before writing and by the server before accepting an override, so the two
 * cannot drift: a same-day event that ends before it starts, or an end time on an event with no
 * start time, is refused with the same word in both places.
 */
function spanProblem(ev) {
    if (ev.endDayOffset !== undefined && ev.endDayOffset !== null && !isValidDayOffset(ev.endDayOffset))
        return 'offset';
    const hasEnd = ev.endTime !== undefined && ev.endTime !== null && ev.endTime !== '';
    if (hasEnd && !isValidTime(ev.endTime))
        return 'ends-before-start';
    if (hasEnd && !isValidTime(ev.time))
        return 'end-without-start';
    const offset = isValidDayOffset(ev.endDayOffset) ? ev.endDayOffset : 0;
    if (offset === 0 && isValidTime(ev.time) && isValidTime(ev.endTime) && ev.endTime <= ev.time)
        return 'ends-before-start';
    return null;
}
/**
 * What to write for the end of an event being saved. The sibling of `timeFieldsFor`, kept
 * separate so that function's contract (exactly `time` and `timezone`) stays as its test pins it.
 *
 * A same-day end is written as null rather than 0, so an event that never had a span and one
 * whose span was removed look identical in the database. An end time without a start time is
 * dropped: it would describe a precision the event does not have.
 */
function endFieldsFor(endDayOffset, endTime, hasStartTime) {
    const offset = isValidDayOffset(endDayOffset) && endDayOffset > 0 ? endDayOffset : null;
    const end = hasStartTime && isValidTime(endTime) ? endTime : null;
    return { endDayOffset: offset, endTime: end };
}
/**
 * A short, stable list of zones for a picker, with the viewer's own first.
 *
 * `Intl.supportedValuesOf('timeZone')` returns 400+ entries where it exists at all; a family app
 * needs a list somebody can actually scroll. The viewer's own zone is always present even when it
 * is not on the list, so nobody is ever forced to pick a zone that is not theirs.
 */
exports.COMMON_ZONES = [
    'Europe/Bucharest', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Europe/Rome', 'Europe/Lisbon', 'Europe/Athens', 'Europe/Moscow', 'Europe/Istanbul',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Jerusalem', 'Asia/Kolkata',
    'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
];
function zoneChoices(current) {
    const seen = new Set();
    const out = [];
    for (const z of [current, ...exports.COMMON_ZONES]) {
        if (!z || seen.has(z) || !isValidZone(z))
            continue;
        seen.add(z);
        out.push(z);
    }
    return out;
}
/** "Europe/Bucharest (UTC+03:00)" — the offset is what people actually recognise. */
function zoneLabel(zone, at = Date.now()) {
    if (!isValidZone(zone))
        return zone;
    const off = zoneOffsetMs(at, zone);
    const sign = off < 0 ? '-' : '+';
    const abs = Math.abs(off);
    const hh = String(Math.floor(abs / 3600000)).padStart(2, '0');
    const mm = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
    return `${zone.replace(/_/g, ' ')} (UTC${sign}${hh}:${mm})`;
}
//# sourceMappingURL=eventTime.js.map