// src/logic/economy.ts
import type { BuildingType, ResourceMap, SoldierType, Unit, Rank } from './types'
import { itemValueCopper } from './items'
import { GameConfig } from './config'

// Daily upkeep cost per soldier (in copper), by type
export const UPKEEP_BASE: Record<SoldierType, number> = {
  LIGHT_INF_SWORD: 2, LIGHT_INF_SPEAR: 2, LIGHT_INF_HALBERD: 2,
  HEAVY_INF_SWORD: 3, HEAVY_INF_SPEAR: 3, HEAVY_INF_HALBERD: 3,
  LIGHT_ARCHER: 2,    HEAVY_ARCHER: 3,
  LIGHT_CAV: 5,       HEAVY_CAV: 8,
  HORSE_ARCHER: 5,
}

// Rank multiplier for upkeep (veterans cost more to maintain)
export const UPKEEP_RANK_MULT: Record<Rank, number> = {
  NOVICE: 1.0, TRAINED: 1.1, ADVANCED: 1.25, VETERAN: 1.5, ELITE: 2.0,
}

// `mult` lets research/momentum lower upkeep (1 = unchanged).
export function dailyUpkeepCopper(units: Unit[], mult = 1): number {
  let total = 0
  for (const u of units) {
    const base = GameConfig.upkeepBase(u.type, UPKEEP_BASE[u.type] ?? 2)
    for (const b of u.buckets) {
      total += Math.round(base * GameConfig.upkeepRankMult(b.r, UPKEEP_RANK_MULT[b.r] ?? 1) * b.count)
    }
  }
  return Math.round(total * mult)
}

// Building costs (in copper)
export const BuildingCostCopper: Record<BuildingType, number> = {
  BLACKSMITH: 100_0000, // 100g
  ARMORY: 100_0000,
  WOODWORKER: 20_000,
  TAILOR: 35_000,
  STABLE: 40_000,
  MARKET: 0,
  BARRACKS: 0,
  // Resource buildings
  LUMBER_MILL: 5_000,
  QUARRY: 5_000,
  IRON_MINE: 50_000,
  COAL_MINE: 30_000,
  COPPER_MINE: 30_000,
  SILVER_MINE: 100_000,
  SMELTER: 40_000,
  MINTER: 80_000,
  FARM: 8_000,
}

// Resource costs for buildings (Wood, Stone, etc.)
export const ResourceBuildingCosts: Record<BuildingType, Partial<ResourceMap>> = {
  // Production
  BLACKSMITH: { WOOD: 50, STONE: 100 },
  ARMORY: { WOOD: 50, STONE: 100 },
  WOODWORKER: { WOOD: 100 },
  TAILOR: { WOOD: 50, STONE: 20 },
  STABLE: { WOOD: 100, STONE: 20 },
  MARKET: { WOOD: 100 },
  BARRACKS: { WOOD: 100, STONE: 100 },
  // Resource
  LUMBER_MILL: { WOOD: 10 },
  QUARRY: { WOOD: 20 },
  IRON_MINE: { WOOD: 100, STONE: 50 },
  COAL_MINE: { WOOD: 100, STONE: 50 },
  COPPER_MINE: { WOOD: 50, STONE: 20 },
  SILVER_MINE: { WOOD: 200, STONE: 200 },
  SMELTER: { WOOD: 50, STONE: 200 },
  MINTER: { WOOD: 50, STONE: 200, IRON_INGOT: 20 },
  FARM: { WOOD: 30 },
}

// Focus options (percentage of coin kept; remaining is converted to items)
export const FocusOptions = [100, 80, 60, 40, 20, 0] as const

// What each building can produce (and whether it’s weapons/armor)
export const BuildingOutputChoices: Record<string, { options: string[] }> = {
  BLACKSMITH: { options: ['HALBERD', 'SPEAR', 'SWORD'] },
  ARMORY: { options: ['HEAVY_ARMOR', 'HORSE_ARMOR'] },
  WOODWORKER: { options: ['BOW', 'SHIELD'] },
  TAILOR: { options: ['LIGHT_ARMOR'] },
  STABLE: { options: [] },
  MARKET: { options: [] },
  BARRACKS: { options: [] },
  // Resource buildings generally have fixed outputs, but we might list them here for UI
  LUMBER_MILL: { options: ['WOOD'] },
  QUARRY: { options: ['STONE'] },
  IRON_MINE: { options: ['IRON_ORE'] },
  COAL_MINE: { options: ['COAL'] },
  COPPER_MINE: { options: ['COPPER_ORE'] },
  SILVER_MINE: { options: ['SILVER_ORE'] },
  SMELTER: { options: ['IRON_INGOT', 'COPPER_INGOT', 'SILVER_INGOT'] },
  MINTER: { options: [] },
  FARM: { options: ['FOOD'] },
}

export const SmelterRecipes: Record<string, { input: Partial<ResourceMap> }> = {
  'IRON_INGOT': { input: { IRON_ORE: 2, COAL: 1 } },
  'COPPER_INGOT': { input: { COPPER_ORE: 2, COAL: 1 } },
  'SILVER_INGOT': { input: { SILVER_ORE: 2, COAL: 1 } },
}

export const ManufacturingRecipes: Record<string, Partial<ResourceMap>> = {
  // Woodworker
  BOW: { WOOD: 10 },
  SHIELD: { WOOD: 15 },
  // Blacksmith (optional for now, but good for completeness)
  SPEAR: { WOOD: 5, IRON_INGOT: 2 },
  HALBERD: { WOOD: 10, IRON_INGOT: 5 },
  SWORD: { IRON_INGOT: 10, COAL: 2 },
}

/**
 * Passive income / production math:
 * - Base output/day = 10% of building cost (in copper). Resource buildings use a fixed base.
 * - Keep `focusCoinPct`% as coin; remaining value is converted to items at 70% market value.
 * - Returns (coinGain, whole items produced, fractional remainder for next tick).
 */

// Fixed daily output value (in copper) for resource buildings that don't scale with cost.
export const RESOURCE_BUILDING_BASE_VALUE: Partial<Record<string, number>> = {
  WOOD: 500,   // ~10 wood/day at 50c/wood
  STONE: 500,
  FOOD: 800,   // ~16 food/day at 50c/food
}

// Food consumption per soldier per day (base, before rank modifier)
export const FOOD_BASE: Record<SoldierType, number> = {
  LIGHT_INF_SWORD: 1, LIGHT_INF_SPEAR: 1, LIGHT_INF_HALBERD: 1,
  HEAVY_INF_SWORD: 2, HEAVY_INF_SPEAR: 2, HEAVY_INF_HALBERD: 2,
  LIGHT_ARCHER: 1,    HEAVY_ARCHER: 2,
  LIGHT_CAV: 2,       HEAVY_CAV: 3,
  HORSE_ARCHER: 2,
}

// `mult` lets research/momentum lower consumption (1 = unchanged).
export function dailyFoodConsumption(units: Unit[], mult = 1): number {
  let total = 0
  for (const u of units) {
    const base = GameConfig.foodBase(u.type, FOOD_BASE[u.type] ?? 1)
    for (const b of u.buckets) total += base * b.count
  }
  return Math.round(total * mult)
}

// ---- Building levels ----
export const BUILDING_MAX_LEVEL = 3

// Output multiplier per level: L1 ×1.0, L2 ×1.3, L3 ×1.6
export function buildingLevelMult(level: number): number {
  const lvl = Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.floor(level || 1)))
  return 1 + 0.3 * (lvl - 1)
}

// Copper cost to upgrade FROM `currentLevel` to the next: 60% of base cost × current level.
export function buildingUpgradeCostCopper(type: BuildingType, currentLevel: number, costMult = 1): number {
  const base = GameConfig.buildingCost(type, BuildingCostCopper[type] || 0)
  return Math.round(base * 0.6 * Math.max(1, currentLevel) * costMult)
}

// THE single source of a building's copper price: admin config first, then any research
// discount. Every reader (purchase, income math, UI price tags) must go through this —
// reading the raw BuildingCostCopper table would show a price the game doesn't charge.
export function buildingCostCopper(type: BuildingType, costMult = 1): number {
  return Math.round(GameConfig.buildingCost(type, BuildingCostCopper[type] || 0) * costMult)
}

// Resource price of a building after admin config (research discounts don't apply to
// materials today — only to copper).
export function buildingResourceCost(type: BuildingType): Partial<ResourceMap> {
  return GameConfig.buildingResourceCost(type, ResourceBuildingCosts[type] || {})
}

export function passiveIncomeAndProduction(args: {
  costCopper: number
  focusCoinPct: (typeof FocusOptions)[number]
  outputItem: string
  fractionalBuffer: number
  level?: number
  outputMult?: number // research/momentum production bonus (1 = unchanged)
  craftEfficiency?: number // research crafting bonus: more items per unit of value
}): { coinGain: number; items: number; newBuffer: number } {
  const { costCopper, focusCoinPct, outputItem, fractionalBuffer } = args

  const configured = GameConfig.resourceBaseValue(outputItem, RESOURCE_BUILDING_BASE_VALUE[outputItem])
  const basePerDay = (configured ?? (0.10 * costCopper))
    * buildingLevelMult(args.level ?? 1) * (args.outputMult ?? 1)
  if (!basePerDay) return { coinGain: 0, items: 0, newBuffer: fractionalBuffer }

  const coinGain = Math.round(basePerDay * (focusCoinPct / 100))
  const remainderValue = basePerDay - coinGain
  const mv = itemValueCopper(outputItem) || 0

  if (remainderValue <= 0 || mv <= 0) {
    return { coinGain, items: 0, newBuffer: fractionalBuffer }
  }

  // Produce at 70% of market value (manufacturing efficiency bonus); research can
  // improve that conversion further (craftEfficiency > 1 → cheaper per item).
  const itemsFloat = remainderValue / ((0.7 / (args.craftEfficiency ?? 1)) * mv)
  const total = fractionalBuffer + itemsFloat
  const items = Math.floor(total)
  const newBuffer = total - items

  return { coinGain, items, newBuffer }
}
