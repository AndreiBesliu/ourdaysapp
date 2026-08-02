import { describe, it, expect, beforeEach } from 'vitest'
import { planTicks, humanDuration, mmss } from './tick'
import { GameConfig, DEFAULT_TICK } from './config'

const MIN = 60 * 1000
const TICK = 5 * MIN
const T0 = 1_700_000_000_000 // fixed epoch; nothing here reads the real clock

beforeEach(() => GameConfig.init(null))

describe('planTicks — the live case', () => {
  it('counts down inside a window and grants nothing', () => {
    const p = planTicks(T0 + 2 * MIN, T0, TICK, 24)
    expect(p.due).toBe(0)
    expect(p.grant).toBe(0)
    expect(p.remainingMs).toBe(3 * MIN)
    expect(p.anchor).toBe(T0) // unchanged
  })

  it('grants exactly one day when one window has passed, phase-locked', () => {
    const p = planTicks(T0 + TICK + 1200, T0, TICK, 24)
    expect(p.grant).toBe(1)
    // after the day runs, the anchor advances by TICK and lands 1200ms ago —
    // the overshoot is carried, not thrown away
    expect(p.anchor + TICK).toBe(T0 + TICK)
    expect(p.remainingMs).toBe(TICK - 1200)
  })

  it('never drifts: 100 consecutive windows keep the original phase', () => {
    let anchor = T0
    for (let i = 1; i <= 100; i++) {
      const p = planTicks(T0 + i * TICK + 700, anchor, TICK, 24)
      expect(p.grant).toBe(1)
      anchor = p.anchor + TICK
    }
    expect(anchor).toBe(T0 + 100 * TICK)
  })
})

// This is the reported bug: play to day 159, leave, come back — the day must move.
describe('planTicks — returning after an absence', () => {
  it('credits every whole window spent away', () => {
    const p = planTicks(T0 + 40 * MIN, T0, TICK, 24)
    expect(p.due).toBe(8)
    expect(p.grant).toBe(8)
    expect(p.forfeited).toBe(0)
  })

  it('a visit shorter than one window still advances the day on the next visit', () => {
    // Three 1-minute visits with 1 minute between them: 5 real minutes total.
    let anchor = T0
    for (const t of [T0 + 1 * MIN, T0 + 3 * MIN]) {
      expect(planTicks(t, anchor, TICK, 24).grant).toBe(0) // too soon, nothing granted
    }
    const third = planTicks(T0 + 5 * MIN, anchor, TICK, 24)
    expect(third.grant).toBe(1) // the elapsed time was NOT discarded by the visits
    anchor = third.anchor + TICK
    expect(anchor).toBe(T0 + TICK)
  })

  it('caps a long absence and forfeits the excess instead of banking it', () => {
    const away = 300 * TICK
    const p = planTicks(T0 + away, T0, TICK, 24)
    expect(p.due).toBe(300)
    expect(p.grant).toBe(24)
    expect(p.forfeited).toBe(276)
    // After the 24 granted days the anchor sits at `now`, so re-entering immediately
    // grants nothing more — the forfeited days can never be re-credited.
    const after = p.anchor + 24 * TICK
    expect(after).toBe(T0 + away)
    expect(planTicks(T0 + away, after, TICK, 24).grant).toBe(0)
  })

  it('maxDays 0 means no backlog, but the day you are playing still ticks', () => {
    const p = planTicks(T0 + 40 * MIN, T0, TICK, 0)
    expect(p.due).toBe(8)
    expect(p.grant).toBe(1)
    expect(p.forfeited).toBe(7)
  })
})

describe('planTicks — hostile inputs', () => {
  it('rebases when the anchor is in the future (clock moved backwards)', () => {
    const now = T0
    const p = planTicks(now, T0 + 10 * MIN, TICK, 24)
    expect(p.grant).toBe(0)
    expect(p.anchor).toBe(now)
    expect(p.remainingMs).toBe(TICK)
  })

  it('rebases on a missing or corrupt anchor', () => {
    for (const bad of [NaN, Infinity, undefined as unknown as number]) {
      const p = planTicks(T0, bad, TICK, 24)
      expect(p.anchor).toBe(T0)
      expect(p.grant).toBe(0)
    }
  })

  it('falls back to a 5-minute day when tickMs is nonsense', () => {
    expect(planTicks(T0 + 10 * MIN, T0, 0, 24).grant).toBe(2)
    expect(planTicks(T0 + 10 * MIN, T0, NaN, 24).grant).toBe(2)
  })

  it('treats a negative cap as no backlog rather than as a stopped clock', () => {
    expect(planTicks(T0 + 40 * MIN, T0, TICK, -5).grant).toBe(1)
  })
})

describe('tick config is admin-tunable', () => {
  it('defaults to 5 minutes per day and a 24-day catch-up', () => {
    expect(GameConfig.tick()).toEqual(DEFAULT_TICK)
    expect(GameConfig.tickMs()).toBe(TICK)
  })

  it('accepts an override and rejects garbage', () => {
    GameConfig.init({ tick: { minutesPerDay: 1, maxOfflineDays: 100 } })
    expect(GameConfig.tickMs()).toBe(MIN)
    expect(GameConfig.tick().maxOfflineDays).toBe(100)

    GameConfig.init({ tick: { minutesPerDay: 0, maxOfflineDays: -3 } })
    expect(GameConfig.tickMs()).toBe(TICK) // 0 is below the floor → default
    expect(GameConfig.tick().maxOfflineDays).toBe(DEFAULT_TICK.maxOfflineDays)

    GameConfig.init({ tick: { maxOfflineDays: 999999 } })
    expect(GameConfig.tick().maxOfflineDays).toBe(2000) // bounded, can't hang the drain
  })
})

describe('display helpers', () => {
  it('formats the countdown', () => {
    expect(mmss(5 * MIN)).toBe('5:00')
    expect(mmss(61_000)).toBe('1:01')
    expect(mmss(-10)).toBe('0:00')
  })

  it('formats an absence', () => {
    expect(humanDuration(30_000)).toBe('30s')
    expect(humanDuration(45 * MIN)).toBe('45m')
    expect(humanDuration(2 * 60 * MIN)).toBe('2h')
    expect(humanDuration(134 * MIN)).toBe('2h 14m')
  })
})
