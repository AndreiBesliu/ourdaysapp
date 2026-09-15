// src/utils/spanLabel.ts
//
// The words next to a block of a multi-day event.
//
// A block on the second day of a party that ran past midnight used to print the party's START
// time — "22:00" — as if it began at ten tonight. The slice knows better: it knows whether the
// event began earlier and whether it goes on. This turns that knowledge into a short label, the
// same one in the day timeline, the day list and the details view, so the three cannot disagree.
//
//   ◂ → 02:00     began on an earlier day, ends today at 02:00
//   22:00 ▸       starts today at 22:00, goes on tomorrow
//   ◂ … ▸         runs through the whole of today
//   09:00 – 11:30 starts and ends today
//   09:00         starts today, no end recorded (drawn at a nominal length)
//
// Glyphs rather than words on purpose: they need no translation, and the app has six languages.
// Pure: no React.

import { displayTime, displayEndTime, spanOf, isValidTime } from './eventTime';

export interface ClockLabel {
  text: string;
  /** The event's zone, when it is not the reader's — named once, after the clocks. */
  zoneNote: string | null;
}

type SpanEvent = {
  date?: unknown; time?: unknown; timezone?: unknown; endDayOffset?: unknown; endTime?: unknown;
};

/** The clock label for ONE day of an event, `dayKey` being that day as `yyyy-MM-dd`. */
export function spanClockLabel(ev: SpanEvent, dayKey: string, readerZone: string): ClockLabel | null {
  if (!isValidTime(ev.time)) return null;
  const span = spanOf(ev);
  if (!span) return null;
  const start = displayTime(ev, readerZone);
  if (!start) return null;
  const end = isValidTime(ev.endTime) ? displayEndTime(ev, readerZone) : null;

  const before = dayKey > span.startDay;
  const after = dayKey < span.endDay;
  const zoneNote = start.zoneNote ?? end?.zoneNote ?? null;

  if (before && after) return { text: '◂ … ▸', zoneNote };
  if (before) return { text: end ? `◂ → ${end.text}` : '◂', zoneNote };
  if (after) return { text: `${start.text} ▸`, zoneNote };
  if (end) return { text: `${start.text} – ${end.text}`, zoneNote };
  return { text: start.text, zoneNote };
}

/**
 * The whole extent of an event, for a details view where the reader wants all of it at once.
 * Days come back as `yyyy-MM-dd` so the caller formats them in its own locale.
 */
export function spanRangeLabel(ev: SpanEvent, readerZone: string): {
  startDay: string; endDay: string; sameDay: boolean; clocks: string | null; zoneNote: string | null;
} | null {
  const span = spanOf(ev);
  if (!span) return null;
  const start = isValidTime(ev.time) ? displayTime(ev, readerZone) : null;
  const end = start && isValidTime(ev.endTime) ? displayEndTime(ev, readerZone) : null;
  const sameDay = span.offset === 0;
  const clocks = !start ? null
    : !end ? start.text
    : sameDay ? `${start.text} – ${end.text}`
    : `${start.text} → ${end.text}`;
  return {
    startDay: span.startDay, endDay: span.endDay, sameDay, clocks,
    zoneNote: start?.zoneNote ?? end?.zoneNote ?? null,
  };
}
