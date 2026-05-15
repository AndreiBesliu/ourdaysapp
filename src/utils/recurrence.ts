import { addDays, addWeeks, addMonths, addYears, format, isBefore, isAfter } from 'date-fns';

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

    // Walk from the series start, stepping by frequency
    let current = new Date(seriesStart);

    while (!isAfter(current, seriesEnd) && !isAfter(current, windowEnd)) {
      // Only emit if within the visible window
      if (!isBefore(current, windowStart)) {
        const dateStr = format(current, 'yyyy-MM-dd');

        // Skip exceptions (deleted or overridden occurrences)
        if (!exceptions.includes(dateStr)) {
          result.push({
            ...event,
            id: `${event.id}_${dateStr}`,
            date: current.toISOString(),
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
