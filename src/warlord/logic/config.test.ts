import { describe, it, expect, beforeEach } from 'vitest'
import { GameConfig, DEFAULT_TRAINING } from './config'
import { buildingCostCopper, buildingUpgradeCostCopper, buildingResourceCost, BuildingCostCopper, dailyUpkeepCopper, dailyFoodConsumption } from './economy'
import { batchSlots, batchDurationDays, enqueueBatch, canEnqueue } from './batches'
import { resolveBuffs, BUFF_DEFS, onBattleWon } from './research/momentum'
import { missionPresets, MISSION_PRESETS } from './combat/enemies'

// Every test starts from "no admin overrides" so a leaked override can't fake a pass.
beforeEach(() => GameConfig.init(null))

describe('GameConfig — defaults are untouched when nothing is overridden', () => {
  it('keeps building prices, training and mission presets at their built-in values', () => {
    expect(buildingCostCopper('BLACKSMITH')).toBe(BuildingCostCopper.BLACKSMITH)
    expect(GameConfig.training()).toEqual(DEFAULT_TRAINING)
    expect(missionPresets().BANDIT_RAID).toEqual(MISSION_PRESETS.BANDIT_RAID)
    expect(resolveBuffs(undefined)).toBe(BUFF_DEFS)
  })
})

describe('GameConfig — overrides reach the values the game actually uses', () => {
  it('retunes a building price (and its upgrade price follows)', () => {
    GameConfig.init({ buildingCost: { BLACKSMITH: 1000 } })
    expect(buildingCostCopper('BLACKSMITH')).toBe(1000)
    expect(buildingUpgradeCostCopper('BLACKSMITH', 1)).toBe(600) // 1000 * 0.6 * level 1
  })

  it('merges resource costs instead of replacing the whole map', () => {
    const base = buildingResourceCost('BLACKSMITH')
    GameConfig.init({ buildingResourceCost: { BLACKSMITH: { STONE: 99 } } })
    const merged = buildingResourceCost('BLACKSMITH')
    expect(merged.STONE).toBe(99)
    for (const [k, v] of Object.entries(base)) {
      if (k !== 'STONE') expect(merged[k as keyof typeof merged]).toBe(v)
    }
  })

  it('retunes training length and slot cap', () => {
    GameConfig.init({ training: { baseDays: 12, minDays: 5, maxSlots: 9 } })
    expect(batchDurationDays(1)).toBe(12)
    expect(batchSlots(20)).toBe(9)
  })

  it('retunes upkeep and food', () => {
    const army = () => [{ type: 'LIGHT_ARCHER', buckets: [{ r: 'NOVICE', count: 10, avgXP: 0 }] } as never]
    const upkeepBefore = dailyUpkeepCopper(army())
    expect(upkeepBefore).toBeGreaterThan(0)
    GameConfig.init({ upkeepBase: { LIGHT_ARCHER: 0 } })
    expect(dailyUpkeepCopper(army())).toBe(0)
    GameConfig.init({ foodBase: { LIGHT_ARCHER: 3 } })
    expect(dailyFoodConsumption(army())).toBe(30)
  })

  it('retunes a mission preset without touching the others', () => {
    GameConfig.init({ missions: { BANDIT_RAID: { ratio: 2.5, rewardCopperPerStrength: 500 } } })
    const p = missionPresets()
    expect(p.BANDIT_RAID.ratio).toBe(2.5)
    expect(p.BANDIT_RAID.rewardCopperPerStrength).toBe(500)
    expect(p.BANDIT_RAID.typeWeights).toEqual(MISSION_PRESETS.BANDIT_RAID.typeWeights)
    expect(p.RIVAL_BARON).toEqual(MISSION_PRESETS.RIVAL_BARON)
  })

  it('retunes a momentum buff', () => {
    const table = resolveBuffs({ WAR_SPOILS: { days: 10, effects: { prodMult: 3 } } })
    expect(table.WAR_SPOILS.days).toBe(10)
    expect(table.WAR_SPOILS.effects.prodMult).toBe(3)
    expect(table.LICKING_WOUNDS).toEqual(BUFF_DEFS.LICKING_WOUNDS)
    const buffs = onBattleWon([], table)
    expect(buffs.find((b) => b.id === 'WAR_SPOILS')?.daysRemaining).toBe(10)
    expect(BUFF_DEFS.WAR_SPOILS.days).toBe(3) // the default table is never mutated
  })
})

describe('GameConfig — garbage in, defaults out', () => {
  it('ignores non-numeric, negative, NaN and unknown-key overrides', () => {
    GameConfig.init({
      buildingCost: { BLACKSMITH: NaN as number, MARKET: -50 },
      training: { baseDays: 'soon' as unknown as number, minDays: 0 },
      missions: { NO_SUCH_MISSION: { ratio: 99 } },
    })
    expect(buildingCostCopper('BLACKSMITH')).toBe(BuildingCostCopper.BLACKSMITH)
    expect(buildingCostCopper('MARKET')).toBe(BuildingCostCopper.MARKET)
    expect(GameConfig.training()).toEqual(DEFAULT_TRAINING)
    expect(missionPresets()).toEqual(MISSION_PRESETS)
    expect(resolveBuffs({ WAR_SPOILS: { days: -4 } }).WAR_SPOILS.days).toBe(BUFF_DEFS.WAR_SPOILS.days)
  })

  it('never lets baseDays fall below minDays', () => {
    GameConfig.init({ training: { baseDays: 2, minDays: 6 } })
    const t = GameConfig.training()
    expect(t.minDays).toBe(6)
    expect(t.baseDays).toBeGreaterThanOrEqual(t.minDays)
  })
})

// These two were shipped as UI text with no effect behind them: ResearchTab advertised
// "cheaper buildings" and "faster training" while the code never passed the modifiers on.
describe('research modifiers are no longer inert', () => {
  it('buildCostMult actually reduces what a building costs', () => {
    const full = buildingCostCopper('BLACKSMITH')
    expect(buildingCostCopper('BLACKSMITH', 0.8)).toBe(Math.round(full * 0.8))
    expect(buildingUpgradeCostCopper('BLACKSMITH', 2, 0.8))
      .toBeLessThan(buildingUpgradeCostCopper('BLACKSMITH', 2))
  })

  it('trainDaysDelta actually shortens a queued batch', () => {
    const plain = enqueueBatch([], { level: 1, kind: 'LIGHT_TRAIN', target: 'LIGHT_ARCHER', qty: 5 })
    const fast = enqueueBatch([], { level: 1, kind: 'LIGHT_TRAIN', target: 'LIGHT_ARCHER', qty: 5 }, -2)
    expect(fast[0].daysRemaining).toBe(plain[0].daysRemaining - 2)
  })

  it('trainDaysDelta can never drive a batch below one day', () => {
    const absurd = enqueueBatch([], { level: 1, kind: 'LIGHT_TRAIN', target: 'LIGHT_ARCHER', qty: 5 }, -99)
    expect(absurd[0].daysRemaining).toBe(1)
  })

  it('trainSlotsDelta actually grants an extra queue slot', () => {
    const full = Array.from({ length: batchSlots(1) }, (_, i) =>
      ({ id: `B${i}`, kind: 'LIGHT_TRAIN' as const, qty: 1, daysRemaining: 3 }))
    expect(canEnqueue(full, 1)).toBe(false)
    expect(canEnqueue(full, 1, 1)).toBe(true)
  })
})
