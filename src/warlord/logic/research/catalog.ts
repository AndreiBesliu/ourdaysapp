// src/logic/research/catalog.ts
// The tech tree AS DATA. Nothing here is hardcoded into game logic: every value is a
// field, so the planned Warlord admin can ship an override object at runtime
// (`resolveCatalog(overrides)`) without a data migration or a rebuild.
//
// Four branches, three tiers. Costs use the existing copper scale (100 = 1 silver,
// 10000 = 1 gold) and the existing ResourceMap keys.

import type { Branch, EffectDelta } from './effects'
import type { Building, BuildingType } from '../types'

export type TechId = string

export interface BuildingRequirement {
  type: BuildingType
  level: number // minimum level of that building (1 = merely owning it)
}

export interface TechDef {
  id: TechId
  branch: Branch
  name: string
  desc: string
  tier: 1 | 2 | 3
  requires: TechId[]
  // Infrastructure the domain must actually have. You cannot study kilns without a
  // smelter to study — this is what ties research to what you have built.
  requiresBuildings?: BuildingRequirement[]
  costCopper: number
  costResources: Partial<Record<string, number>>
  days: number
  effects: EffectDelta
}

export const BRANCH_LABEL: Record<Branch, string> = {
  ECONOMY: 'Economy',
  ARMY: 'Army',
  CAMPAIGN: 'Campaign',
  UNLOCKS: 'Doctrine',
}

// Unlock ids referenced by Modifiers.unlocks (opaque strings; the UI gates on them).
export const UNLOCK_GRAND_ARMORY = 'GRAND_ARMORY'
export const UNLOCK_ELITE_DRILL = 'ELITE_DRILL'

export const DEFAULT_TECHS: TechDef[] = [
  // ── ECONOMY ────────────────────────────────────────────────────────────────
  {
    id: 'ECO_TOOLS', branch: 'ECONOMY', tier: 1, requires: [], requiresBuildings: [{ type: 'BLACKSMITH', level: 1 }],
    name: 'Iron Tools', desc: 'Better tools across every workshop. +15% building output.',
    costCopper: 15_000, costResources: { WOOD: 40, IRON_INGOT: 4 }, days: 3,
    effects: { prodMult: 1.15 },
  },
  {
    id: 'ECO_KILNS', branch: 'ECONOMY', tier: 2, requires: ['ECO_TOOLS'], requiresBuildings: [{ type: 'SMELTER', level: 2 }],
    name: 'Improved Kilns', desc: 'Hotter, cleaner burns. +20% crafting efficiency (more items per unit of value).',
    costCopper: 40_000, costResources: { STONE: 60, COAL: 30 }, days: 5,
    effects: { craftEfficiency: 1.2 },
  },
  {
    id: 'ECO_GUILDS', branch: 'ECONOMY', tier: 3, requires: ['ECO_KILNS'], requiresBuildings: [{ type: 'MARKET', level: 2 }, { type: 'WOODWORKER', level: 1 }],
    name: 'Craft Guilds', desc: 'Organised trades. +20% output and 15% cheaper construction.',
    costCopper: 90_000, costResources: { SILVER_INGOT: 6, IRON_INGOT: 15 }, days: 8,
    effects: { prodMult: 1.2, buildCostMult: 0.85 },
  },

  // ── ARMY ───────────────────────────────────────────────────────────────────
  {
    id: 'ARM_DRILL', branch: 'ARMY', tier: 1, requires: [], requiresBuildings: [{ type: 'BARRACKS', level: 2 }],
    name: 'Drill Fields', desc: 'Standing drill routines. +25% daily training XP.',
    costCopper: 18_000, costResources: { WOOD: 50 }, days: 3,
    effects: { trainXpMult: 1.25 },
  },
  {
    id: 'ARM_QUARTER', branch: 'ARMY', tier: 2, requires: ['ARM_DRILL'], requiresBuildings: [{ type: 'FARM', level: 2 }, { type: 'MARKET', level: 1 }],
    name: 'Quartermasters', desc: 'Disciplined supply lines. Upkeep −15%, food −15%.',
    costCopper: 45_000, costResources: { FOOD: 80, IRON_INGOT: 5 }, days: 5,
    effects: { upkeepMult: 0.85, foodMult: 0.85 },
  },
  {
    id: 'ARM_ACADEMY', branch: 'ARMY', tier: 3, requires: ['ARM_QUARTER'], requiresBuildings: [{ type: 'BARRACKS', level: 3 }, { type: 'ARMORY', level: 2 }],
    name: 'War Academy', desc: 'Training batches finish 2 days sooner and one more can run at once.',
    costCopper: 100_000, costResources: { STONE: 80, SILVER_INGOT: 4 }, days: 8,
    effects: { trainDaysDelta: -2, trainSlotsDelta: 1 },
  },

  // ── CAMPAIGN ───────────────────────────────────────────────────────────────
  {
    id: 'CAM_SCOUTS', branch: 'CAMPAIGN', tier: 1, requires: [], requiresBuildings: [{ type: 'STABLE', level: 1 }],
    name: 'Scouting Parties', desc: 'You pick your fights and strip the field. +20% battle loot.',
    costCopper: 16_000, costResources: { WOOD: 30, FOOD: 40 }, days: 3,
    effects: { lootMult: 1.2 },
  },
  {
    id: 'CAM_FIELD_MED', branch: 'CAMPAIGN', tier: 2, requires: ['CAM_SCOUTS'], requiresBuildings: [{ type: 'TAILOR', level: 2 }],
    name: 'Field Surgeons', desc: 'The wounded come back. Survivors keep +8 morale after every battle.',
    costCopper: 42_000, costResources: { FOOD: 60, COPPER_INGOT: 8 }, days: 5,
    effects: { postBattleMoraleBonus: 8 },
  },
  {
    id: 'CAM_LOGISTICS', branch: 'CAMPAIGN', tier: 3, requires: ['CAM_FIELD_MED'], requiresBuildings: [{ type: 'STABLE', level: 2 }, { type: 'MARKET', level: 2 }],
    name: 'Campaign Logistics', desc: 'Baggage trains and forward camps. +30% loot, food −10%.',
    costCopper: 95_000, costResources: { IRON_INGOT: 12, STONE: 60 }, days: 8,
    effects: { lootMult: 1.3, foodMult: 0.9 },
  },

  // ── DOCTRINE (unlocks) ─────────────────────────────────────────────────────
  {
    id: 'DOC_METALLURGY', branch: 'UNLOCKS', tier: 1, requires: [], requiresBuildings: [{ type: 'SMELTER', level: 1 }, { type: 'IRON_MINE', level: 1 }],
    name: 'Metallurgy', desc: 'Foundations of fine steel. Small output gain; opens deeper doctrine.',
    costCopper: 20_000, costResources: { IRON_ORE: 40, COAL: 20 }, days: 4,
    effects: { prodMult: 1.05 },
  },
  {
    id: 'DOC_ARMORY', branch: 'UNLOCKS', tier: 2, requires: ['DOC_METALLURGY'], requiresBuildings: [{ type: 'ARMORY', level: 3 }, { type: 'SCRIPTORIUM', level: 2 }],
    name: 'Grand Armory', desc: 'Unlocks the Grand Armory works and cheapens construction by 10%.',
    costCopper: 70_000, costResources: { IRON_INGOT: 20, STONE: 100 }, days: 7,
    effects: { buildCostMult: 0.9, unlocks: [UNLOCK_GRAND_ARMORY] },
  },
  {
    id: 'DOC_ELITE', branch: 'UNLOCKS', tier: 3, requires: ['DOC_ARMORY', 'ARM_ACADEMY'], requiresBuildings: [{ type: 'SCRIPTORIUM', level: 3 }, { type: 'BARRACKS', level: 3 }],
    name: 'Elite Doctrine', desc: 'Unlocks elite drill: +40% training XP on top of everything else.',
    costCopper: 140_000, costResources: { SILVER_INGOT: 10, IRON_INGOT: 25 }, days: 10,
    effects: { trainXpMult: 1.4, unlocks: [UNLOCK_ELITE_DRILL] },
  },
]

export type CatalogOverrides = {
  // Partial per-tech overrides keyed by id, plus optional extra techs. This is the
  // shape the future Warlord admin will persist and hand to resolveCatalog().
  techs?: Record<TechId, Partial<Omit<TechDef, 'id'>>>
  extra?: TechDef[]
  disabled?: TechId[]
}

// Merge admin overrides over the defaults. Unknown ids in `techs` are ignored (an admin
// editing a tech that was later renamed must not blow up a player's save).
export function resolveCatalog(overrides?: CatalogOverrides): TechDef[] {
  const disabled = new Set(overrides?.disabled ?? [])
  const base = DEFAULT_TECHS
    .filter((t) => !disabled.has(t.id))
    .map((t) => {
      const o = overrides?.techs?.[t.id]
      return o ? ({ ...t, ...o, id: t.id } as TechDef) : t
    })
  const extra = (overrides?.extra ?? []).filter((t) => !disabled.has(t.id) && !base.some((b) => b.id === t.id))
  return [...base, ...extra]
}

export function techById(catalog: TechDef[], id: TechId): TechDef | undefined {
  return catalog.find((t) => t.id === id)
}

// A tech is available when every prerequisite is already researched.
export function prereqsMet(t: TechDef, unlocked: TechId[]): boolean {
  return t.requires.every((r) => unlocked.includes(r))
}

const prettyBuilding = (t: BuildingType) => t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

// Which infrastructure requirements a tech is still missing, as text the UI can print
// verbatim ("Smelter L2 (you have L1)"). Empty array = buildable.
export function missingBuildings(t: TechDef, buildings: Pick<Building, 'type' | 'level'>[]): string[] {
  const out: string[] = []
  for (const req of t.requiresBuildings ?? []) {
    const owned = buildings.filter((b) => b.type === req.type)
    const best = owned.reduce((m, b) => Math.max(m, b.level ?? 1), 0)
    if (best >= req.level) continue
    out.push(
      best === 0
        ? `${prettyBuilding(req.type)}${req.level > 1 ? ` L${req.level}` : ''}`
        : `${prettyBuilding(req.type)} L${req.level} (you have L${best})`
    )
  }
  return out
}

export function buildingReqsMet(t: TechDef, buildings: Pick<Building, 'type' | 'level'>[]): boolean {
  return missingBuildings(t, buildings).length === 0
}

// The Scriptorium is the gate: no scholars, no research at all.
export const RESEARCH_BUILDING: BuildingType = 'SCRIPTORIUM'
export function hasResearchBuilding(buildings: Pick<Building, 'type'>[]): boolean {
  return buildings.some((b) => b.type === RESEARCH_BUILDING)
}
