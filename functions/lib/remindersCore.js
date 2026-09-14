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
exports.dueIn = dueIn;
const eventTime_1 = require("./eventTime");
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
 * Which reminders fall inside (from, to].
 *
 * Exported and pure so the window arithmetic can be exercised without a database — the part most
 * likely to be off by one is the boundary, and a boundary bug here is a reminder that never fires
 * or fires twice.
 */
function dueIn(occurrences, ownerZones, from, to) {
    var _a;
    const out = [];
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
        const zone = (0, eventTime_1.isValidZone)(ev.timezone)
            ? ev.timezone
            : ((0, eventTime_1.isValidZone)(ownerZones[ownerId]) ? ownerZones[ownerId] : "UTC");
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
        const recipients = [...new Set([ownerId, ...assignees, ...single])].filter(Boolean);
        if (recipients.length === 0)
            continue;
        out.push({
            // Per OCCURRENCE, not per event: a weekly series has to remind every week.
            key: `${ev.id}__${occ.day}`,
            eventId: ev.id,
            day: occ.day,
            title: (typeof ev.title === "string" ? ev.title : "").slice(0, 120),
            at,
            zone,
            recipients,
            clock: ((_a = (0, eventTime_1.displayTime)({ date: `${occ.day}T00:00:00.000Z`, time: clock, timezone: zone }, zone)) === null || _a === void 0 ? void 0 : _a.text) || clock,
        });
    }
    return out;
}
//# sourceMappingURL=remindersCore.js.map