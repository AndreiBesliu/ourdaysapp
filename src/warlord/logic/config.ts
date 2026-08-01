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
  missions?: Record<string, MissionOverride>
  catalog?: CatalogOverrides
  buffs?: Record<string, Partial<Omit<BuffDef, 'id'>>>
}

export const DEFAULT_TRAINING: TrainingConfig = { baseDays: 7, minDays: 3, maxSlots: 5 }

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

  mission(id: string): MissionOverride | undefined {
    return this.o.missions?.[id]
  }
}

export const GameConfig = new GameConfigStore()
