// functions/src/period.ts
//
// ⚠ BYTE-IDENTICAL COPY of `src/utils/period.ts` below the header, and it must stay that way.
// Same reason as `functions/src/warlordCombat/`: the server runs a different runtime and a
// different tsconfig, and `functions/` cannot import from `src/`. The tests live on the client
// side (`src/utils/period.test.ts`, run by `npm test`), so a change here that is not mirrored
// there is a change nothing checks.
//   Verify with: diff -q src/utils/period.ts functions/src/period.ts   (ignoring this header)
//
// Turning "March" into the two strings a Firestore range query can use.
//
// ── Why this is not `startOfMonth(...).toISOString()` ──────────────────────────────────
//
// `events.date` is an ISO STRING, and it is queried by string comparison. The values the app
// writes are midnight UTC — `new Date('2026-03-01').toISOString()`. So the bounds have to be
// built from the year/month/day as LITERAL TEXT, never by taking a local `Date` through
// `toISOString()`.
//
// Take the local route and, for a caller in America/New_York, `startOfMonth(March).toISOString()`
// is `2026-03-01T05:00:00.000Z`. The event stored at `2026-03-01T00:00:00.000Z` falls below the
// lower bound and the 1st of April climbs in above it. Every answer about "March" would
// silently be the 2nd of March to the 1st of April — and a double-booking on the 1st would be
// invisible in the very question the feature exists to answer.
//
// There is a test in `npm test` that runs this under two timezones and asserts identical
// strings. It is the cheapest guard in the feature.
//
// ── Why the echo says no timezone ──────────────────────────────────────────────────────
//
// The stored value is a DATE wearing an instant's clothes. Saying "UTC" would claim a
// precision the data does not have, so the range is echoed as "1–31 March" and nothing more.
//
// Pure: no I/O, no clock, no locale lookup. A timezone never arrives from the client — it
// would be a client lever over the server's own visibility maths.

export interface Period {
  /** Inclusive lower bound, as the exact string a range query compares against. */
  from: string
  /** Inclusive upper bound. */
  to: string
  /** `yyyy-MM-dd` for the first and last day, for labelling and day-keying. */
  fromDay: string
  toDay: string
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** Days in a month, with the leap rule spelled out rather than inferred from a Date. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

function bounds(fromDay: string, toDay: string): Period {
  return {
    from: `${fromDay}T00:00:00.000Z`,
    to: `${toDay}T23:59:59.999Z`,
    fromDay,
    toDay,
  }
}

/** The whole of one month. `month` is 1-12. */
export function monthPeriod(year: number, month: number): Period {
  const m = Math.min(12, Math.max(1, Math.floor(month)))
  const y = Math.floor(year)
  return bounds(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`)
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * An explicit range, given as two `yyyy-MM-dd` days. Returns `null` when either day is
 * malformed or the range is inverted — the caller refuses rather than guessing, because a
 * guessed range would silently answer about a different month than the one asked about.
 */
export function dayRangePeriod(fromDay: string, toDay: string): Period | null {
  if (!DAY.test(fromDay) || !DAY.test(toDay)) return null
  if (fromDay > toDay) return null
  return bounds(fromDay, toDay)
}

/** How many days a period covers, for the budget. Counted from the literals, not from Dates. */
export function periodDays(p: Period): number {
  const [fy, fm, fd] = p.fromDay.split('-').map(Number)
  const [ty, tm, td] = p.toDay.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

/** The day an ISO instant belongs to, for grouping. UTC, because the stored value is UTC. */
export function dayKeyOf(iso: string): string {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : ''
}
