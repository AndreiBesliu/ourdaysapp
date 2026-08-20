import { describe, it, expect, afterEach } from 'vitest'
import { dayKeyOf, dayRangePeriod, daysInMonth, monthPeriod, periodDays } from './period'

// The whole point of this file is the first block. `events.date` is an ISO string compared as
// text, so a period built through a local `Date` shifts by the caller's offset and every
// answer about "March" quietly becomes 2 March – 1 April.

const withTZ = (tz: string, fn: () => void) => {
  const before = process.env.TZ
  process.env.TZ = tz
  try { fn() } finally { process.env.TZ = before }
}

afterEach(() => { /* TZ is restored by withTZ itself */ })

describe('a period is built from literals, so it cannot move with the caller', () => {
  it('is byte-identical in New York and in Bucharest', () => {
    let ny: ReturnType<typeof monthPeriod> | null = null
    let buc: ReturnType<typeof monthPeriod> | null = null
    withTZ('America/New_York', () => { ny = monthPeriod(2026, 3) })
    withTZ('Europe/Bucharest', () => { buc = monthPeriod(2026, 3) })
    expect(ny).toEqual(buc)
    expect(ny!.from).toBe('2026-03-01T00:00:00.000Z')
    expect(ny!.to).toBe('2026-03-31T23:59:59.999Z')
  })

  it('and the lower bound is BELOW the value the app actually stores for the 1st', () => {
    // The app writes `new Date('2026-03-01').toISOString()` = midnight UTC. Built the local
    // way, a New York caller's bound would be 05:00Z and would exclude it.
    const p = monthPeriod(2026, 3)
    expect('2026-03-01T00:00:00.000Z' >= p.from).toBe(true)
    expect('2026-03-01T00:00:00.000Z' <= p.to).toBe(true)
  })

  it('and the 1st of the NEXT month is outside it', () => {
    const p = monthPeriod(2026, 3)
    expect('2026-04-01T00:00:00.000Z' > p.to).toBe(true)
  })
})

describe('month lengths, including the leap rule', () => {
  it('February', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29) // divisible by 400
    expect(daysInMonth(1900, 2)).toBe(28) // divisible by 100 but not 400
  })

  it('a leap February ends on the 29th, not the 28th', () => {
    expect(monthPeriod(2024, 2).toDay).toBe('2024-02-29')
  })

  it('a month out of range is clamped rather than producing a nonsense bound', () => {
    expect(monthPeriod(2026, 13).fromDay).toBe('2026-12-01')
    expect(monthPeriod(2026, 0).fromDay).toBe('2026-01-01')
  })
})

describe('an explicit range refuses rather than guessing', () => {
  it('takes two well-formed days', () => {
    expect(dayRangePeriod('2026-03-05', '2026-03-09')).toEqual({
      from: '2026-03-05T00:00:00.000Z',
      to: '2026-03-09T23:59:59.999Z',
      fromDay: '2026-03-05',
      toDay: '2026-03-09',
    })
  })

  it('refuses a malformed day, an inverted range, and anything that is not a day', () => {
    // Guessing here would answer about a different period than the one asked about, which is
    // the failure the caller could never see.
    expect(dayRangePeriod('2026-3-5', '2026-03-09')).toBeNull()
    expect(dayRangePeriod('2026-03-09', '2026-03-05')).toBeNull()
    expect(dayRangePeriod('yesterday', '2026-03-09')).toBeNull()
    expect(dayRangePeriod('', '')).toBeNull()
  })

  it('a single day is a valid range', () => {
    const p = dayRangePeriod('2026-03-05', '2026-03-05')
    expect(p).not.toBeNull()
    expect(periodDays(p!)).toBe(1)
  })
})

describe('counting and day-keying', () => {
  it('counts inclusively, across a month boundary and a leap day', () => {
    expect(periodDays(monthPeriod(2026, 3))).toBe(31)
    expect(periodDays(monthPeriod(2024, 2))).toBe(29)
    expect(periodDays(dayRangePeriod('2026-02-27', '2026-03-02')!)).toBe(4)
  })

  it('a day key is the stored string sliced, not a Date round trip', () => {
    expect(dayKeyOf('2026-03-14T00:00:00.000Z')).toBe('2026-03-14')
    expect(dayKeyOf('')).toBe('')
    expect(dayKeyOf(undefined as unknown as string)).toBe('')
  })
})
