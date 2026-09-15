// src/utils/dayLayout.ts
// Placing a day's events on an hour grid.
//
// ── What this has to get right ───────────────────────────────────────────────────────
//
// Two things, and both are silent when wrong.
//
// POSITION. An event's stored time is a wall clock in ITS OWN zone — "dinner at 19:00" means 19:00
// where the dinner is. The grid is drawn in the READER's zone. So placement converts, and an event
// with no zone (everything saved before the clock shipped) is placed at its wall clock as written,
// because converting on a guess would move it by hours.
//
// OVERLAP. Two events at the same time must sit side by side, not on top of each other. Drawn one
// over the other, the one underneath is not "hard to see" — it is invisible, and nobody reports a
// bug about an event they cannot see.
//
// ── The duration question ────────────────────────────────────────────────────────────
//
// An event may now END: on the same day at `endTime`, or on a later day (`endDayOffset` whole
// days after the start — see eventTime.ts for why the end is relative). What this file draws is
// the SLICE of the event that falls on one day:
//
//   start day     from the start clock to the end clock, or to 24:00 if the event goes on;
//   middle day    the whole day, 00:00–24:00;
//   end day       from 00:00 to the end clock.
//
// An event with no end clock is drawn at a nominal length when it is a single day, and to the end
// of its last day when it spans several — "no end clock" on a two-day event means "all of the last
// day", not "one hour into it". A slice carries `continuesBefore` / `continuesAfter` so the block
// can say it is a piece of something longer instead of printing a start time that belongs to
// yesterday.
//
// Pure: no React, no Firestore.

import { isValidTime, isValidZone, startInstant, spanOf } from './eventTime';

/** How long a block is drawn when the event has no end time. Display only. */
export const NOMINAL_MINUTES = 60;

export interface DayEvent {
  id?: string;
  title?: unknown;
  date?: unknown;
  time?: unknown;
  timezone?: unknown;
  endDayOffset?: unknown;
  endTime?: unknown;
  [key: string]: unknown;
}

/** The part of an event that falls on one day, in the reader's minutes from midnight. */
export interface DaySlice {
  startMin: number;
  /** Exclusive; 1440 means "to the end of the day". */
  endMin: number;
  /** The event started on an earlier day, so this block is a continuation. */
  continuesBefore: boolean;
  /** The event goes on after this day. */
  continuesAfter: boolean;
}

export interface PlacedEvent<T extends DayEvent = DayEvent> extends DaySlice {
  event: T;
  /** Which column this block sits in, and how many columns its cluster needs. */
  lane: number;
  lanes: number;
}

export interface DayLayout<T extends DayEvent = DayEvent> {
  /** No time at all: drawn in a strip above the grid, not on it. */
  allDay: T[];
  timed: PlacedEvent<T>[];
}

/**
 * Minutes past midnight, in `readerZone`, for an event on `day`.
 *
 * Returns null for an all-day event, and for one whose placement cannot be worked out — a
 * malformed row belongs in the all-day strip, where it is at least visible, rather than at
 * midnight pretending to be a real appointment.
 */
export function minutesInDay(
  ev: DayEvent, day: string, readerZone: string,
): number | null {
  return wallMinutes(ev.time, ev.timezone, day, readerZone);
}

/**
 * Minutes past midnight in `readerZone` for a wall clock written on `day` in `evZone`.
 *
 * The body `minutesInDay` always had, with the clock passed in so the END clock can use it too.
 * It WRAPS rather than clamping — the hour and minute are read back through Intl and the day is
 * discarded — which is the property the grid depends on: a block may sit at an odd hour for a
 * distant reader, but it is always somewhere on the grid. Computing an absolute instant and
 * clamping to the reader's midnight instead made events in another zone vanish into the all-day
 * strip; an adversarial review caught that on four zone pairs before it shipped.
 */
function wallMinutes(
  time: unknown, timezone: unknown, day: string, readerZone: string,
): number | null {
  if (!isValidTime(time)) return null;

  const evZone = isValidZone(timezone) ? (timezone as string) : null;

  // No zone recorded: the wall clock IS the answer. Every event saved before the clock shipped is
  // in this branch, and converting it from an assumed zone would slide it across the day.
  if (!evZone || !isValidZone(readerZone) || evZone === readerZone) {
    const [h, m] = (time as string).split(':').map(Number);
    return h * 60 + m;
  }

  const at = startInstant({ date: `${day}T00:00:00.000Z`, time, timezone: evZone }, evZone);
  if (at === null) return null;

  // Read the instant back in the reader's zone. `en-GB` with hour12 false gives a stable 24-hour
  // pair regardless of the reader's locale, which is what arithmetic needs — the locale belongs to
  // what is DISPLAYED, not to what is measured.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: readerZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const h = get('hour');
  const m = get('minute');
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h % 24) * 60 + m;
}

const DAY_MIN = 24 * 60;

/**
 * The slice of a TIMED event that falls on `day`, in the reader's zone — or null when the event has
 * no clock, no readable span, or (after zone conversion) nothing left on this day.
 *
 * Two branches, like `minutesInDay`: with no zone recorded — or the reader's own — the wall clocks
 * are the answer and no instant is computed, so an event saved before zones existed is never slid
 * across the day by a guess. Otherwise both ends become instants, the reader's day becomes two
 * instants, and the slice is what lies between.
 */
export function sliceInDay(ev: DayEvent, day: string, readerZone: string): DaySlice | null {
  if (!isValidTime(ev.time)) return null;
  const span = spanOf(ev);

  // An unreadable `date` with a usable clock is still an appointment: drawn at its wall clock at a
  // nominal length, exactly as before spans existed. Filing it under "all day" instead would hide
  // the only time it has.
  if (!span) {
    const only = wallMinutes(ev.time, ev.timezone, day, readerZone);
    if (only === null) return null;
    return {
      startMin: only,
      endMin: Math.max(only + 1, Math.min(DAY_MIN, only + NOMINAL_MINUTES)),
      continuesBefore: false,
      continuesAfter: false,
    };
  }

  if (day < span.startDay || day > span.endDay) return null;

  const onStart = day === span.startDay;
  const onEnd = day === span.endDay;
  const hasEnd = isValidTime(ev.endTime);

  // Placement is by wall clock in both branches — see `wallMinutes`. The alternative, absolute
  // instants clamped to the reader's midnight, is more exact and drops events: for a reader one
  // hour away a legacy 00:30 appointment left the grid entirely.
  const startMin = onStart ? wallMinutes(ev.time, ev.timezone, day, readerZone) : 0;
  if (startMin === null) return null;

  let endMin: number;
  if (!onEnd) {
    endMin = DAY_MIN;                                  // the day is entirely inside the event
  } else if (hasEnd) {
    const e = wallMinutes(ev.endTime, ev.timezone, span.endDay, readerZone);
    endMin = e === null ? DAY_MIN : e;
  } else if (span.offset === 0) {
    endMin = Math.min(DAY_MIN, startMin + NOMINAL_MINUTES);
  } else {
    endMin = DAY_MIN;                                  // multi-day with no end clock: all of the last day
  }

  // On a CONTINUATION day a distant reader may have nothing of the event left — the whole of it
  // fell on the previous day where they are. Nothing to draw, and no risk of hiding a legacy
  // event, which is always on its own start day.
  if (!onStart && endMin <= 0) return null;

  return {
    startMin,
    // A same-day end before the start is refused at write time; drawn as a sliver rather than
    // inverted, in case one ever reaches here.
    endMin: Math.max(startMin + 1, Math.min(DAY_MIN, endMin)),
    // Which day of the EVENT this is — a property of the event, not of who is reading it.
    continuesBefore: !onStart,
    continuesAfter: !onEnd,
  };
}

/**
 * Lay a day out.
 *
 * `day` is `yyyy-MM-dd` as stored (UTC). `readerZone` is who is looking. Events are expected to be
 * ON this day already (see `occursOn`); one that is not is skipped, not misplaced.
 */
export function layoutDay<T extends DayEvent>(
  events: readonly T[], day: string, readerZone: string,
): DayLayout<T> {
  const allDay: T[] = [];
  const rows: ({ event: T } & DaySlice)[] = [];

  for (const ev of events) {
    // No clock at all: the all-day strip, where it is visible, rather than at midnight pretending
    // to be a real appointment.
    if (!isValidTime(ev.time)) { allDay.push(ev); continue; }
    const span = spanOf(ev);
    // On a day this event does not cover: the caller already decided, and this respects it
    // silently rather than drawing the event somewhere it is not.
    if (span && (day < span.startDay || day > span.endDay)) continue;
    const slice = sliceInDay(ev, day, readerZone);
    if (slice === null) { allDay.push(ev); continue; }
    rows.push({ event: ev, ...slice });
  }

  rows.sort((a, b) =>
    a.startMin - b.startMin
    || a.endMin - b.endMin
    // A stable tie-break, so two events at the same minute do not swap columns on every render.
    || String(a.event.title ?? '').localeCompare(String(b.event.title ?? ''))
    || String(a.event.id ?? '').localeCompare(String(b.event.id ?? '')));

  // ── lanes ────────────────────────────────────────────────────────────────
  //
  // Greedy: each event takes the first column free at its start time. A CLUSTER is a run of events
  // connected by overlap, and every block in one cluster gets the same `lanes` count — otherwise
  // two side-by-side blocks would be drawn at different widths and stop lining up.
  const placed: PlacedEvent<T>[] = [];
  let cluster: PlacedEvent<T>[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const closeCluster = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((p) => { p.lanes = lanes; });
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const row of rows) {
    // Touching is not overlapping: an event ending at 10:00 and one starting at 10:00 share a
    // boundary, not a minute, and forcing them into two columns would halve both for nothing.
    if (cluster.length > 0 && row.startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= row.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(row.endMin); }
    else laneEnds[lane] = row.endMin;

    clusterEnd = Math.max(clusterEnd, row.endMin);
    cluster.push({ ...row, lane, lanes: 1 });
  }
  if (cluster.length > 0) closeCluster();

  return { allDay, timed: placed };
}

/**
 * The hours worth drawing: a full day, unless everything sits inside a narrower band.
 *
 * A calendar that always shows 00:00–23:00 spends most of its height on hours nobody uses. This
 * keeps at least 07:00–22:00 so the grid does not jump around as events are added, and widens when
 * something genuinely falls outside it.
 */
export function visibleHours(layout: DayLayout): { from: number; to: number } {
  let from = 7;
  let to = 22;
  for (const p of layout.timed) {
    from = Math.min(from, Math.floor(p.startMin / 60));
    // `endMin` is exclusive, so an event ending exactly at the hour does not pull in another row.
    to = Math.max(to, Math.ceil(p.endMin / 60) - (p.endMin % 60 === 0 ? 1 : 0));
  }
  return { from: Math.max(0, from), to: Math.min(23, Math.max(from, to)) };
}
