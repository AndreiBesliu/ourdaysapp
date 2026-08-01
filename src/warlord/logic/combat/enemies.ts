// src/logic/combat/enemies.ts
// Mission presets, deterministic enemy-army + terrain generation, and the high-level
// createBattle() entry point the UI calls. All randomness flows through makeRng(seed)
// so a given (deployedUnits, difficulty, seed) fully determines the battle.

import type { Unit, SoldierType, Rank } from '../types'
import { RankNumber } from '../types'
import type { BattleState, Combatant, Difficulty, MissionPreset, TerrainType } from './types'
import { makeRng, weightedPick } from './rng'
import { buildBattle } from './engine'
import { unitToCombatant, prettyName, armyStrength } from './army'
import { GameConfig } from '../config'

export const BATTLE_WIDTH = 12
export const BATTLE_HEIGHT = 8

export const MISSION_PRESETS: Record<Difficulty, MissionPreset> = {
  BANDIT_RAID: {
    id: 'BANDIT_RAID',
    name: 'Bandit Raid',
    ratio: 0.6,
    minTokens: 2,
    maxTokens: 4,
    typeWeights: { LIGHT_INF_SWORD: 0.4, LIGHT_INF_SPEAR: 0.3, LIGHT_ARCHER: 0.3 },
    rankWeights: { NOVICE: 0.6, TRAINED: 0.4 },
    baseMorale: 70,
    baseXP: 10,
    rewardCopperPerStrength: 40,
    rewardResources: { WOOD: 20, FOOD: 15 },
  },
  RIVAL_BARON: {
    id: 'RIVAL_BARON',
    name: 'Rival Baron',
    ratio: 1.0,
    minTokens: 4,
    maxTokens: 6,
    typeWeights: {
      LIGHT_INF_SWORD: 0.2, HEAVY_INF_SWORD: 0.15, HEAVY_INF_SPEAR: 0.15,
      LIGHT_ARCHER: 0.2, LIGHT_CAV: 0.2, HEAVY_INF_HALBERD: 0.1,
    },
    rankWeights: { TRAINED: 0.5, ADVANCED: 0.4, VETERAN: 0.1 },
    baseMorale: 85,
    baseXP: 60,
    rewardCopperPerStrength: 80,
    rewardResources: { IRON_INGOT: 8, STONE: 20 },
  },
  INVASION: {
    id: 'INVASION',
    name: 'Invasion',
    ratio: 1.4,
    minTokens: 6,
    maxTokens: 8,
    typeWeights: {
      HEAVY_INF_SWORD: 0.2, HEAVY_INF_SPEAR: 0.1, HEAVY_INF_HALBERD: 0.2,
      HEAVY_CAV: 0.2, HEAVY_ARCHER: 0.2, LIGHT_CAV: 0.1,
    },
    rankWeights: { ADVANCED: 0.5, VETERAN: 0.4, ELITE: 0.1 },
    baseMorale: 95,
    baseXP: 120,
    rewardCopperPerStrength: 140,
    rewardResources: { SILVER_INGOT: 5, IRON_INGOT: 20, STONE: 40 },
  },
}

export const DIFFICULTIES: Difficulty[] = ['BANDIT_RAID', 'RIVAL_BARON', 'INVASION']

function makeEnemyCombatant(i: number, type: SoldierType, rank: Rank, count: number, preset: MissionPreset): Combatant {
  return {
    id: `E${i}`,
    side: 'ENEMY',
    unitId: '',
    type,
    name: prettyName(type),
    x: -1,
    y: -1,
    hp: count,
    hpStart: count,
    morale: preset.baseMorale,
    vet: RankNumber[rank],
    kills: 0,
    hasMoved: false,
    hasActed: false,
    routed: false,
    buckets: [{ r: rank, count, avgXP: preset.baseXP }],
  }
}

// Mission presets are DATA: the admin retunes difficulty/reward without a deploy.
// Weights and names stay code-owned (v1 scope); only the numeric knobs are overridable.
export function missionPresets(): Record<Difficulty, MissionPreset> {
  const out = {} as Record<Difficulty, MissionPreset>
  for (const [id, base] of Object.entries(MISSION_PRESETS) as [Difficulty, MissionPreset][]) {
    const ov = GameConfig.mission(id)
    if (!ov) { out[id] = base; continue }
    const n = (v: unknown, fallback: number, min = 0) =>
      typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
    const minTokens = Math.max(1, Math.round(n(ov.minTokens, base.minTokens, 1)))
    out[id] = {
      ...base,
      ratio: n(ov.ratio, base.ratio, 0.01),
      minTokens,
      maxTokens: Math.max(minTokens, Math.round(n(ov.maxTokens, base.maxTokens, 1))),
      baseMorale: n(ov.baseMorale, base.baseMorale, 1),
      rewardCopperPerStrength: n(ov.rewardCopperPerStrength, base.rewardCopperPerStrength),
      rewardResources: ov.rewardResources && typeof ov.rewardResources === 'object'
        ? { ...base.rewardResources, ...ov.rewardResources }
        : base.rewardResources,
    }
  }
  return out
}

export function generateEnemyArmy(preset: MissionPreset, playerStrength: number, seed: number, ratioMult = 1): Combatant[] {
  const rng = makeRng((seed ^ 0x51ed) >>> 0)
  const targetStrength = Math.max(preset.minTokens, Math.round(playerStrength * preset.ratio * ratioMult))
  let n = Math.round(targetStrength / 30)
  n = Math.max(preset.minTokens, Math.min(preset.maxTokens, n))

  const combatants: Combatant[] = []
  let allocated = 0
  for (let i = 0; i < n; i++) {
    let share: number
    if (i < n - 1) {
      share = Math.max(1, Math.round((targetStrength / n) * (0.8 + 0.4 * rng())))
      allocated += share
    } else {
      share = Math.max(1, targetStrength - allocated)
    }
    const type = weightedPick(preset.typeWeights, rng) as SoldierType
    const rank = weightedPick(preset.rankWeights, rng) as Rank
    combatants.push(makeEnemyCombatant(i, type, rank, share, preset))
  }
  return combatants
}

export function generateTerrain(seed: number, w: number, h: number): Record<string, TerrainType[]> {
  const rng = makeRng((seed ^ 0x7e44) >>> 0)
  const grid: TerrainType[][] = Array.from({ length: h }, () => Array<TerrainType>(w).fill('PLAINS'))

  // Forest scatter (avoid the two spawn rows on each edge so units don't start buried)
  const forestCount = Math.round(w * h * 0.1)
  for (let i = 0; i < forestCount; i++) {
    const x = Math.floor(rng() * w)
    const y = Math.floor(rng() * h)
    if (y < 1 || y > h - 2) continue
    grid[y][x] = 'FOREST'
  }

  // Central hill cluster (plus-shape)
  const hx = Math.floor(w / 2) + (Math.floor(rng() * 3) - 1)
  const hy = Math.floor(h / 2)
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = hx + dx
    const y = hy + dy
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = 'HILL'
  }

  // Optional river line through the middle rows (~40%)
  if (rng() < 0.4) {
    const col = 2 + Math.floor(rng() * (w - 4))
    for (let y = 2; y <= h - 3; y++) {
      if (rng() < 0.7) grid[y][col] = 'RIVER'
    }
  }

  const out: Record<string, TerrainType[]> = {}
  for (let y = 0; y < h; y++) out[String(y)] = grid[y]
  return out
}

function placeArmy(cs: Combatant[], w: number, rows: number[]): void {
  const perRow = w
  const n = Math.min(cs.length, perRow)
  const startCol = Math.max(0, Math.floor((w - n) / 2))
  cs.forEach((c, i) => {
    const rowIdx = Math.floor(i / perRow) % rows.length
    c.x = Math.min(w - 1, startCol + (i % perRow))
    c.y = rows[rowIdx]
  })
}

export interface CreatedBattle {
  state: BattleState
  deployedIds: string[]
  reward: { copper: number; resources: Partial<Record<string, number>> }
  playerStrength: number
  enemyStrength: number
}

export function computeReward(preset: MissionPreset, enemyStrength: number, rewardMult = 1): { copper: number; resources: Partial<Record<string, number>> } {
  const copper = Math.round(preset.rewardCopperPerStrength * enemyStrength * rewardMult)
  const resources: Partial<Record<string, number>> = {}
  for (const [k, v] of Object.entries(preset.rewardResources)) {
    resources[k] = Math.max(1, Math.round((v as number) * (enemyStrength / 50) * rewardMult))
  }
  return { copper, resources }
}

export interface BattleMods {
  ratioMult?: number // campaign escalation: enemy strength multiplier (1 = base)
  rewardMult?: number // win-streak bonus: loot multiplier (1 = base)
}

// High-level entry point: deployedUnits are the actual Unit objects the player committed.
export function createBattle(deployedUnits: Unit[], difficulty: Difficulty, seed: number, mods?: BattleMods): CreatedBattle {
  const preset = missionPresets()[difficulty]
  const w = BATTLE_WIDTH
  const h = BATTLE_HEIGHT

  const playerCombatants = deployedUnits.map((u, i) => unitToCombatant(u, 'PLAYER', i))
  const playerStrength = armyStrength(deployedUnits)
  const enemyCombatants = generateEnemyArmy(preset, playerStrength, seed, mods?.ratioMult ?? 1)
  const enemyStrength = enemyCombatants.reduce((a, c) => a + c.hpStart, 0)
  const terrain = generateTerrain(seed, w, h)

  placeArmy(playerCombatants, w, [h - 1, h - 2])
  placeArmy(enemyCombatants, w, [0, 1])

  const state = buildBattle({
    playerCombatants,
    enemyCombatants,
    terrain,
    width: w,
    height: h,
    seed,
    difficulty,
  })

  return {
    state,
    deployedIds: deployedUnits.map((u) => u.id),
    reward: computeReward(preset, enemyStrength, mods?.rewardMult ?? 1),
    playerStrength,
    enemyStrength,
  }
}

// Campaign escalation curve: each prior clear of a mission raises enemy strength 5%, cap +50%.
export function escalationMult(clears: number): number {
  return Math.min(1.5, 1 + 0.05 * Math.max(0, clears))
}

// Win-streak loot curve: each consecutive victory raises loot 5%, cap +50%.
export function streakLootMult(streak: number): number {
  return Math.min(1.5, 1 + 0.05 * Math.max(0, streak))
}
