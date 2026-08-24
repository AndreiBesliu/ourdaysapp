// src/logic/combat/pvp.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// PvP battle setup + deploy-payload sanitization. PURE: no React, no firebase, no Registry.
//
// Trust model: each player's army lives only in their own localStorage, so a deploy
// payload is inherently client-claimed. The server cannot verify provenance — it
// BOUNDS the claim instead: sanitizeDeploy rebuilds clean Combatants from a whitelist
// of fields, derives everything derivable (vet, hpStart, ids, positions) and caps the
// rest. statsOverride (mods) is dropped entirely: PvP is vanilla-stats.

import type { SoldierType, UnitBucket, Rank } from '../types'
import { SoldierTypes, Ranks, RankNumber } from '../types'
import type { BattleState, Combatant, Side, TerrainType } from './types'
import { makeRng } from './rng'
import { buildBattle } from './engine'

export const PVP_WIDTH = 12
export const PVP_HEIGHT = 8
export const PVP_MAX_COMBATANTS = 12 // per side: two spawn rows hold 24 tiles
export const PVP_MAX_SOLDIERS_PER_UNIT = 500
export const PVP_MAX_SOLDIERS_TOTAL = 2000
export const PVP_MAX_BUCKETS = 5 // one per rank

// Minimal wire shape a client submits per unit — everything else is server-derived.
// NOTE: no loadoutWeapon. A weapon that mismatches the type (e.g. an archer with a
// halberd) would keep the type's range/atk/def but swap weaponClass in resolveStats —
// a stat profile that can't exist in normal play (there's no weapon-swap UI). PvP is
// strictly vanilla stats, so the weapon is ALWAYS the type's default (never claimed).
export interface DeployCombatantClaim {
  unitId: string
  type: SoldierType
  hp: number
  morale: number
  buckets: UnitBucket[]
}

export type SanitizeResult =
  | { ok: true; combatants: Combatant[]; unitIds: string[] }
  | { ok: false; error: string }

function prettyName(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function weightedVet(buckets: UnitBucket[]): number {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  if (total <= 0) return 0
  const wx = buckets.reduce((a, b) => a + b.count * RankNumber[b.r], 0)
  return wx / total
}

// Rebuild clean Combatants from an untrusted claim. Never pass-through: unknown or
// forbidden fields are simply never read. Returns a structured error on any violation.
export function sanitizeDeploy(raw: unknown, side: Side): SanitizeResult {
  const data = raw as { unitIds?: unknown; combatants?: unknown } | null | undefined
  const claims = data?.combatants
  const unitIds = data?.unitIds
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > PVP_MAX_COMBATANTS) {
    return { ok: false, error: `combatants must be an array of 1..${PVP_MAX_COMBATANTS}` }
  }
  if (!Array.isArray(unitIds) || unitIds.length !== claims.length) {
    return { ok: false, error: 'unitIds must match combatants length' }
  }

  const seenUnitIds = new Set<string>()
  const out: Combatant[] = []
  let totalSoldiers = 0

  for (let i = 0; i < claims.length; i++) {
    const c = claims[i] as Partial<DeployCombatantClaim> | null | undefined
    const where = `combatants[${i}]`
    if (!c || typeof c !== 'object') return { ok: false, error: `${where} is not an object` }

    const unitId = c.unitId
    if (typeof unitId !== 'string' || unitId.length < 1 || unitId.length > 40) {
      return { ok: false, error: `${where}.unitId invalid` }
    }
    if (seenUnitIds.has(unitId)) return { ok: false, error: `duplicate unitId ${unitId}` }
    seenUnitIds.add(unitId)
    if (unitIds[i] !== unitId) return { ok: false, error: `unitIds[${i}] does not match ${where}.unitId` }

    if (typeof c.type !== 'string' || !(SoldierTypes as readonly string[]).includes(c.type)) {
      return { ok: false, error: `${where}.type invalid` }
    }

    const hp = c.hp
    if (!Number.isInteger(hp) || (hp as number) < 1 || (hp as number) > PVP_MAX_SOLDIERS_PER_UNIT) {
      return { ok: false, error: `${where}.hp must be an integer 1..${PVP_MAX_SOLDIERS_PER_UNIT}` }
    }
    const morale = c.morale
    if (!Number.isInteger(morale) || (morale as number) < 0 || (morale as number) > 100) {
      return { ok: false, error: `${where}.morale must be an integer 0..100` }
    }

    const buckets = c.buckets
    if (!Array.isArray(buckets) || buckets.length < 1 || buckets.length > PVP_MAX_BUCKETS) {
      return { ok: false, error: `${where}.buckets must be an array of 1..${PVP_MAX_BUCKETS}` }
    }
    let bucketTotal = 0
    const cleanBuckets: UnitBucket[] = []
    for (const b of buckets) {
      const bb = b as Partial<UnitBucket> | null | undefined
      if (!bb || typeof bb !== 'object') return { ok: false, error: `${where}.buckets entry invalid` }
      if (typeof bb.r !== 'string' || !(Ranks as readonly string[]).includes(bb.r)) {
        return { ok: false, error: `${where}.buckets rank invalid` }
      }
      if (!Number.isInteger(bb.count) || (bb.count as number) < 1) {
        return { ok: false, error: `${where}.buckets count invalid` }
      }
      if (typeof bb.avgXP !== 'number' || !Number.isFinite(bb.avgXP) || bb.avgXP < 0 || bb.avgXP > 100000) {
        return { ok: false, error: `${where}.buckets avgXP invalid` }
      }
      bucketTotal += bb.count as number
      cleanBuckets.push({ r: bb.r as Rank, count: bb.count as number, avgXP: Math.floor(bb.avgXP) })
    }
    if ((hp as number) > bucketTotal) {
      return { ok: false, error: `${where}.hp exceeds bucket total` }
    }
    totalSoldiers += hp as number

    // Server-derived fields — the claim's id/side/positions/vet/kills are never read.
    out.push({
      id: `${side === 'PLAYER' ? 'P' : 'E'}${i}`,
      side,
      unitId,
      type: c.type as SoldierType,
      // loadoutWeapon intentionally OMITTED — weaponClass always resolves from the type.
      name: prettyName(c.type as string),
      x: -1,
      y: -1,
      hp: hp as number,
      hpStart: hp as number,
      morale: morale as number,
      vet: weightedVet(cleanBuckets),
      kills: 0,
      hasMoved: false,
      hasActed: false,
      routed: false,
      buckets: cleanBuckets,
      // statsOverride intentionally OMITTED: mods are local-only; PvP is vanilla stats.
    })
  }

  if (totalSoldiers > PVP_MAX_SOLDIERS_TOTAL) {
    return { ok: false, error: `total soldiers ${totalSoldiers} exceeds ${PVP_MAX_SOLDIERS_TOTAL}` }
  }
  return { ok: true, combatants: out, unitIds: out.map((c) => c.unitId) }
}

// Deterministic terrain for a PvP battlefield (same recipe as PvE's generateTerrain,
// duplicated here because enemies.ts is not part of the pure/shared set).
export function generatePvpTerrain(seed: number): Record<string, TerrainType[]> {
  const w = PVP_WIDTH
  const h = PVP_HEIGHT
  const rng = makeRng((seed ^ 0x7e44) >>> 0)
  const grid: TerrainType[][] = Array.from({ length: h }, () => Array<TerrainType>(w).fill('PLAINS'))

  const forestCount = Math.round(w * h * 0.1)
  for (let i = 0; i < forestCount; i++) {
    const x = Math.floor(rng() * w)
    const y = Math.floor(rng() * h)
    if (y < 1 || y > h - 2) continue
    grid[y][x] = 'FOREST'
  }

  const hx = Math.floor(w / 2) + (Math.floor(rng() * 3) - 1)
  const hy = Math.floor(h / 2)
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = hx + dx
    const y = hy + dy
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = 'HILL'
  }

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

function placePvpArmy(cs: Combatant[], w: number, rows: number[]): void {
  const perRow = w
  const n = Math.min(cs.length, perRow)
  const startCol = Math.max(0, Math.floor((w - n) / 2))
  cs.forEach((c, i) => {
    const rowIdx = Math.floor(i / perRow) % rows.length
    c.x = Math.min(w - 1, startCol + (i % perRow))
    c.y = rows[rowIdx]
  })
}

// Build the authoritative initial BattleState for a PvP match. Challenger = PLAYER
// side (bottom rows), defender = ENEMY side (top rows). Deterministic in (armies, seed).
// difficulty is a placeholder — PvP UIs derive labels from the game doc, never from it.
export function createPvpBattle(
  challengerCombatants: Combatant[],
  defenderCombatants: Combatant[],
  seed: number,
): BattleState {
  const terrain = generatePvpTerrain(seed)
  placePvpArmy(challengerCombatants, PVP_WIDTH, [PVP_HEIGHT - 1, PVP_HEIGHT - 2])
  placePvpArmy(defenderCombatants, PVP_WIDTH, [0, 1])
  return buildBattle({
    playerCombatants: challengerCombatants,
    enemyCombatants: defenderCombatants,
    terrain,
    width: PVP_WIDTH,
    height: PVP_HEIGHT,
    seed,
    difficulty: 'RIVAL_BARON',
  })
}
