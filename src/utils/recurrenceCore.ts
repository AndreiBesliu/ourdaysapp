// recurrenceCore.ts
//
// ONE implementation of recurrence, in day labels, shared byte-for-byte by the calendar
// (`src/utils/recurrenceCore.ts`) and the server (`functions/src/recurrenceCore.ts`) — the server
// copy drives reminders, the daily digest and the log. `recurrenceCoreServerCopy.test.ts` refuses
// any drift between the two, the same way `eventTimeServerCopy.test.ts` guards `eventTime`.
//
// ── What this replaced, measured on 24.09.2026 under Bucharest and New York ─────────────────
//
// There were two implementations, and on several cases both were wrong:
//
//   * The calendar stepped with date-fns on the LOCAL clock and printed each day with a LOCAL
//     formatter, from an instant stored as midnight UTC. West of Greenwich that printed the
//     previous evening: a weekly series from 20 September showed on the 19th, 26th, 3rd, 10th in
//     New York, while the server expanded the 20th, 27th, 4th, 11th.
//   * Both stepped from the PREVIOUS occurrence. A monthly series on the 31st clamped to 28 in
//     February and stayed on the 28th for ever; a yearly one on 29 February did the same from 2029.
//   * Moving a series one week across the March DST change stored 23:00Z (local midnight, moved
//     by the DST hour). The calendar kept showing Wednesdays; the server expanded Tuesdays, so
//     reminders, the digest and the log all came a day early.
//
// ── The model ──────────────────────────────────────────────────────────────────────────────
//
// Events are stored by day label: `date` is midnight UTC of a `yyyy-MM-dd`. Everything here works
// on those labels with UTC calendar arithmetic, where no zone and no DST exists. Occurrence n is
// computed FROM THE SERIES START, never from occurrence n−1, so a clamp in a short month cannot
// carry forward. Rendering a label in the viewer's zone is the caller's job (`dayAsLocalDate`).
//
// Pure, and imports nothing: it has to compile unchanged inside a Cloud Function.

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

const DAY_MS = 86_400_000;

export function isFrequency(f: unknown): f is Frequency {
  return typeof f === 'string' && (FREQUENCIES as readonly string[]).includes(f);
}

function parts(day: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** A label from UTC components; `Date.UTC` normalises an overflowing month or day. */
function label(y: number, month0: number, d: number): string {
  return new Date(Date.UTC(y, month0, d)).toISOString().slice(0, 10);
}

function plusDays(day: string, n: number): string | null {
  const p = parts(day);
  return p ? label(p[0], p[1] - 1, p[2] + n) : null;
}

/** Day `d` of month `month0` (which may overflow into later years), clamped to the month's length. */
function clampedDay(y: number, month0: number, d: number): string {
  const first = new Date(Date.UTC(y, month0, 1));
  const Y = first.getUTCFullYear();
  const M = first.getUTCMonth();
  const last = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  return label(Y, M, Math.min(d, last));
}

/**
 * The first day of a series, from its stored `date`.
 *
 * Normally just the UTC day. The one exception is a start in the last two hours of a UTC day:
 * that is a midnight the old series-move code shifted back by a DST hour (it stepped the LOCAL
 * clock), and it means the NEXT day. Nothing else writes a series start off midnight — the form
 * writes `new Date('yyyy-MM-dd')`, which is midnight UTC — so the window is kept that narrow on
 * purpose: wide enough for a DST hour, too narrow to touch anything else.
 */
export function seriesStartDay(dateIso: unknown): string | null {
  if (typeof dateIso !== 'string') return null;
  const ms = Date.parse(dateIso);
  if (!Number.isFinite(ms)) return null;
  const utcDay = new Date(ms).toISOString().slice(0, 10);
  const intoDay = ms - Date.parse(`${utcDay}T00:00:00.000Z`);
  return intoDay >= DAY_MS - 2 * 3_600_000 ? plusDays(utcDay, 1) : utcDay;
}

/** Occurrence `n` (0 is the start), computed from the START — never from occurrence n−1. */
export function nthOccurrenceDay(startDay: string, freq: Frequency, n: number): string | null {
  const p = parts(startDay);
  if (!p || !Number.isInteger(n) || n < 0) return null;
  const [y, m, d] = p;
  switch (freq) {
    case 'daily': return plusDays(startDay, n);
    case 'weekly': return plusDays(startDay, 7 * n);
    case 'monthly': return clampedDay(y, m - 1 + n, d);
    case 'yearly': return clampedDay(y + n, m - 1, d);
    default: return null;
  }
}

/** The last day a series can produce an occurrence on, inclusive: daily +30 days, weekly +52
 *  weeks, monthly +12 months, yearly +5 years — from the start, as the calendar always capped it. */
export function horizonEndDay(startDay: string, freq: Frequency): string | null {
  const p = parts(startDay);
  if (!p) return null;
  const [y, m, d] = p;
  switch (freq) {
    case 'daily': return plusDays(startDay, 30);
    case 'weekly': return plusDays(startDay, 52 * 7);
    case 'monthly': return clampedDay(y, m - 1 + 12, d);
    case 'yearly': return clampedDay(y + 5, m - 1, d);
    default: return null;
  }
}

/**
 * The occurrence days of a series that touch [fromDay, toDay], in order. `spanDays` is how many
 * days after its first day an occurrence lasts (0 for a one-day event); an occurrence counts when
 * ANY of its days is inside the window, so one that started yesterday and runs today is included.
 */
export function occurrenceDaysInWindow(
  startDay: string, freq: Frequency, fromDay: string, toDay: string, spanDays = 0,
): string[] {
  const end = horizonEndDay(startDay, freq);
  if (!end) return [];
  const span = Number.isInteger(spanDays) && spanDays > 0 ? spanDays : 0;
  const out: string[] = [];
  // The horizon bounds this to at most 53 steps; the cap is the guard against a start that
  // somehow defeats it.
  for (let n = 0; n < 4000; n++) {
    const day = nthOccurrenceDay(startDay, freq, n);
    if (!day || day > end || day > toDay) break;
    const lastDay = plusDays(day, span) ?? day;
    if (lastDay >= fromDay) out.push(day);
  }
  return out;
}
