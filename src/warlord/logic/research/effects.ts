// src/logic/research/effects.ts
// The ONE place where every research/momentum bonus is expressed and combined.
//
// Design: a tech and a temporary buff both carry the same `EffectDelta`, and both are
// folded by the same `aggregate()` into a single `Modifiers` object. Everything that can
// be boosted reads that one object — there is no second, parallel bonus system to keep
// in sync. Pure and deterministic; no React, no Registry, no I/O.
//
// Scope note: these modifiers deliberately affect the DOMAIN (production, training,
// upkeep, PvE loot) and never combat stats. The combat engine is byte-identical across
// three copies and PvP strips stat overrides on purpose, so a client-claimed combat
// bonus would be both a sync burden and unfair. Research still wins PvP battles — by
// fielding a bigger, better-trained army, which the server does validate.

export type Branch = 'ECONOMY' | 'ARMY' | 'CAMPAIGN' | 'UNLOCKS'

// Every knob the game exposes. Multiplicative fields are ratios (1 = unchanged);
// additive fields are deltas (0 = unchanged).
export interface Modifiers {
  prodMult: number // building output per day
  craftEfficiency: number // material→item conversion efficiency (higher = more items)
  buildCostMult: number // copper cost of constructing/upgrading
  upkeepMult: number // daily soldier upkeep
  foodMult: number // daily food consumption
  trainDaysDelta: number // days added to a training batch (negative = faster)
  trainSlotsDelta: number // extra concurrent training batches
  trainXpMult: number // daily training XP
  lootMult: number // PvE battle rewards
  postBattleMoraleBonus: number // morale added to survivors after a battle
  unlocks: string[] // opaque ids gating buildings/units in the UI
}

export interface EffectDelta {
  prodMult?: number
  craftEfficiency?: number
  buildCostMult?: number
  upkeepMult?: number
  foodMult?: number
  trainDaysDelta?: number
  trainSlotsDelta?: number
  trainXpMult?: number
  lootMult?: number
  postBattleMoraleBonus?: number
  unlocks?: string[]
}

// Caps keep a long game from turning into an economy with no decisions left.
// (Also the guard rail for the future admin: hand-edited values stay bounded.)
export const CAPS = {
  prodMult: 3,
  craftEfficiency: 2,
  buildCostMult: { min: 0.5, max: 1 },
  upkeepMult: { min: 0.5, max: 1 },
  foodMult: { min: 0.5, max: 1 },
  trainDaysDelta: -4, // never below this many days shaved off
  trainSlotsDelta: 3,
  trainXpMult: 3,
  lootMult: 3,
  postBattleMoraleBonus: 25,
}

export function emptyModifiers(): Modifiers {
  return {
    prodMult: 1,
    craftEfficiency: 1,
    buildCostMult: 1,
    upkeepMult: 1,
    foodMult: 1,
    trainDaysDelta: 0,
    trainSlotsDelta: 0,
    trainXpMult: 1,
    lootMult: 1,
    postBattleMoraleBonus: 0,
    unlocks: [],
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Fold a list of deltas into the running modifiers. Ratios multiply (so two +20% techs
// give ×1.44, not ×1.4 — compounding rewards specialisation); deltas add.
export function applyDelta(m: Modifiers, d: EffectDelta): Modifiers {
  const next: Modifiers = { ...m, unlocks: [...m.unlocks] }
  if (d.prodMult !== undefined) next.prodMult *= d.prodMult
  if (d.craftEfficiency !== undefined) next.craftEfficiency *= d.craftEfficiency
  if (d.buildCostMult !== undefined) next.buildCostMult *= d.buildCostMult
  if (d.upkeepMult !== undefined) next.upkeepMult *= d.upkeepMult
  if (d.foodMult !== undefined) next.foodMult *= d.foodMult
  if (d.trainXpMult !== undefined) next.trainXpMult *= d.trainXpMult
  if (d.lootMult !== undefined) next.lootMult *= d.lootMult
  if (d.trainDaysDelta !== undefined) next.trainDaysDelta += d.trainDaysDelta
  if (d.trainSlotsDelta !== undefined) next.trainSlotsDelta += d.trainSlotsDelta
  if (d.postBattleMoraleBonus !== undefined) next.postBattleMoraleBonus += d.postBattleMoraleBonus
  if (d.unlocks) for (const u of d.unlocks) if (!next.unlocks.includes(u)) next.unlocks.push(u)
  return next
}

export function clampModifiers(m: Modifiers): Modifiers {
  return {
    prodMult: clamp(m.prodMult, 0, CAPS.prodMult),
    craftEfficiency: clamp(m.craftEfficiency, 0, CAPS.craftEfficiency),
    buildCostMult: clamp(m.buildCostMult, CAPS.buildCostMult.min, CAPS.buildCostMult.max),
    upkeepMult: clamp(m.upkeepMult, CAPS.upkeepMult.min, CAPS.upkeepMult.max),
    foodMult: clamp(m.foodMult, CAPS.foodMult.min, CAPS.foodMult.max),
    trainDaysDelta: Math.max(CAPS.trainDaysDelta, Math.round(m.trainDaysDelta)),
    trainSlotsDelta: clamp(Math.round(m.trainSlotsDelta), 0, CAPS.trainSlotsDelta),
    trainXpMult: clamp(m.trainXpMult, 0, CAPS.trainXpMult),
    lootMult: clamp(m.lootMult, 0, CAPS.lootMult),
    postBattleMoraleBonus: clamp(Math.round(m.postBattleMoraleBonus), 0, CAPS.postBattleMoraleBonus),
    unlocks: m.unlocks,
  }
}
