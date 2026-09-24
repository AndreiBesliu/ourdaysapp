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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDueReminders = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const recurrenceServer_1 = require("./recurrenceServer");
const notify_1 = require("./notify");
const remindersCore_1 = require("./remindersCore");
/** Delete dedupe rows older than this. They are only needed while their window is still in reach. */
const LOG_TTL_DAYS = 45;
const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);
/**
 * How far ahead to look for events. A reminder may be set days in advance; beyond this it is not
 * delivered, and that is a stated bound rather than an accident — an unbounded lookahead means
 * expanding every recurring series in the database on every run.
 */
const MAX_LEAD_DAYS = 31;
/** How wide a net each run casts behind itself. Generous on purpose; the dedupe makes overlap free. */
const WINDOW_MS = 15 * 60 * 1000;
exports.sendDueReminders = (0, scheduler_1.onSchedule)({ schedule: "every 5 minutes", timeZone: "UTC", retryCount: 0 }, async () => {
    const db = admin.firestore();
    const now = Date.now();
    const from = now - WINDOW_MS;
    // One line per run, whatever the run did. Until now this function wrote NOTHING — every
    // execution was an empty log line — so "did it find anything?" had no answer short of
    // reading the database. Same shape as ERROR_DIGEST: a fixed prefix and one JSON object, so it
    // can be grepped and parsed by the same means.
    const counts = { candidates: 0, occurrences: 0, due: 0, sent: 0, dupes: 0, rows: 0, pushed: 0, failed: 0 };
    const done = () => {
        console.log("REMINDERS_RUN " + JSON.stringify(Object.assign({ at: new Date(now).toISOString() }, counts)));
    };
    // Everything below sits in a try so that the finally can keep the promise made above: one
    // REMINDERS_RUN line per run, whatever the run did — including a run that delivered three
    // reminders and then died in housekeeping. Without this, a throw anywhere lost the line and
    // the counters with it. (Review finding.)
    try {
        // ── candidates ──────────────────────────────────────────────────────────
        //
        // Two queries rather than one unbounded scan, and neither can be served by a range on the
        // reminder instant, because there is no such field.
        //
        //   * events starting inside the lookahead — covers every non-recurring one;
        //   * recurring parents, which start anywhere and are expanded below.
        const fromDay = dayString(now - 2 * 86400000);
        const toDay = dayString(now + MAX_LEAD_DAYS * 86400000);
        const [plain, recurring] = await Promise.all([
            db.collection("events")
                .where("date", ">=", `${fromDay}T00:00:00.000Z`)
                .where("date", "<=", `${toDay}T23:59:59.999Z`)
                .limit(2000).get(),
            db.collection("events").where("recurrenceRule", "!=", null).limit(2000).get(),
        ]);
        const byId = new Map();
        for (const d of [...plain.docs, ...recurring.docs]) {
            byId.set(d.id, Object.assign({ id: d.id }, d.data()));
        }
        const docs = [...byId.values()];
        counts.candidates = docs.length;
        if (docs.length === 0)
            return;
        const occurrences = (0, recurrenceServer_1.expandInWindow)(docs, fromDay, toDay)
            .map((o) => ({ source: o.source, day: o.day }));
        // Owners' zones, for the all-day fallback. One read per distinct owner, not per event.
        const ownerIds = [...new Set(docs.map((d) => (typeof d.ownerId === "string" ? d.ownerId : "")).filter(Boolean))];
        const ownerZones = {};
        if (ownerIds.length > 0) {
            const snaps = await db.getAll(...ownerIds.slice(0, 400).map((u) => db.doc(`users/${u}`)));
            snaps.forEach((s, i) => { var _a; ownerZones[ownerIds[i]] = (_a = s.data()) === null || _a === void 0 ? void 0 : _a.timezone; });
        }
        const due = (0, remindersCore_1.dueIn)(occurrences, ownerZones, from, now);
        counts.occurrences = occurrences.length;
        counts.due = due.length;
        if (due.length === 0)
            return;
        // ── send, at most once each ─────────────────────────────────────────────
        for (const d of due) {
            const logRef = db.doc(`reminder_log/${d.key}`);
            try {
                // `create` throws if the document exists. That is the dedupe: the first run to get here
                // wins, and a second one stops before sending rather than having to coordinate.
                await logRef.create({ eventId: d.eventId, day: d.day, at: d.at, sentAt: admin.firestore.FieldValue.serverTimestamp() });
            }
            catch (err) {
                // Only ALREADY_EXISTS means an overlapping run got here first. Counting every rejection
                // as a dupe would have made a transient UNAVAILABLE read as "somebody else delivered it" —
                // a log line that lies is worse than the silence it replaced. (Review finding.)
                const code = err === null || err === void 0 ? void 0 : err.code;
                const already = code === 6 || code === "already-exists"
                    || String((err === null || err === void 0 ? void 0 : err.message) || "").includes("ALREADY_EXISTS");
                if (already) {
                    counts.dupes += 1;
                }
                else {
                    counts.failed += 1;
                    console.error("reminder: dedupe write failed", d.key, err);
                }
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
                });
                counts.sent += 1;
                counts.rows += delivered.rows;
                counts.pushed += delivered.pushed;
            }
            catch (err) {
                counts.failed += 1;
                console.error("reminder: could not deliver", d.key, err);
            }
        }
        // ── housekeeping ────────────────────────────────────────────────────────
        const cutoff = dayString(now - LOG_TTL_DAYS * 86400000);
        const stale = await db.collection("reminder_log").where("day", "<", cutoff).limit(400).get();
        if (!stale.empty) {
            const batch = db.batch();
            stale.docs.forEach((s) => batch.delete(s.ref));
            await batch.commit();
        }
    }
    finally {
        done();
    }
});
//# sourceMappingURL=reminders.js.map