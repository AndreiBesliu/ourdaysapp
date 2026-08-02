import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TECHS, resolveCatalog, techById, prereqsMet, type TechDef,
} from './catalog'
import { CAPS, emptyModifiers } from './effects'
import {
  aggregate, availableTechs, addBuff, tickBuffs, onBattleWon, onBattleLost,
  onResearchCompleted, BUFF_DEFS, type ActiveBuff,
} from './momentum'

const CAT = DEFAULT_TECHS

describe('catalog integrity', () => {
  it('has unique ids and every prerequisite exists', () => {
    const ids = CAT.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of CAT) {
      for (const r of t.requires) expect(ids).toContain(r)
    }
  })

  it('has no dependency cycles and prerequisites never point up a tier', () => {
    const seen = new Map<string, number>()
    const depth = (id: string, stack: string[] = []): number => {
      if (stack.includes(id)) throw new Error(`cycle: ${[...stack, id].join(' → ')}`)
      if (seen.has(id)) return seen.get(id)!
      const t = techById(CAT, id)!
      const d = t.requires.length === 0 ? 0 : 1 + Math.max(...t.requires.map((r) => depth(r, [...stack, id])))
      seen.set(id, d)
      return d
    }
    for (const t of CAT) expect(() => depth(t.id)).not.toThrow()
    for (const t of CAT) {
      for (const r of t.requires) expect(techById(CAT, r)!.tier).toBeLessThanOrEqual(t.tier)
    }
  })

  it('every tech costs something and takes time', () => {
    for (const t of CAT) {
      expect(t.costCopper).toBeGreaterThan(0)
      expect(t.days).toBeGreaterThan(0)
    }
  })
})

describe('resolveCatalog (admin overrides)', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveCatalog()).toHaveLength(CAT.length)
  })

  it('applies a partial override without changing the id, and can disable or add techs', () => {
    const out = resolveCatalog({
      techs: { ECO_TOOLS: { costCopper: 1, days: 1 } },
      disabled: ['ECO_KILNS'],
      extra: [{
        id: 'X', branch: 'ECONOMY', tier: 1, requires: [], name: 'X', desc: 'x',
        costCopper: 5, costResources: {}, days: 1, effects: { prodMult: 2 },
      } as TechDef],
    })
    const tools = techById(out, 'ECO_TOOLS')!
    expect(tools.costCopper).toBe(1)
    expect(tools.id).toBe('ECO_TOOLS')
    expect(tools.name).toBe('Iron Tools') // untouched fields survive
    expect(techById(out, 'ECO_KILNS')).toBeUndefined()
    expect(techById(out, 'X')).toBeDefined()
  })

  it('ignores overrides for unknown ids', () => {
    expect(() => resolveCatalog({ techs: { NOPE: { days: 99 } } })).not.toThrow()
  })
})

describe('aggregate', () => {
  it('is identity with nothing researched', () => {
    expect(aggregate([], [], CAT)).toEqual(emptyModifiers())
  })

  it('compounds multiplicative effects and sums additive ones', () => {
    // ECO_TOOLS +15% prod, ECO_GUILDS +20% prod → ×1.38
    const m = aggregate(['ECO_TOOLS', 'ECO_GUILDS'], [], CAT)
    expect(m.prodMult).toBeCloseTo(1.15 * 1.2)
    expect(m.buildCostMult).toBeCloseTo(0.85)
    // ARM_ACADEMY: -2 days, +1 slot (additive)
    const a = aggregate(['ARM_ACADEMY'], [], CAT)
    expect(a.trainDaysDelta).toBe(-2)
    expect(a.trainSlotsDelta).toBe(1)
  })

  it('collects unlock ids', () => {
    const m = aggregate(['DOC_ARMORY'], [], CAT)
    expect(m.unlocks).toContain('GRAND_ARMORY')
  })

  it('respects the caps', () => {
    const silly: TechDef[] = Array.from({ length: 20 }, (_, i) => ({
      id: `S${i}`, branch: 'ECONOMY', tier: 1, requires: [], name: 'S', desc: '',
      costCopper: 1, costResources: {}, days: 1, effects: { prodMult: 2, upkeepMult: 0.1 },
    }))
    const m = aggregate(silly.map((t) => t.id), [], silly)
    expect(m.prodMult).toBe(CAPS.prodMult)
    expect(m.upkeepMult).toBe(CAPS.upkeepMult.min)
  })
})

describe('momentum (cross-branch effects)', () => {
  it('a victory boosts BOTH the economy and training XP', () => {
    const buffs = onBattleWon([])
    expect(buffs.map((b) => b.id).sort()).toEqual(['MARTIAL_FERVOUR', 'WAR_SPOILS'])
    const m = aggregate([], buffs, CAT)
    expect(m.prodMult).toBeGreaterThan(1) // economy rippled
    expect(m.trainXpMult).toBeGreaterThan(1) // units in training rippled
  })

  it('a defeat applies a temporary production malus; research completion lifts both', () => {
    expect(aggregate([], onBattleLost([]), CAT).prodMult).toBeLessThan(1)
    const b = aggregate([], onResearchCompleted([]), CAT)
    expect(b.prodMult).toBeGreaterThan(1)
    expect(b.trainXpMult).toBeGreaterThan(1)
  })

  it('re-winning refreshes the buff instead of stacking it', () => {
    let buffs = onBattleWon([])
    buffs = tickBuffs(buffs).buffs // 3 → 2 days
    expect(buffs.find((b) => b.id === 'WAR_SPOILS')!.daysRemaining).toBe(2)
    const before = aggregate([], buffs, CAT).prodMult
    buffs = onBattleWon(buffs)
    expect(buffs.filter((b) => b.id === 'WAR_SPOILS')).toHaveLength(1)
    expect(buffs.find((b) => b.id === 'WAR_SPOILS')!.daysRemaining).toBe(BUFF_DEFS.WAR_SPOILS.days)
    expect(aggregate([], buffs, CAT).prodMult).toBeCloseTo(before) // refreshed, not compounded
  })

  it('buffs expire exactly when their days run out', () => {
    let buffs: ActiveBuff[] = addBuff([], BUFF_DEFS.WAR_SPOILS) // 3 days
    let expired: string[] = []
    for (let i = 0; i < 3; i++) ({ buffs, expired } = tickBuffs(buffs))
    expect(buffs).toHaveLength(0)
    expect(expired).toContain(BUFF_DEFS.WAR_SPOILS.name)
    expect(aggregate([], buffs, CAT)).toEqual(emptyModifiers())
  })
})

describe('availability', () => {
  it('gates on prerequisites and hides queued/researched techs', () => {
    const tier1 = availableTechs(CAT, [], []).map((t) => t.id)
    expect(tier1).toContain('ECO_TOOLS')
    expect(tier1).not.toContain('ECO_KILNS') // needs ECO_TOOLS

    expect(availableTechs(CAT, ['ECO_TOOLS'], []).map((t) => t.id)).toContain('ECO_KILNS')
    expect(availableTechs(CAT, ['ECO_TOOLS'], ['ECO_KILNS']).map((t) => t.id)).not.toContain('ECO_KILNS')
    expect(availableTechs(CAT, ['ECO_TOOLS'], []).map((t) => t.id)).not.toContain('ECO_TOOLS')
  })

  it('a multi-prerequisite tech needs all of them', () => {
    const elite = techById(CAT, 'DOC_ELITE')!
    expect(prereqsMet(elite, ['DOC_ARMORY'])).toBe(false)
    expect(prereqsMet(elite, ['DOC_ARMORY', 'ARM_ACADEMY'])).toBe(true)
  })
})
