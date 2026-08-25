import { describe, it, expect, afterEach } from 'vitest'
import { dayKeyOf, dayRangePeriod, daysInMonth, monthPeriod, periodDays, isRealDay } from './period'

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

describe('a day must exist in the calendar, not merely look like one', () => {
  // `new Date("2026-02-30T00:00:00.000Z")` does not throw — it rolls over to March 2. So a range
  // built from a shape-valid but impossible day answered about a window nobody asked for, and the
  // sources disagreed with each other about which: expenses and chat compare real Timestamps and
  // would have used Mar 2, while events compare ISO strings and would have used the literal
  // "2026-02-30". One question, two windows, and no error anywhere.
  const IMPOSSIBLE = ['2026-02-30', '2026-02-31', '2026-04-31', '2026-06-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']
  for (const day of IMPOSSIBLE) {
    it(`refuses ${day}`, () => {
      expect(isRealDay(day)).toBe(false)
      expect(dayRangePeriod(day, '2026-12-31')).toBeNull()
      expect(dayRangePeriod('2026-01-01', day)).toBeNull()
    })
  }

  it('accepts the leap day in a leap year and refuses it otherwise', () => {
    expect(isRealDay('2024-02-29')).toBe(true)
    expect(isRealDay('2026-02-29')).toBe(false)
    // The century rule, because 1900 was not a leap year and 2000 was.
    expect(isRealDay('1900-02-29')).toBe(false)
    expect(isRealDay('2000-02-29')).toBe(true)
  })

  it('still accepts every ordinary day', () => {
    for (const day of ['2026-01-31', '2026-04-30', '2026-12-31', '2026-02-28']) {
      expect(isRealDay(day), day).toBe(true)
      expect(dayRangePeriod(day, day)).not.toBeNull()
    }
  })

  it('and the rolled-over date can no longer reach a Period', () => {
    // The proof that the refusal matters: this is what used to come back.
    expect(new Date('2026-02-30T00:00:00.000Z').toISOString().slice(0, 10)).toBe('2026-03-02')
    expect(dayRangePeriod('2026-02-01', '2026-02-30')).toBeNull()
  })
})

describe('the two copies of this file agree', () => {
  // `functions/` cannot import from `src/`, so period.ts exists twice and its own header says so:
  // "a change here that is not mirrored there is a change nothing checks". Nothing checked it.
  // Same fence as the combat engine, same enforcement — and, as there, line endings are normalised
  // so a failure is always a real difference rather than a Windows checkout artefact.
  const strip = (s: string) =>
    s.replace(/\r\n/g, '\n')
      // Only the LEADING comment block differs by design: each copy names its own path and the
      // server copy explains the duplication. Everything after the first real line must match.
      .replace(/^(?:\/\/[^\n]*\n|\n)*/, '')
      .replace(/[ \t]+$/gm, '')
      .trimEnd()

  it('below the header, byte for byte', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const client = strip(readFileSync(join(here, 'period.ts'), 'utf8'))
    const server = strip(readFileSync(join(here, '..', '..', 'functions', 'src', 'period.ts'), 'utf8'))
    if (client !== server) {
      const a = client.split('\n'), b = server.split('\n')
      const at = a.findIndex((l, i) => l !== b[i])
      throw new Error(
        `period.ts has DIVERGED between src/utils and functions/src.\n` +
        `First difference at body line ${at + 1}:\n` +
        `  client: ${JSON.stringify(a[at] ?? '<end>')}\n` +
        `  server: ${JSON.stringify(b[at] ?? '<end>')}\n` +
        `The tests only run against the client copy, so the server would be answering about a ` +
        `different window with nothing to say so.`
      )
    }
    expect(client).toBe(server)
  })
})
