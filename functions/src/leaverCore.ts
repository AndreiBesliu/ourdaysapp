// functions/src/leaverCore.ts
//
// Somebody who leaves a group, or is taken off it by its owner, comes off the group's events that are
// still to come: as an assignee and as an RSVP (Andrei, 05.10.2026). Before this, leaving only shrank
// `members`, so the person stayed named and:
//   * every later edit of the event by anybody, even a checklist tick or an RSVP, was refused —
//     `namedAreInGroup` (firestore.rules) wants everyone named to be a member, on the RESULTING
//     document;
//   * they kept reading it (being named is a read grant) and kept getting its reminders.
//
// What Andrei decided, and so what this does NOT do:
//   * events that are over keep the name: history stays as it was (they also stay frozen to edits);
//   * events the person CREATED stay theirs (`ownerId` untouched);
//   * `hiddenFrom` stays: a surprise hidden from them must stay hidden if they come back;
//   * deleting a group changes nothing here.
//
// Pure, no Firestore: groupLeave.ts reads and writes, this decides. `src/utils/leaverCore.test.ts`.

import { dayPlus, isValidDayOffset } from "./eventTime";
import { lastOccurrenceDay, seriesStartDay } from "./recurrenceCore";
import { frequencyOf, type EventDoc } from "./recurrenceServer";

/** The assistant may be named on any group event (the rules allow it); it is never a member. */
export const AI_ASSIGNEE = "ai_assistant";

const DAY_LABEL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The last day the event still happens on, as a `yyyy-MM-dd` label: its own day plus its span, or
 * for a series the day its last occurrence ends. Null when the date cannot be read.
 */
export function lastDayOf(ev: Record<string, unknown>): string | null {
  const span = isValidDayOffset(ev.endDayOffset) ? ev.endDayOffset : 0;
  if (typeof ev.date !== "string") return null;
  const freq = frequencyOf(ev as EventDoc);
  if (!freq) {
    const day = ev.date.slice(0, 10);
    return DAY_LABEL.test(day) ? dayPlus(day, span) : null;
  }
  const start = seriesStartDay(ev.date);
  const last = start ? lastOccurrenceDay(start, freq, (ev.recurrenceRule as { onlyOn?: unknown }).onlyOn) : null;
  return last ? dayPlus(last, span) : null;
}

/**
 * The calendar day it still is in the westernmost time zone (UTC−12) at `nowMs`. Event days are
 * calendar days with no zone, so an event is over only once its last day is over EVERYWHERE: in
 * Bucharest, yesterday's dinner still counts until 14:00 or 15:00, because in American Samoa (UTC−11)
 * it is still yesterday. A whole day of slack on the UTC date was tried first; at night it also took the name
 * off the day before yesterday, which Andrei decided keeps it (review, 05.10.2026).
 */
export function earliestTodayOf(nowMs: number): string {
  return new Date(nowMs - 12 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Is the event still to come, given the day `earliestToday` (earliestTodayOf)? An unreadable date
 * counts as to come: leaving a stale name frozen on an event is the failure this exists to stop.
 */
export function stillToCome(ev: Record<string, unknown>, earliestToday: string): boolean {
  const last = lastDayOf(ev);
  return last === null || last >= earliestToday;
}

export interface LeaverPlan {
  /** Out of `assigneeIds`. */
  unassign: string[];
  /** The older single field, when it named one of them: the next one left on the list, or null. */
  assigneeId?: string | null;
  /** Keys out of `rsvps`. */
  rsvps: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

/**
 * What to take off one event of the group, given who is in the group NOW. Null when nothing: the
 * event is over, or it names nobody who left. Everybody named who is not a member goes, not only the
 * person whose leaving fired this: so a run that failed is made good by the next one, and somebody
 * who came back before it ran is not touched.
 */
export function leaverPlan(ev: Record<string, unknown>, members: ReadonlySet<string>, earliestToday: string): LeaverPlan | null {
  if (!stillToCome(ev, earliestToday)) return null;
  const stays = (u: string) => u === AI_ASSIGNEE || members.has(u);
  const ids = strings(ev.assigneeIds);
  const unassign = [...new Set(ids.filter((u) => !stays(u)))];
  const one = ev.assigneeId;
  const assigneeGoes = typeof one === "string" && !!one && !stays(one);
  const rsvps = ev.rsvps && typeof ev.rsvps === "object" && !Array.isArray(ev.rsvps)
    ? Object.keys(ev.rsvps).filter((u) => !stays(u))
    : [];
  if (!unassign.length && !assigneeGoes && !rsvps.length) return null;
  const plan: LeaverPlan = { unassign, rsvps };
  // The app keeps the single field as the list's first; the first who is left, as account deletion does.
  if (assigneeGoes) plan.assigneeId = ids.find(stays) ?? null;
  return plan;
}
