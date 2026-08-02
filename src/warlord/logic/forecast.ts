// src/logic/forecast.ts
// "What will one more day do to my stores?" — answered by RUNNING the day, not by
// re-deriving it. `simulateEconomyDay` is the same function the daily tick commits, so
// the number shown and the number paid cannot drift. (They did, twice, when the UI
// carried its own copy of the formula.)

import { simulateEconomyDay, type BuildingDayLine, type DayEconomyInput } from './economy'
import { ResourceTypes, type ResourceMap, type ResourceType } from './types'

export interface DayForecast {
  /** Exact change each resource will see on the next tick, given today's settings. */
  resourceDelta: Record<ResourceType, number>
  /** Copper: production + minting − stable upkeep − soldier upkeep. Can be negative. */
  walletDelta: number
  incomeWalletDelta: number
  soldierUpkeep: number
  foodNeeded: number // what the army demands
  foodConsumed: number // what it can actually be given (the granary floors at 0)
  foodShortage: boolean
  /** Buildings that wanted to produce but had no inputs — the shortfall is destroyed. */
  blocked: BuildingDayLine[]
  breakdown: BuildingDayLine[]
  /** Ticks until a shrinking store hits zero (null = not shrinking). */
  daysToEmpty: Partial<Record<ResourceType, number>>
}

const zeroDeltas = (): Record<ResourceType, number> =>
  Object.fromEntries(ResourceTypes.map((r) => [r, 0])) as Record<ResourceType, number>

export function forecastDay(input: DayEconomyInput): DayForecast {
  const after = simulateEconomyDay(input)

  const resourceDelta = zeroDeltas()
  for (const r of ResourceTypes) {
    resourceDelta[r] = (after.resources[r] ?? 0) - (input.resources[r] ?? 0)
  }

  const daysToEmpty: Partial<Record<ResourceType, number>> = {}
  for (const r of ResourceTypes) {
    const d = resourceDelta[r]
    if (d >= 0) continue
    const stock = input.resources[r] ?? 0
    daysToEmpty[r] = Math.max(0, Math.floor(stock / -d))
  }

  return {
    resourceDelta,
    walletDelta: after.walletDelta,
    incomeWalletDelta: after.incomeWalletDelta,
    soldierUpkeep: after.soldierUpkeep,
    foodNeeded: after.foodNeeded,
    foodConsumed: after.foodConsumed,
    foodShortage: after.foodShortage,
    blocked: after.breakdown.filter((l) => l.blocked),
    breakdown: after.breakdown,
    daysToEmpty,
  }
}

// Why a resource moves the way it does — for the chip tooltip. Reads the same breakdown
// the forecast was computed from, so the explanation can't disagree with the number.
export function explainResource(f: DayForecast, res: ResourceType): string[] {
  const out: string[] = []
  for (const line of f.breakdown) {
    if (line.skipped) continue
    if (line.outputItem === res && line.itemsProduced > 0) {
      out.push(`${pretty(line.type)} +${line.itemsProduced}`)
    }
    const used = line.inputsConsumed[res]
    if (used) out.push(`${pretty(line.type)} −${used}`)
    if (line.outputItem === res && line.blocked) {
      out.push(`${pretty(line.type)} idle — no inputs`)
    }
  }
  if (res === 'WOOD') out.push('Nature +1')
  if (res === 'FOOD' && f.foodNeeded > 0) {
    out.push(`Army −${f.foodConsumed}${f.foodShortage ? ` (needs ${f.foodNeeded} — starving)` : ''}`)
  }
  return out
}

const pretty = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())

export type { ResourceMap }
