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
// Events have a start and no end: there is no `endTime` field yet. Every block is therefore drawn
// at a nominal length, and that is a DISPLAY choice rather than data — nothing here is written
// back, so adding a real end time later changes this file and nothing else.
//
// Pure: no React, no Firestore.

import { isValidTime, isValidZone, startInstant } from './eventTime';

/** How long a block is drawn when the event has no end time. Display only. */
export const NOMINAL_MINUTES = 60;

export interface DayEvent {
  id?: string;
  title?: unknown;
  date?: unknown;
  time?: unknown;
  timezone?: unknown;
  [key: string]: unknown;
}

export interface PlacedEvent<T extends DayEvent = DayEvent> {
  event: T;
  /** Minutes from midnight in the READER's zone. */
  startMin: number;
  endMin: number;
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
  if (!isValidTime(ev.time)) return null;

  const evZone = isValidZone(ev.timezone) ? (ev.timezone as string) : null;

  // No zone recorded: the wall clock IS the answer. Every event saved before the clock shipped is
  // in this branch, and converting it from an assumed zone would slide it across the day.
  if (!evZone || !isValidZone(readerZone) || evZone === readerZone) {
    const [h, m] = (ev.time as string).split(':').map(Number);
    return h * 60 + m;
  }

  const at = startInstant({ date: `${day}T00:00:00.000Z`, time: ev.time, timezone: evZone }, evZone);
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

/**
 * Lay a day out.
 *
 * `day` is `yyyy-MM-dd` as stored (UTC). `readerZone` is who is looking.
 */
export function layoutDay<T extends DayEvent>(
  events: readonly T[], day: string, readerZone: string,
): DayLayout<T> {
  const allDay: T[] = [];
  const rows: { event: T; startMin: number; endMin: number }[] = [];

  for (const ev of events) {
    const startMin = minutesInDay(ev, day, readerZone);
    if (startMin === null) { allDay.push(ev); continue; }
    rows.push({
      event: ev,
      startMin,
      // Clamped so a late event does not draw past the bottom of the grid.
      endMin: Math.min(24 * 60, startMin + NOMINAL_MINUTES),
    });
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
