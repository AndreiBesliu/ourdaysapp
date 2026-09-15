import { addDays, addWeeks, addMonths, addYears, format, isBefore, isAfter } from 'date-fns';
import { isValidDayOffset } from './eventTime';

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

/**
 * Returns the maximum horizon end date for a given frequency, starting from `startDate`.
 */
export function getRecurrenceEndDate(startDate: Date, frequency: RecurrenceRule['frequency']): Date {
  switch (frequency) {
    case 'daily':   return addDays(startDate, 30);
    case 'weekly':  return addWeeks(startDate, 52);
    case 'monthly': return addMonths(startDate, 12);
    case 'yearly':  return addYears(startDate, 5);
  }
}

/**
 * Returns a human-readable label for the recurrence frequency.
 */
export function getFrequencyLabel(frequency: RecurrenceRule['frequency']): string {
  switch (frequency) {
    case 'daily':   return 'Daily';
    case 'weekly':  return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'yearly':  return 'Yearly';
  }
}

/**
 * Advance a date by one step of the given frequency.
 */
function advanceDate(date: Date, frequency: RecurrenceRule['frequency']): Date {
  switch (frequency) {
    case 'daily':   return addDays(date, 1);
    case 'weekly':  return addWeeks(date, 1);
    case 'monthly': return addMonths(date, 1);
    case 'yearly':  return addYears(date, 1);
  }
}

/**
 * Expand recurring events into individual virtual occurrences within [windowStart, windowEnd].
 *
 * Non-recurring events are passed through unchanged.
 * Recurring events produce zero or more virtual occurrences, each tagged with
 * `isRecurringInstance: true` and `parentEventId`.
 *
 * Dates listed in `recurrenceExceptions` are skipped (deleted or overridden).
 */
export function expandRecurringEvents(
  events: any[],
  windowStart: Date,
  windowEnd: Date,
): any[] {
  const result: any[] = [];

  for (const event of events) {
    if (!event.recurrenceRule) {
      // Regular (non-recurring) event — pass through as-is
      result.push(event);
      continue;
    }

    const { frequency } = event.recurrenceRule as RecurrenceRule;
    const exceptions: string[] = event.recurrenceExceptions || [];
    const seriesStart = new Date(event.date);
    const seriesEnd = getRecurrenceEndDate(seriesStart, frequency);
    // The span is RELATIVE (whole days after each occurrence's start), so every occurrence below
    // inherits it verbatim through `...event` and is right by construction. An absolute end date
    // on the parent would have been copied unchanged too — and been wrong for every occurrence but
    // the first. In UTC milliseconds because `current` is a UTC-midnight instant; no DST here.
    const spanMs = (isValidDayOffset(event.endDayOffset) ? event.endDayOffset : 0) * 86_400_000;

    // Walk from the series start, stepping by frequency
    let current = new Date(seriesStart);

    while (!isAfter(current, seriesEnd) && !isAfter(current, windowEnd)) {
      // Emit if any day of the occurrence is inside the window — not only its first day. A
      // two-day occurrence starting the day before the window used to vanish from the window's
      // first day entirely.
      if (!isBefore(new Date(current.getTime() + spanMs), windowStart)) {
        const dateStr = format(current, 'yyyy-MM-dd');

        // Skip exceptions (deleted or overridden occurrences)
        if (!exceptions.includes(dateStr)) {
          result.push({
            ...event,
            id: `${event.id}_${dateStr}`,
            // Midnight UTC of the occurrence's OWN day label, not `current.toISOString()`.
            //
            // `advanceDate` is date-fns, which steps the LOCAL calendar, so from the spring DST
            // change onward `current` drifts to 23:00Z — and the document then contradicted
            // itself: `recurrenceDate` said 30 March while the UTC day of `date` said the 29th.
            // Rendering that compared the raw instant locally happened to agree with the label;
            // anything reading the day out of `date` did not. Measured under Europe/Bucharest:
            // the first five occurrences agree, every one after the change disagrees.
            date: `${dateStr}T00:00:00.000Z`,
            isRecurringInstance: true,
            parentEventId: event.id,
            recurrenceDate: dateStr,
          });
        }
      }

      current = advanceDate(current, frequency);
    }
  }

  return result;
}

/**
 * Where a series should start after an "All events in series" edit.
 *
 * ── The defect this exists to stop ──────────────────────────────────────────────────
 *
 * A series is not a list of dates. It is ONE start date plus a rule, and every occurrence is
 * computed from that start — see `expandRecurringEvents`, which reads `event.date` as the series
 * start. The edit modal pre-fills its date field with the date of the occurrence you opened, and
 * saving with "all" used to write that value straight onto the parent. So opening the September
 * occurrence of a series that began in August and changing nothing but the title MOVED the series
 * to September, and every occurrence before it stopped existing.
 *
 * Measured on the real expander: a weekly series with nine occurrences became three, and any
 * single-occurrence exceptions — which are keyed by date — were orphaned.
 *
 * ── Why this shifts rather than ignoring ────────────────────────────────────────────
 *
 * The obvious fix is to leave the start alone. But then a person who deliberately changes the date
 * while editing the whole series gets nothing, silently — a control wired to nothing, which is the
 * defect this codebase keeps producing. So an unchanged date leaves the series where it is, and a
 * changed one moves the WHOLE series by the same offset, which is what "move the series" means.
 *
 * Returns null when nothing should be written, including when the inputs cannot be trusted:
 * refusing to write is always safe here, and a wrong start silently deletes history.
 */
export function shiftedSeriesStart(
  parentDate: unknown, occurrenceDay: unknown, newDay: unknown,
): string | null {
  if (typeof occurrenceDay !== 'string' || typeof newDay !== 'string') return null;
  // Unchanged: the overwhelmingly common case, and the one that used to destroy the series.
  if (occurrenceDay === newDay) return null;

  const from = new Date(`${occurrenceDay}T00:00:00.000Z`);
  const to = new Date(`${newDay}T00:00:00.000Z`);
  const start = typeof parentDate === 'string' ? new Date(parentDate) : new Date(NaN);
  if ([from, to, start].some((d) => Number.isNaN(d.getTime()))) return null;

  const deltaDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (deltaDays === 0) return null;
  return addDays(start, deltaDays).toISOString();
}
