// src/logic/config.ts
// Runtime game configuration: every balance number the Warlord admin can retune.
//
// Why a singleton (mirroring `Registry`): several of these tables are read directly
// from their modules by UI components (BuildingsTab, ProductionModal), not through
// useGameState. Threading a config prop would leave those reads on the defaults —
// you'd see one price and pay another. A single store initialised once before the
// game mounts keeps every reader honest.
//
// The DEFAULT tables stay exactly where they are and are never mutated; overrides are
// merged on top at init. An empty/absent override = today's behaviour, exactly.

import type { BuildingType, ResourceMap, SoldierType, Rank } from './types'
import type { CatalogOverrides } from './research/catalog'
import type { BuffDef } from './research/momentum'

export interface TrainingConfig {
  baseDays: number // days for a level-1 barracks batch
  minDays: number // floor after level and research reductions
  maxSlots: number // hard cap on concurrent batches
}

export interface TickConfig {
  minutesPerDay: number // real minutes that make one in-game day
  maxOfflineDays: number // how much of an absence is resolved on return (0 = none)
}

export interface MissionOverride {
  ratio?: number
  rewardCopperPerStrength?: number
  rewardResources?: Partial<Record<string, number>>
  minTokens?: number
  maxTokens?: number
  baseMorale?: number
}

export interface GameConfigOverrides {
  buildingCost?: Partial<Record<BuildingType, number>>
  buildingResourceCost?: Partial<Record<BuildingType, Partial<ResourceMap>>>
  resourceBaseValue?: Partial<Record<string, number>>
  upkeepBase?: Partial<Record<SoldierType, number>>
  upkeepRankMult?: Partial<Record<Rank, number>>
  foodBase?: Partial<Record<SoldierType, number>>
  training?: Partial<TrainingConfig>
  tick?: Partial<TickConfig>
  missions?: Record<string, MissionOverride>
  catalog?: CatalogOverrides
  buffs?: Record<string, Partial<Omit<BuffDef, 'id'>>>
}

export const DEFAULT_TRAINING: TrainingConfig = { baseDays: 7, minDays: 3, maxSlots: 5 }

// 24 days = two real hours of absence resolved on return. Deliberately conservative:
// every caught-up day still charges upkeep and eats food, so a huge catch-up can starve
// an army the player never got to feed. Raise it from the admin if you want more.
export const DEFAULT_TICK: TickConfig = { minutesPerDay: 5, maxOfflineDays: 24 }

// Only finite, non-negative numbers survive — an admin typo (or a corrupted doc) must
// never turn a price into NaN and brick the economy.
function num(v: unknown, fallback: number, min = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
}

class GameConfigStore {
  private o: GameConfigOverrides = {}

  // Replace the active overrides. Called once before the game mounts (and again if the
  // admin saves while the player has the game open and reloads).
  init(overrides?: GameConfigOverrides | null): void {
    this.o = overrides && typeof overrides === 'object' ? overrides : {}
  }

  raw(): GameConfigOverrides {
    return this.o
  }

  buildingCost(type: BuildingType, base: number): number {
    return num(this.o.buildingCost?.[type], base)
  }

  buildingResourceCost(type: BuildingType, base: Partial<ResourceMap>): Partial<ResourceMap> {
    const ov = this.o.buildingResourceCost?.[type]
    return ov && typeof ov === 'object' ? { ...base, ...ov } : base
  }

  resourceBaseValue(item: string, base: number | undefined): number | undefined {
    const ov = this.o.resourceBaseValue?.[item]
    return typeof ov === 'number' && Number.isFinite(ov) && ov >= 0 ? ov : base
  }

  upkeepBase(type: SoldierType, base: number): number {
    return num(this.o.upkeepBase?.[type], base)
  }

  upkeepRankMult(rank: Rank, base: number): number {
    return num(this.o.upkeepRankMult?.[rank], base)
  }

  foodBase(type: SoldierType, base: number): number {
    return num(this.o.foodBase?.[type], base)
  }

  training(): TrainingConfig {
    const t = this.o.training ?? {}
    const minDays = Math.max(1, num(t.minDays, DEFAULT_TRAINING.minDays, 1))
    return {
      baseDays: Math.max(minDays, num(t.baseDays, DEFAULT_TRAINING.baseDays, 1)),
      minDays,
      maxSlots: Math.max(1, num(t.maxSlots, DEFAULT_TRAINING.maxSlots, 1)),
    }
  }

  tick(): TickConfig {
    const t = this.o.tick ?? {}
    return {
      // A day shorter than 10s would spin the catch-up loop; a missing/absurd value falls back.
      minutesPerDay: Math.max(1 / 6, num(t.minutesPerDay, DEFAULT_TICK.minutesPerDay, 1 / 6)),
      maxOfflineDays: Math.min(2000, Math.floor(num(t.maxOfflineDays, DEFAULT_TICK.maxOfflineDays))),
    }
  }

  tickMs(): number {
    return Math.round(this.tick().minutesPerDay * 60_000)
  }

  mission(id: string): MissionOverride | undefined {
    return this.o.missions?.[id]
  }
}

export const GameConfig = new GameConfigStore()
