// src/utils/dayLabel.ts
//
// Printing a stored day without moving it.
//
// ── The trap ──────────────────────────────────────────────────────────────────────────────
//
// A date is stored as `yyyy-MM-ddT00:00:00.000Z` and read back in UTC by `dayOf`, so the day
// somebody typed and the day the app stores are the same everywhere. Nothing is wrong going IN.
//
// Going OUT is where it moves. `format` from date-fns renders an instant in the READER's zone,
// and west of Greenwich midnight UTC is the evening before — so `format(new Date(ev.date), 'd MMM')`
// prints the previous day. Latent in Bucharest, which is UTC+, and therefore invisible to everyone
// who works on this: the bug was on the roadmap from 26.05 and nobody could see it here.
//
// Building a local Date out of the day's own three numbers sidesteps it. Local midnight of a
// calendar day formats as that calendar day, in every zone, with no conversion to get wrong.
//
// ── Why it lives here and not in `eventTime.ts` ───────────────────────────────────────────
//
// `eventTime.ts` exists TWICE, byte-identical, once for the app and once for `functions/` — the
// scheduler has to answer "when does this start" exactly as the client does, and
// `eventTimeServerCopy.test.ts` refuses any divergence. It is a model of when things happen.
//
// This is presentation: it takes a day and hands back something a formatter can print. The server
// has no reader and no reader's zone, so putting it there would mean a second copy of code one
// runtime can never call, plus a functions deploy every time the wording changes. Keeping the
// shared file about the model is what keeps the byte-identity rule cheap enough to obey.

import { dayOf } from './eventTime';

/**
 * A `yyyy-MM-dd` day as a LOCAL Date, for handing to a local formatter.
 *
 * `null` for anything unparseable, so no caller can accidentally print the words "Invalid Date"
 * at somebody — which is what the fallback in the event details used to do, in six languages.
 */
export function dayAsLocalDate(day: unknown): Date | null {
  if (typeof day !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const out = new Date(y, mo - 1, d);
  // Rejects 2026-02-31, which `new Date` rolls forward to 3 March without complaining. A corrupt
  // date field should not come back as a different, plausible-looking day.
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) return null;
  return out;
}

/** The same, straight from an event's stored `date`. */
export function eventDayAsLocalDate(dateIso: unknown): Date | null {
  return typeof dateIso === 'string' ? dayAsLocalDate(dayOf(dateIso)) : null;
}
