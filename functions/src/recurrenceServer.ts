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

import { isValidDayOffset, dayPlus } from "./eventTime";
import {
  FREQUENCIES, type Frequency, seriesStartDay, occurrenceDaysInWindow,
} from "./recurrenceCore";

// Re-exported so the readers of this module keep one import. The DEFINITIONS live in the shared
// core now, which the calendar runs byte-for-byte — see recurrenceCore.ts.
export { FREQUENCIES, type Frequency };
/** Frequencies whose whole horizon fits inside 400 days back. */
export const SHORT_FREQUENCIES: readonly Frequency[] = ["daily", "weekly", "monthly"];

export interface EventDoc {
  id: string;
  date?: unknown;
  recurrenceRule?: { frequency?: unknown } | null;
  recurrenceExceptions?: unknown;
  overrideOfParent?: unknown;
  [k: string]: unknown;
}

const DAY_MS = 86_400_000;

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function frequencyOf(ev: EventDoc): Frequency | null {
  const f = ev.recurrenceRule && (ev.recurrenceRule as { frequency?: unknown }).frequency;
  return typeof f === "string" && (FREQUENCIES as readonly string[]).includes(f)
    ? (f as Frequency)
    : null;
}

/** How far back a query must reach to catch every series that can still be running. */
export function lookbackMsFor(freq: Frequency): number {
  return freq === "yearly" ? 5 * 366 * DAY_MS : 400 * DAY_MS;
}

export interface Occurrence {
  /** The parent document, or the standalone event itself. */
  source: EventDoc;
  /** `yyyy-MM-dd`, UTC — the same shape the stored bounds use. */
  day: string;
  /** True when this row came out of a series rather than being a document of its own. */
  virtual: boolean;
}

/**
 * Expand a set of documents into the occurrences that fall inside [fromDay, toDay].
 *
 * `taken` is the set of `parentId|day` pairs already covered by a real override document, so
 * an edited occurrence and its ghost can never both be emitted.
 */
export function expandInWindow(docs: readonly EventDoc[], fromDay: string, toDay: string): Occurrence[] {
  // Keyed by the day the override REPLACES. A new override stores it (`overrideDate`); the dedupe
  // used to use the override's own `date` instead, so a daily occurrence moved from the 22nd to the
  // 23rd suppressed the REAL occurrence on the 23rd — no reminder for it, missing from the digest.
  //
  // An override written BEFORE `overrideDate` existed still keys on its date, deliberately. For
  // that data, "moved onto another occurrence" and "its exception went missing" look identical,
  // and the second is what `digestEvents.test` pins: without this, the edited occurrence AND its
  // ghost both reach the digest. I removed it once, and that test caught it. The price is that a
  // legacy override which was also MOVED can still hide a real occurrence; every override made
  // from now on carries `overrideDate` and cannot.
  const taken = new Set<string>();
  for (const ev of docs) {
    const parent = ev.overrideOfParent;
    if (typeof parent !== "string" || !parent) continue;
    const stored = ev.overrideDate;
    const replaced = typeof stored === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored)
      ? stored
      : typeof ev.date === "string" ? ev.date.slice(0, 10) : null;
    if (replaced) taken.add(`${parent}|${replaced}`);
  }

  const out: Occurrence[] = [];
  for (const ev of docs) {
    if (typeof ev.date !== "string" || !ev.date) continue;
    const freq = frequencyOf(ev);

    // The span is whole days after the start; an event is IN the window if any of its days is.
    // Read once per document and applied to every occurrence — it is relative, so each inherits
    // it unchanged. The window test used to be on the first day only, which hid an event that
    // started yesterday and is still running today.
    const spanDays = isValidDayOffset((ev as Record<string, unknown>).endDayOffset)
      ? ((ev as Record<string, unknown>).endDayOffset as number)
      : 0;
    const lastDayOf = (day: string) => dayPlus(day, spanDays) ?? day;

    if (!freq) {
      const day = ev.date.slice(0, 10);
      if (lastDayOf(day) >= fromDay && day <= toDay) out.push({ source: ev, day, virtual: false });
      continue;
    }

    // The SAME days the calendar shows, from the shared core: computed from the series start in
    // UTC day labels. This loop used to step in UTC from the PREVIOUS occurrence while the calendar
    // stepped the local clock, and the two disagreed on moved series, west of Greenwich, and every
    // monthly or yearly series whose day a short month clamped.
    const startDay = seriesStartDay(ev.date);
    if (!startDay) continue;
    const exceptions = new Set(
      (Array.isArray(ev.recurrenceExceptions) ? ev.recurrenceExceptions : [])
        .filter((x): x is string => typeof x === "string")
    );

    for (const day of occurrenceDaysInWindow(startDay, freq, fromDay, toDay, spanDays)) {
      const ms = Date.parse(`${day}T00:00:00.000Z`);
      const suppressed = freq === "daily"
        ? exceptions.has(day)
        : exceptions.has(day) ||
          exceptions.has(dayKey(ms - DAY_MS)) ||
          exceptions.has(dayKey(ms + DAY_MS));
      if (!suppressed && !taken.has(`${ev.id}|${day}`)) {
        out.push({ source: ev, day, virtual: true });
      }
    }
  }

  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}
