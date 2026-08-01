// src/logic/tick.ts
// The day clock, as pure arithmetic over wall-clock time.
//
// Why this exists: the day used to be scheduled by a single in-memory deadline
// (`nextTickAt`) that was thrown away whenever it had already passed. Closing the app
// for an hour therefore credited ZERO days and restarted the countdown at 5:00 — a
// player whose visits were shorter than one window never advanced a day at all.
//
// The clock is now anchored to `lastTickAt` — the timestamp of the last completed day,
// which lives in the SAVE (so it travels with the kingdom across devices, unlike the old
// device-local key). Everything else is derived from it, so nothing can drift and
// nothing is lost by a remount.

export interface TickPlan {
  due: number // whole day-windows that have elapsed since the anchor
  grant: number // how many of them we will actually run (bounded by maxDays)
  forfeited: number // windows dropped by the bound (told to the player, not hidden)
  anchor: number // anchor to STORE before running `grant` days; each day advances it by tickMs
  remainingMs: number // time left until the next day, for the countdown
}

// `now` and `lastTickAt` are epoch millis. `tickMs` is one day's real duration.
// Bounding `grant` keeps a long absence from resolving hundreds of days of upkeep,
// food and battles in one return; the excess is forfeited rather than banked, and the
// anchor is rebased accordingly so the next visit cannot re-credit it.
export function planTicks(now: number, lastTickAt: number, tickMs: number, maxDays: number): TickPlan {
  const step = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 5 * 60 * 1000
  const cap = Number.isFinite(maxDays) && maxDays >= 0 ? Math.floor(maxDays) : 0

  // A missing or corrupt anchor, or a clock that moved backwards (device time changes,
  // sleep/resume), rebases to now instead of producing a nonsense countdown.
  if (!Number.isFinite(lastTickAt) || lastTickAt > now) {
    return { due: 0, grant: 0, forfeited: 0, anchor: now, remainingMs: step }
  }

  const elapsed = now - lastTickAt
  const due = Math.floor(elapsed / step)
  const remainder = elapsed - due * step
  // The bound applies to the BACKLOG, never to the day you are actually playing:
  // maxDays = 0 means "no offline catch-up", not "the clock stops".
  const grant = Math.min(due, Math.max(1, cap))

  return {
    due,
    grant,
    forfeited: due - grant,
    // After `grant` days the anchor must land on `now - remainder`, so it starts that
    // many windows earlier. When nothing is due this is just the current anchor.
    anchor: now - remainder - grant * step,
    remainingMs: step - remainder,
  }
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

// "2h 14m" / "45m" / "30s" — for the one-line summary after an absence.
export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}
