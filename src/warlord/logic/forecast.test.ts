import { describe, it, expect, beforeEach } from 'vitest'
import { simulateEconomyDay } from './economy'
import { forecastDay } from './forecast'
import { GameConfig } from './config'
import { makeEmptyInventories } from './helpers'
import { Registry } from './registry'
import type { Building, ResourceMap, Unit } from './types'

Registry.init()
beforeEach(() => GameConfig.init(null))

const res = (over: Partial<ResourceMap> = {}): ResourceMap => ({
  WOOD: 0, STONE: 0, IRON_ORE: 0, COAL: 0, COPPER_ORE: 0, SILVER_ORE: 0,
  IRON_INGOT: 0, COPPER_INGOT: 0, SILVER_INGOT: 0, FOOD: 0, ...over,
})

const build = (type: Building['type'], focusCoinPct: Building['focusCoinPct'], outputItem?: string, level = 1): Building =>
  ({ id: `${type}_${focusCoinPct}`, type, focusCoinPct, outputItem, fractionalBuffer: 0, level })

const army = (count: number): Unit[] =>
  [{ type: 'LIGHT_ARCHER', buckets: [{ r: 'NOVICE', count, avgXP: 0 }] } as unknown as Unit]

const day = (over: Partial<Parameters<typeof simulateEconomyDay>[0]> = {}) =>
  simulateEconomyDay({ buildings: [], resources: res(), inv: makeEmptyInventories(), units: [], ...over })

describe('the forecast is the tick — same function, so it cannot drift', () => {
  it('a resource delta is exactly what simulating the day produces', () => {
    const input = { buildings: [build('LUMBER_MILL', 0)], resources: res({ WOOD: 10 }), inv: makeEmptyInventories(), units: [] }
    const f = forecastDay(input)
    const after = simulateEconomyDay(input)
    expect((input.resources.WOOD ?? 0) + f.resourceDelta.WOOD).toBe(after.resources.WOOD)
    expect(f.walletDelta).toBe(after.walletDelta)
  })
})

// The single most useful thing the topbar will reveal: buyBuilding defaults every
// building to focusCoinPct 100, and at full coin focus there is nothing left to turn
// into goods. A fresh farm feeds nobody.
describe('focus is the whole story, and the default hides it', () => {
  it('a farm at focus 100 produces ZERO food and pays 800 copper', () => {
    const d = day({ buildings: [build('FARM', 100)] })
    expect(d.resources.FOOD).toBe(0)
    expect(d.incomeWalletDelta).toBe(800)
  })

  it('the same farm at focus 0 produces food and no copper', () => {
    const d = day({ buildings: [build('FARM', 0)] })
    expect(d.resources.FOOD).toBeGreaterThan(0)
    expect(d.incomeWalletDelta).toBe(0)
  })

  it('reports the day-invariant rate even when the integer that lands is 0', () => {
    const d = day({ buildings: [build('LUMBER_MILL', 80)] })
    const line = d.breakdown[0]
    expect(line.itemsFloat).toBeGreaterThan(0)
    expect(line.itemsFloat).toBeCloseTo(2.857, 2) // 20% of 500c at 50c/wood, /0.7
  })
})

describe('order of buildings is load-bearing', () => {
  it('a mine BEFORE its smelter feeds it the same day', () => {
    const d = day({
      buildings: [build('IRON_MINE', 0), build('COAL_MINE', 0), build('SMELTER', 0, 'IRON_INGOT')],
      resources: res(),
    })
    expect(d.resources.IRON_INGOT).toBeGreaterThan(0)
  })

  it('the same smelter placed FIRST is idle on day one', () => {
    const d = day({
      buildings: [build('SMELTER', 0, 'IRON_INGOT'), build('IRON_MINE', 0), build('COAL_MINE', 0)],
      resources: res(),
    })
    expect(d.resources.IRON_INGOT).toBe(0)
    expect(d.breakdown[0].blocked).toBe(true)
  })
})

describe('shortfalls are destroyed, not banked — and the UI must be able to say so', () => {
  it('a blocked smelter still gets paid its coin and still advances its buffer', () => {
    const d = day({ buildings: [build('SMELTER', 40, 'IRON_INGOT')], resources: res() })
    const line = d.breakdown[0]
    expect(line.blocked).toBe(true)
    expect(line.itemsWanted).toBeGreaterThan(0)
    expect(line.itemsProduced).toBe(0)
    expect(line.coinGain).toBeGreaterThan(0)
    expect(d.buildings[0].fractionalBuffer).not.toBe(0)
  })

  it('partial inputs run partially', () => {
    const d = day({ buildings: [build('SMELTER', 0, 'IRON_INGOT')], resources: res({ IRON_ORE: 4, COAL: 2 }) })
    expect(d.resources.IRON_INGOT).toBe(2) // 4 ore / 2 + 2 coal / 1 → 2
    expect(d.resources.IRON_ORE).toBe(0)
    expect(d.resources.COAL).toBe(0)
  })

  it('a resource key missing from an old save never becomes NaN', () => {
    const broken = res({ IRON_ORE: 40, COAL: 40 })
    delete (broken as Partial<ResourceMap>).IRON_INGOT
    const d = day({ buildings: [build('SMELTER', 0, 'IRON_INGOT')], resources: broken })
    expect(Number.isFinite(d.resources.IRON_INGOT)).toBe(true)
    expect(d.resources.IRON_INGOT).toBeGreaterThan(0)
  })
})

describe('the army half is honest about running out', () => {
  it('food is clamped at zero — the unmet demand evaporates, it is not a debt', () => {
    const f = forecastDay({ buildings: [], resources: res({ FOOD: 3 }), inv: makeEmptyInventories(), units: army(10) })
    expect(f.foodNeeded).toBe(10)
    expect(f.foodConsumed).toBe(3)
    expect(f.foodShortage).toBe(true)
    expect(f.resourceDelta.FOOD).toBe(-3)
  })

  it('copper is NOT clamped — upkeep drives the purse negative', () => {
    const f = forecastDay({ buildings: [], resources: res(), inv: makeEmptyInventories(), units: army(100) })
    expect(f.soldierUpkeep).toBeGreaterThan(0)
    expect(f.walletDelta).toBe(-f.soldierUpkeep)
  })

  it('counts the days until the granary is empty', () => {
    const f = forecastDay({ buildings: [], resources: res({ FOOD: 25 }), inv: makeEmptyInventories(), units: army(10) })
    expect(f.daysToEmpty.FOOD).toBe(2) // 25 / 10, floored
    expect(f.daysToEmpty.WOOD).toBeUndefined() // nature's +1 means wood never shrinks
  })

  it('an empty army costs nothing', () => {
    const f = forecastDay({ buildings: [], resources: res({ FOOD: 50 }), inv: makeEmptyInventories(), units: [] })
    expect(f.foodNeeded).toBe(0)
    expect(f.resourceDelta.FOOD).toBe(0)
  })
})

describe('stable', () => {
  it('breeds 1% of active horses and charges 50c per horse, foals included', () => {
    const inv = makeEmptyInventories()
    inv.horses.LIGHT_HORSE.active = 200
    const d = day({ buildings: [build('STABLE', 100)], inv })
    expect(d.inv.horses.LIGHT_HORSE.active).toBe(202)
    expect(d.incomeWalletDelta).toBe(-202 * 50)
  })

  it('below 100 horses the 1% floors to nothing', () => {
    const inv = makeEmptyInventories()
    inv.horses.LIGHT_HORSE.active = 99
    const d = day({ buildings: [build('STABLE', 100)], inv })
    expect(d.inv.horses.LIGHT_HORSE.active).toBe(99)
  })
})

describe('buildings that produce nothing are marked, not silently omitted', () => {
  it('barracks, market, stable and scriptorium are skipped', () => {
    const d = day({ buildings: [build('BARRACKS', 100), build('MARKET', 100), build('SCRIPTORIUM', 100)] })
    expect(d.breakdown.every((l) => l.skipped)).toBe(true)
    expect(d.incomeWalletDelta).toBe(0)
  })
})

describe('admin config reaches the forecast', () => {
  it('retuning a resource base value changes tomorrow', () => {
    const before = day({ buildings: [build('FARM', 0)] }).resources.FOOD
    GameConfig.init({ resourceBaseValue: { FOOD: 8000 } })
    const after = day({ buildings: [build('FARM', 0)] }).resources.FOOD
    expect(after).toBeGreaterThan(before)
  })
})
