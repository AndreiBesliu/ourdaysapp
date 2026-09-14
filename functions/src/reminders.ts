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

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { expandInWindow, type EventDoc } from "./recurrenceServer";
import { displayTime, isValidZone, startInstant } from "./eventTime";
import { notify } from "./notify";

/**
 * How far ahead to look for events. A reminder may be set days in advance; beyond this it is not
 * delivered, and that is a stated bound rather than an accident — an unbounded lookahead means
 * expanding every recurring series in the database on every run.
 */
const MAX_LEAD_DAYS = 31;

/** How wide a net each run casts behind itself. Generous on purpose; the dedupe makes overlap free. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * When an ALL-DAY event is treated as starting.
 *
 * Every event in this app was all-day until the clock shipped, so refusing to remind for them
 * would silently drop every reminder anybody has ever set. Nine in the morning is the convention
 * every calendar uses, and it is resolved in the OWNER's zone so one occurrence has one instant —
 * a per-recipient instant would need a per-recipient dedupe key.
 */
const ALL_DAY_HOUR = "09:00";

/** Delete dedupe rows older than this. They are only needed while their window is still in reach. */
const LOG_TTL_DAYS = 45;

const dayString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

interface Due {
  key: string;
  eventId: string;
  day: string;
  title: string;
  at: number;
  zone: string;
  recipients: string[];
  clock: string;
}

/**
 * Which reminders fall inside (from, to].
 *
 * Exported and pure so the window arithmetic can be exercised without a database — the part most
 * likely to be off by one is the boundary, and a boundary bug here is a reminder that never fires
 * or fires twice.
 */
export function dueIn(
  occurrences: { source: EventDoc & Record<string, unknown>; day: string }[],
  ownerZones: Record<string, string | undefined>,
  from: number,
  to: number,
): Due[] {
  const out: Due[] = [];

  for (const occ of occurrences) {
    const ev = occ.source;
    const minutes = typeof ev.reminderMinutes === "number" && Number.isFinite(ev.reminderMinutes)
      ? ev.reminderMinutes
      : null;
    if (minutes === null || minutes < 0) continue;

    const ownerId = typeof ev.ownerId === "string" ? ev.ownerId : "";
    // The event's own zone when it has one; otherwise the owner's, so that one occurrence has one
    // instant for everybody rather than a different one per reader.
    const zone = isValidZone(ev.timezone)
      ? (ev.timezone as string)
      : (isValidZone(ownerZones[ownerId]) ? (ownerZones[ownerId] as string) : "UTC");

    const hasClock = typeof ev.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(ev.time);
    const clock = hasClock ? (ev.time as string) : ALL_DAY_HOUR;

    // The occurrence's own day, not the series start — that is the whole point of expanding.
    const start = startInstant({ date: `${occ.day}T00:00:00.000Z`, time: clock, timezone: zone }, zone);
    if (start === null) continue;

    const at = start - minutes * 60_000;
    // Half-open on purpose: `from` was covered by the previous run, `to` by this one. A closed
    // interval on both ends double-counts the boundary every single run.
    if (!(at > from && at <= to)) continue;

    const assignees = Array.isArray(ev.assigneeIds)
      ? (ev.assigneeIds as unknown[]).filter((x): x is string => typeof x === "string" && !!x)
      : [];
    const single = typeof ev.assigneeId === "string" && ev.assigneeId ? [ev.assigneeId] : [];
    const recipients = [...new Set([ownerId, ...assignees, ...single])].filter(Boolean);
    if (recipients.length === 0) continue;

    out.push({
      // Per OCCURRENCE, not per event: a weekly series has to remind every week.
      key: `${ev.id}__${occ.day}`,
      eventId: ev.id,
      day: occ.day,
      title: (typeof ev.title === "string" ? ev.title : "").slice(0, 120),
      at,
      zone,
      recipients,
      clock: displayTime({ date: `${occ.day}T00:00:00.000Z`, time: clock, timezone: zone }, zone)?.text || clock,
    });
  }

  return out;
}

export const sendDueReminders = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC", retryCount: 0 },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const from = now - WINDOW_MS;

    // ── candidates ──────────────────────────────────────────────────────────
    //
    // Two queries rather than one unbounded scan, and neither can be served by a range on the
    // reminder instant, because there is no such field.
    //
    //   * events starting inside the lookahead — covers every non-recurring one;
    //   * recurring parents, which start anywhere and are expanded below.
    const fromDay = dayString(now - 2 * 86_400_000);
    const toDay = dayString(now + MAX_LEAD_DAYS * 86_400_000);

    const [plain, recurring] = await Promise.all([
      db.collection("events")
        .where("date", ">=", `${fromDay}T00:00:00.000Z`)
        .where("date", "<=", `${toDay}T23:59:59.999Z`)
        .limit(2000).get(),
      db.collection("events").where("recurrenceRule", "!=", null).limit(2000).get(),
    ]);

    const byId = new Map<string, EventDoc & Record<string, unknown>>();
    for (const d of [...plain.docs, ...recurring.docs]) {
      byId.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) } as EventDoc & Record<string, unknown>);
    }
    const docs = [...byId.values()];
    if (docs.length === 0) return;

    const occurrences = expandInWindow(docs, fromDay, toDay)
      .map((o) => ({ source: o.source as EventDoc & Record<string, unknown>, day: o.day }));

    // Owners' zones, for the all-day fallback. One read per distinct owner, not per event.
    const ownerIds = [...new Set(docs.map((d) => (typeof d.ownerId === "string" ? d.ownerId : "")).filter(Boolean))];
    const ownerZones: Record<string, string | undefined> = {};
    if (ownerIds.length > 0) {
      const snaps = await db.getAll(...ownerIds.slice(0, 400).map((u) => db.doc(`users/${u}`)));
      snaps.forEach((s, i) => { ownerZones[ownerIds[i]] = s.data()?.timezone as string | undefined; });
    }

    const due = dueIn(occurrences, ownerZones, from, now);
    if (due.length === 0) return;

    // ── send, at most once each ─────────────────────────────────────────────
    for (const d of due) {
      const logRef = db.doc(`reminder_log/${d.key}`);
      try {
        // `create` throws if the document exists. That is the dedupe: the first run to get here
        // wins, and a second one stops before sending rather than having to coordinate.
        await logRef.create({ eventId: d.eventId, day: d.day, at: d.at, sentAt: admin.firestore.FieldValue.serverTimestamp() });
      } catch {
        continue; // already sent by an overlapping run
      }

      try {
        await notify({
          userIds: d.recipients,
          // Nobody caused this; the schedule did. An empty `createdBy` also means `notify` drops
          // nobody from the recipients — the owner is meant to be reminded of their own event.
          createdBy: "",
          type: "reminder",
          titleKey: "notifReminder",
          titleParam: d.title,
          bodyKey: "notifReminderAt",
          param: d.clock,
          data: { route: "/", eventId: d.eventId },
        });
      } catch (err) {
        console.error("reminder: could not deliver", d.key, err);
      }
    }

    // ── housekeeping ────────────────────────────────────────────────────────
    const cutoff = dayString(now - LOG_TTL_DAYS * 86_400_000);
    const stale = await db.collection("reminder_log").where("day", "<", cutoff).limit(400).get();
    if (!stale.empty) {
      const batch = db.batch();
      stale.docs.forEach((s) => batch.delete(s.ref));
      await batch.commit();
    }
  },
);
