// src/utils/eventForm.ts
//
// What the event form's two date fields and two clock fields mean.
//
// The form asks a person for an end DATE, because "until Thursday" is what a person means. The
// event stores an OFFSET in whole days, because that is what a recurring occurrence can inherit
// unchanged. This is the join, and it lives here rather than inside AddEventModal for one reason:
// that component is behind a login, so every gate in this repo can be green while it is broken.
// Twice today a decision left inside a component turned out to be wrong in a way no test could see.
//
// Client-only on purpose — not copied to functions/src, which would carry form concerns into the
// server bundle. The refusal itself is `spanProblem`, which IS shared, so the form and the server
// cannot come to different conclusions about the same event.

import { dayOffsetBetween, spanProblem } from './eventTime';

export type SpanIssue = 'ends-before-start' | 'end-without-start' | 'offset';

export interface FormSpan {
  /** The `endDayOffset` to store. Zero whenever there is nothing valid to store. */
  offset: number;
  /** Why this cannot be saved, or null. */
  issue: SpanIssue | null;
}

/** The i18n key for each refusal, so the form and its test name the same string. */
export const SPAN_MESSAGE_KEY: Record<SpanIssue, string> = {
  'ends-before-start': 'eventEndBeforeStart',
  'end-without-start': 'eventEndWithoutStart',
  offset: 'eventEndTooLong',
};

/**
 * Read the form's four fields into what gets written, and what stops it.
 *
 * `showEnd` is the person having asked for an end at all: with it closed, the end fields are
 * ignored entirely rather than half-remembered, so closing the row is a complete answer.
 */
export function formSpan(
  args: { startDay: string; endDay: string; startTime: string; endTime: string; showEnd: boolean },
): FormSpan {
  const { startDay, endDay, startTime, endTime, showEnd } = args;
  if (!showEnd) return { offset: 0, issue: null };

  const raw = endDay ? dayOffsetBetween(startDay, endDay) : 0;
  if (endDay && raw === null) {
    // `dayOffsetBetween` refuses an end before the start and one beyond the cap with the same
    // null; the dates themselves say which it was, and the two need different words.
    return { offset: 0, issue: endDay < startDay ? 'ends-before-start' : 'offset' };
  }

  const offset = raw ?? 0;
  const issue = spanProblem({ time: startTime, endDayOffset: offset, endTime }) as SpanIssue | null;
  // An unsavable span stores nothing rather than storing something wrong: the write is blocked
  // either way, and a zero here is the same shape as an event that never had a span.
  return { offset: issue ? 0 : offset, issue };
}
