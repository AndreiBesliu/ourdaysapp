// src/logic/combat/stats.ts
// Combat stat tables + counter matrices + terrain modifiers. Pure data + resolvers.
// These numbers are a first pass, tuned for a real rock-paper-scissors and multi-turn
// battles; expect playtest calibration. Mirrors the flat Record<SoldierType, ...> style
// of UPKEEP_BASE/FOOD_BASE in economy.ts.

import type { SoldierType, Weapon } from '../types'
import type { CombatStats, ArmorClass, WeaponClass, TerrainType } from './types'

// ---- Global tunables ----
export const LETHALITY = 0.35 // scales kills-per-attack → battle length
export const COMBAT_XP_K = 100 // survivor XP = XP_K * kills / survivors
export const XP_CAP = 60
export const ROUT_THRESHOLD = 10 // morale <= this → unit can only flee, deals 0 damage
export const RETAL_FACTOR = 0.5 // melee retaliation strength multiplier
export const COUNTER_MIN = 0.4
export const COUNTER_MAX = 2.5

// Morale → effectiveness multiplier (same curve as computeReady): 100→1.0, 50→0.75, 0→0.5.
export function moraleCurve(m: number): number {
  const c = Math.max(0, Math.min(100, m))
  return 0.5 + 0.5 * (c / 100)
}

export const DEFAULT_COMBAT_STATS: Record<SoldierType, CombatStats> = {
  LIGHT_INF_SWORD:   { atk: 12, def: 8,  range: 1, speed: 4, armorClass: 'light', weaponClass: 'sword',   mounted: false, chargeBonus: 1.0, hasShield: true },
  LIGHT_INF_SPEAR:   { atk: 10, def: 9,  range: 1, speed: 4, armorClass: 'light', weaponClass: 'spear',   mounted: false, chargeBonus: 1.0, hasShield: true },
  LIGHT_INF_HALBERD: { atk: 13, def: 7,  range: 1, speed: 4, armorClass: 'light', weaponClass: 'halberd', mounted: false, chargeBonus: 1.0, hasShield: true },
  HEAVY_INF_SWORD:   { atk: 14, def: 16, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'sword',   mounted: false, chargeBonus: 1.0, hasShield: true },
  HEAVY_INF_SPEAR:   { atk: 12, def: 17, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'spear',   mounted: false, chargeBonus: 1.0, hasShield: true },
  HEAVY_INF_HALBERD: { atk: 16, def: 15, range: 1, speed: 3, armorClass: 'heavy', weaponClass: 'halberd', mounted: false, chargeBonus: 1.0, hasShield: true },
  LIGHT_ARCHER:      { atk: 11, def: 4,  range: 3, speed: 4, armorClass: 'light', weaponClass: 'bow',     mounted: false, chargeBonus: 1.0, hasShield: false },
  HEAVY_ARCHER:      { atk: 12, def: 10, range: 3, speed: 3, armorClass: 'heavy', weaponClass: 'bow',     mounted: false, chargeBonus: 1.0, hasShield: false },
  LIGHT_CAV:         { atk: 16, def: 9,  range: 1, speed: 7, armorClass: 'light', weaponClass: 'spear',   mounted: true,  chargeBonus: 1.6, hasShield: false },
  HEAVY_CAV:         { atk: 20, def: 16, range: 1, speed: 6, armorClass: 'heavy', weaponClass: 'halberd', mounted: true,  chargeBonus: 1.8, hasShield: false },
  HORSE_ARCHER:      { atk: 11, def: 6,  range: 3, speed: 7, armorClass: 'light', weaponClass: 'bow',     mounted: true,  chargeBonus: 1.0, hasShield: false },
}

// weaponVsArmor[weapon][defenderArmorClass]
export const weaponVsArmor: Record<WeaponClass, Record<ArmorClass, number>> = {
  sword:   { none: 1.2, light: 1.1, heavy: 0.8 },
  spear:   { none: 1.0, light: 1.0, heavy: 0.9 },
  halberd: { none: 1.0, light: 1.1, heavy: 1.5 },
  bow:     { none: 1.3, light: 1.0, heavy: 0.5 },
}

// weaponVsMounted[weapon] applied when the DEFENDER is mounted (×1.0 otherwise)
export const weaponVsMounted: Record<WeaponClass, number> = {
  spear: 1.75,
  halberd: 1.5,
  sword: 0.9,
  bow: 1.0,
}

export const CAV_VS_RANGED = 1.4 // mounted melee attacker vs a non-mounted bow user
export const SHIELD_VS_BOW = 1.3 // defender def multiplier vs bow when they carry a shield
export const BRACE_MULT = 1.5 // spear/halberd def bonus when receiving a mounted charge
export const BRACE_CHARGE_NEGATE = 0.3 // braced defender keeps only 30% of the charge bonus

export function weaponClassFromLoadout(w?: Weapon): WeaponClass | undefined {
  if (!w) return undefined
  if (w === 'SWORD') return 'sword'
  if (w === 'SPEAR') return 'spear'
  if (w === 'HALBERD') return 'halberd'
  if (w === 'BOW') return 'bow'
  return undefined
}

// Resolve stats: mod override wins, else default table; weaponClass may be overridden
// by the unit's actual loadout weapon. `override` is INJECTED (never read from the
// Registry singleton) so a Cloud Function can resolve stats without booting the client.
export function resolveStats(
  type: SoldierType,
  loadoutWeapon?: Weapon,
  override?: Partial<CombatStats>,
): CombatStats {
  const base = DEFAULT_COMBAT_STATS[type]
  const merged: CombatStats = override ? { ...base, ...override } : { ...base }
  const wc = weaponClassFromLoadout(loadoutWeapon)
  if (wc) merged.weaponClass = wc
  return merged
}

// ---- Terrain ----
export interface TerrainMods {
  moveCost: number
  moveCostMounted: number
  defMult: number
  atkMult: number
  chargeMult: number
  rangedAtkMult: number
  rangeBonus: number // added to ranged attacker's range when standing here
  blocksLosBeyond: number // ranged LOS blocked beyond this many tiles (0 = no limit)
}

export const TERRAIN: Record<TerrainType, TerrainMods> = {
  PLAINS: { moveCost: 1, moveCostMounted: 1, defMult: 1.0,  atkMult: 1.0, chargeMult: 1.0, rangedAtkMult: 1.0, rangeBonus: 0, blocksLosBeyond: 0 },
  FOREST: { moveCost: 2, moveCostMounted: 3, defMult: 1.1,  atkMult: 1.0, chargeMult: 0.5, rangedAtkMult: 0.8, rangeBonus: 0, blocksLosBeyond: 1 },
  HILL:   { moveCost: 2, moveCostMounted: 2, defMult: 1.25, atkMult: 1.1, chargeMult: 1.0, rangedAtkMult: 1.15, rangeBonus: 1, blocksLosBeyond: 0 },
  RIVER:  { moveCost: 3, moveCostMounted: 3, defMult: 0.8,  atkMult: 0.7, chargeMult: 0.0, rangedAtkMult: 1.0, rangeBonus: 0, blocksLosBeyond: 0 },
}
