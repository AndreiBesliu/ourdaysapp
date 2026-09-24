import { isValidDayOffset, localDayKey } from './eventTime';
import { dayAsLocalDate } from './dayLabel';
import {
  seriesStartDay, horizonEndDay, occurrenceDaysInWindow, isFrequency,
} from './recurrenceCore';

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

/**
 * The last day a series repeats until, as a LOCAL Date for a local formatter; null when the start
 * is not a day label.
 *
 * Display only ("repeats until …"). It reads the same horizon the expansion stops at, from
 * `recurrenceCore`, so the date the form promises is the date the calendar actually ends on.
 *
 * It takes a day LABEL (`yyyy-MM-dd`), never a Date. Until 24.09.2026 it took a Date and read its
 * UTC day — right for the form, which passed `new Date('yyyy-MM-dd')` (midnight UTC), and a day
 * EARLY for the series panel, which passed a LOCAL midnight: in Bucharest summer that is 21:00 UTC
 * the evening before. Found by the pre-deploy review, the same day the version with a Date shipped
 * to no one. A label has no zone to get wrong. The panel passes `seriesStartDay(ev.date)`.
 */
export function getRecurrenceEndDate(startDay: string | null, frequency: RecurrenceRule['frequency']): Date | null {
  const end = startDay && isFrequency(frequency) ? horizonEndDay(startDay, frequency) : null;
  return end ? dayAsLocalDate(end) : null;
}

/**
 * Returns a human-readable label for the recurrence frequency.
 */
/**
 * The i18n KEY for a frequency, not the word.
 *
 * It returned 'Daily' / 'Weekly' / 'Monthly' / 'Yearly' until 19.09 — English, from inside a pure
 * module that cannot know the language, printed in three places including the repeat dropdown of
 * the busiest form in the app. A function that returns a word decides the language for every
 * caller; one that returns a key leaves that where the language is known.
 */
export function getFrequencyKey(frequency: RecurrenceRule['frequency']): string {
  switch (frequency) {
    case 'daily':   return 'freqDaily';
    case 'weekly':  return 'freqWeekly';
    case 'monthly': return 'freqMonthly';
    case 'yearly':  return 'freqYearly';
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
    const startDay = seriesStartDay(event.date);
    // A rule the app does not know, or a start it cannot read, is shown as the plain event it
    // is — the server's `frequencyOf` does the same, so the two still agree.
    if (!isFrequency(frequency) || !startDay) {
      result.push(event);
      continue;
    }

    const exceptions: string[] = event.recurrenceExceptions || [];
    // Relative span: every occurrence inherits it verbatim through `...event`.
    const spanDays = isValidDayOffset(event.endDayOffset) ? event.endDayOffset : 0;

    // Day LABELS throughout — see recurrenceCore.ts. The window arrives as local Dates (a
    // calendar's cells), and a local Date's label is its local calendar day.
    const days = occurrenceDaysInWindow(
      startDay, frequency, localDayKey(windowStart), localDayKey(windowEnd), spanDays,
    );

    for (const dateStr of days) {
      // Skip exceptions (deleted or overridden occurrences)
      if (exceptions.includes(dateStr)) continue;
      result.push({
        ...event,
        id: `${event.id}_${dateStr}`,
        // Midnight UTC of the occurrence's own label: the stored-day convention every reader uses.
        date: `${dateStr}T00:00:00.000Z`,
        isRecurringInstance: true,
        parentEventId: event.id,
        recurrenceDate: dateStr,
      });
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

  const from = Date.parse(`${occurrenceDay}T00:00:00.000Z`);
  const to = Date.parse(`${newDay}T00:00:00.000Z`);
  const startDay = seriesStartDay(parentDate);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !startDay) return null;

  const deltaDays = Math.round((to - from) / 86_400_000);
  if (deltaDays === 0) return null;
  // In day labels, then back to the stored form. This was `addDays(start, deltaDays)` on the
  // LOCAL clock, which across the March DST change stored 23:00Z — a Wednesday the server read
  // as a Tuesday, so every reminder for the moved series came a day early.
  const moved = new Date(Date.parse(`${startDay}T00:00:00.000Z`) + deltaDays * 86_400_000);
  return `${moved.toISOString().slice(0, 10)}T00:00:00.000Z`;
}
