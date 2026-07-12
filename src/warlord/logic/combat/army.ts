// src/logic/combat/army.ts
// Bridge between the persistent army (Unit[]) and the battle (Combatant[]).
// This is where the economy loop closes: casualties from a battle are written back
// into the real units, veterans survive preferentially, survivors gain XP, and
// destroyed units are removed from the army.

import type { Unit, UnitBucket, Rank, Weapon } from '../types'
import { Ranks, RankNumber } from '../types'
import { computeEquipped, computeUnitAvgXP, promoteBuckets, type Promotion } from '../units'
import { Registry } from '../registry'
import type { BattleState, Combatant, Side } from './types'
import { COMBAT_XP_K, XP_CAP } from './stats'

function unitSize(u: Unit): number {
  return u.buckets.reduce((a, b) => a + b.count, 0)
}

function weightedVet(buckets: UnitBucket[]): number {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  if (total <= 0) return 0
  const wx = buckets.reduce((a, b) => a + b.count * RankNumber[b.r], 0)
  return wx / total
}

export function prettyName(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Fielded soldiers that show up to the battle. `computeEquipped` returns 0 when the
// unit has no equip data stamped on it (the current game consumes gear from inventory
// at creation, leaving `equip` empty) — in that case the whole headcount is fielded.
// If a future change populates `equip`, the equipment coverage becomes a real cap.
export function fieldedStrength(u: Unit): number {
  const size = unitSize(u)
  const equipped = computeEquipped(u)
  return equipped > 0 ? Math.min(size, equipped) : size
}

export function unitToCombatant(u: Unit, side: Side, index: number): Combatant {
  const fielded = fieldedStrength(u)
  const override = Registry.getUnit(u.type)?.combat // moddable stat overrides, baked in
  return {
    id: `${side === 'PLAYER' ? 'P' : 'E'}${index}`,
    side,
    unitId: u.id,
    type: u.type,
    loadoutWeapon: u.loadout?.weapon as Weapon | undefined,
    name: prettyName(u.type),
    x: -1,
    y: -1,
    hp: fielded,
    hpStart: fielded,
    morale: u.morale ?? 100,
    vet: weightedVet(u.buckets),
    kills: 0,
    hasMoved: false,
    hasActed: false,
    routed: false,
    buckets: structuredClone(u.buckets),
    ...(override ? { statsOverride: override } : {}),
  }
}

// Remove `killCount` soldiers lowest-rank-first (green troops break and die first;
// veterans hold). Returns the surviving buckets (emptied buckets dropped).
function applyKillsLowestRankFirst(buckets: UnitBucket[], killCount: number): UnitBucket[] {
  const copy = buckets.map((b) => ({ ...b }))
  let remaining = killCount
  for (const rank of Ranks as Rank[]) {
    if (remaining <= 0) break
    const b = copy.find((x) => x.r === rank)
    if (!b) continue
    const take = Math.min(b.count, remaining)
    b.count -= take
    remaining -= take
  }
  return copy.filter((b) => b.count > 0)
}

function applyCasualtiesToUnit(
  u: Unit, c: Combatant, won: boolean,
): { unit: Unit | null; xpGain: number; promotions: Promotion[] } {
  const survivors = c.hp
  if (survivors <= 0) return { unit: null, xpGain: 0, promotions: [] }
  const killCount = Math.max(0, c.hpStart - survivors)

  const kept = applyKillsLowestRankFirst(u.buckets, killCount)
  if (kept.length === 0) return { unit: null, xpGain: 0, promotions: [] }

  const survCount = kept.reduce((a, b) => a + b.count, 0)
  let xpGain = Math.min(XP_CAP, Math.round((COMBAT_XP_K * c.kills) / Math.max(1, survCount)))
  if (!won) xpGain = Math.round(xpGain * 0.4)
  if (xpGain > 0) for (const b of kept) b.avgXP += xpGain

  // Battle veterancy: XP crossing a rank threshold promotes on the spot.
  const { buckets: promoted, promotions } = promoteBuckets(kept)

  const lossFrac = killCount / Math.max(1, c.hpStart)
  const delta = won ? 10 - Math.round(20 * lossFrac) : -15 - Math.round(30 * lossFrac)
  const morale = Math.max(0, Math.min(100, c.morale + delta))

  return {
    unit: { ...u, buckets: promoted, avgXP: computeUnitAvgXP(promoted), morale },
    xpGain,
    promotions,
  }
}

// Per-unit battle report line, shown on the result screen.
export interface UnitReport {
  unitId: string
  name: string
  type: string
  fielded: number
  lost: number
  survivors: number
  xpGain: number
  destroyed: boolean
  promotions: Promotion[]
}

export interface BattleOutcome {
  units: Unit[]
  won: boolean
  totalLosses: number
  totalKills: number
  destroyed: number
  report: UnitReport[]
}

// Apply a finished battle to the army. Only units in `deployedUnitIds` are touched;
// undeployed units pass through unchanged. Destroyed units are removed.
export function applyBattleResult(units: Unit[], finalState: BattleState, deployedUnitIds: string[]): BattleOutcome {
  const won = finalState.winner === 'PLAYER'
  const deployed = new Set(deployedUnitIds)
  const bySrc = new Map<string, Combatant>()
  for (const c of finalState.combatants) {
    if (c.side === 'PLAYER' && c.unitId) bySrc.set(c.unitId, c)
  }

  const out: Unit[] = []
  const report: UnitReport[] = []
  let totalLosses = 0
  let totalKills = 0
  let destroyed = 0

  for (const u of units) {
    if (!deployed.has(u.id)) {
      out.push(u)
      continue
    }
    const c = bySrc.get(u.id)
    const before = fieldedStrength(u)
    if (!c || c.hp <= 0) {
      totalLosses += before
      destroyed++
      if (c) totalKills += c.kills
      report.push({
        unitId: u.id, name: prettyName(u.type), type: u.type,
        fielded: before, lost: before, survivors: 0, xpGain: 0, destroyed: true, promotions: [],
      })
      continue
    }
    totalKills += c.kills
    totalLosses += Math.max(0, c.hpStart - c.hp)
    const res = applyCasualtiesToUnit(u, c, won)
    if (res.unit) {
      out.push(res.unit)
      report.push({
        unitId: u.id, name: prettyName(u.type), type: u.type,
        fielded: c.hpStart, lost: Math.max(0, c.hpStart - c.hp), survivors: c.hp,
        xpGain: res.xpGain, destroyed: false, promotions: res.promotions,
      })
    } else {
      destroyed++
      report.push({
        unitId: u.id, name: prettyName(u.type), type: u.type,
        fielded: c.hpStart, lost: c.hpStart, survivors: 0, xpGain: 0, destroyed: true, promotions: [],
      })
    }
  }

  return { units: out, won, totalLosses, totalKills, destroyed, report }
}

export function armyStrength(units: Unit[], ids?: string[]): number {
  const set = ids ? new Set(ids) : null
  let total = 0
  for (const u of units) {
    if (set && !set.has(u.id)) continue
    total += fieldedStrength(u)
  }
  return total
}
