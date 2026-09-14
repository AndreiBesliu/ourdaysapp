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
exports.COMMON_ZONES = void 0;
exports.isValidTime = isValidTime;
exports.isValidZone = isValidZone;
exports.localZone = localZone;
exports.zoneOffsetMs = zoneOffsetMs;
exports.dayOf = dayOf;
exports.startInstant = startInstant;
exports.reminderInstant = reminderInstant;
exports.displayTime = displayTime;
exports.timeFieldsFor = timeFieldsFor;
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