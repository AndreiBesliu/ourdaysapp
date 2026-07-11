// src/logic/combat/ai.ts
// Deterministic enemy AI. chooseEnemyCommands(state) returns the full command list for
// the ENEMY turn, ending with END_TURN. It is a pure function of the state: no rng, no
// clock — identical state always yields identical commands. It plans with MEAN damage
// (estimateKills) and only consumes battle rng when the engine later APPLIES the commands.

import type { SoldierType } from '../types'
import type { BattleState, Combatant, Command } from './types'
import { resolveStats, TERRAIN } from './stats'
import {
  applyCommand, combatantById, legalMoves, hasLineOfSight, chebyshev, terrainAt, estimateKills,
} from './engine'

function idNum(id: string): number {
  const n = parseInt(id.slice(1), 10)
  return Number.isFinite(n) ? n : 0
}

interface Candidate {
  score: number
  move: Command | null
  attackTargetId: string
  expectedKills: number
  moved: boolean
}

function planUnit(s: BattleState, self: Combatant, shadowHp: Record<string, number>): Candidate | null {
  const st = resolveStats(self.type as SoldierType, self.loadoutWeapon)
  const isRanged = st.range >= 2
  const players = s.combatants.filter((c) => c.side === 'PLAYER' && (shadowHp[c.id] ?? c.hp) > 0)
  if (!players.length) return null

  const positions: { x: number; y: number; move: Command | null; moved: boolean }[] = [
    { x: self.x, y: self.y, move: null, moved: self.hasMoved },
    ...legalMoves(s, self.id).map((t) => ({ x: t.x, y: t.y, move: { kind: 'MOVE', id: self.id, to: { x: t.x, y: t.y } } as Command, moved: true })),
  ]

  let best: Candidate | null = null
  for (const pos of positions) {
    const range = st.range + (isRanged ? TERRAIN[terrainAt(s, pos.x, pos.y)].rangeBonus : 0)
    for (const t of players) {
      const d = chebyshev(pos.x, pos.y, t.x, t.y)
      if (d < 1 || d > range) continue
      if (d >= 2 && !hasLineOfSight(s, pos.x, pos.y, t.x, t.y)) continue
      const isMelee = d <= 1
      const expected = estimateKills(s, self, t, { isMelee, allowCharge: true, aX: pos.x, aY: pos.y, aMoved: pos.moved })
      const effHp = Math.max(1, shadowHp[t.id] ?? t.hp)
      const threat = 1 + resolveStats(t.type as SoldierType, t.loadoutWeapon).atk / 20
      let score = (expected / effHp) * threat
      if (expected >= effHp) score *= 2 // secure the kill
      if (isRanged) {
        if (isMelee) score *= 0.5 // ranged units avoid melee
        else score *= 1 + 0.05 * d // shoot from afar
      }
      // deterministic tie-break embedded: prefer higher score, then lower target id, then no-move
      if (!best || score > best.score + 1e-9) {
        best = { score, move: pos.move, attackTargetId: t.id, expectedKills: expected, moved: pos.moved }
      }
    }
  }
  if (best) return best

  // No shot available: advance toward the nearest player.
  let target = players[0]
  let bestD = chebyshev(self.x, self.y, target.x, target.y)
  for (const p of players) {
    const d = chebyshev(self.x, self.y, p.x, p.y)
    if (d < bestD) { bestD = d; target = p }
  }
  const moves = legalMoves(s, self.id)
  let bestTile: { x: number; y: number } | null = null
  let bestTileD = bestD
  for (const m of moves) {
    const d = chebyshev(m.x, m.y, target.x, target.y)
    if (d < bestTileD) { bestTileD = d; bestTile = m }
  }
  if (bestTile) {
    return { score: 0, move: { kind: 'MOVE', id: self.id, to: bestTile }, attackTargetId: '', expectedKills: 0, moved: true }
  }
  return null
}

export function chooseEnemyCommands(state: BattleState): Command[] {
  const cmds: Command[] = []
  if (state.status !== 'ONGOING' || state.side !== 'ENEMY') return [{ kind: 'END_TURN' }]

  let s = structuredClone(state)
  const shadowHp: Record<string, number> = {}
  for (const c of s.combatants) shadowHp[c.id] = c.hp

  const enemies = s.combatants
    .filter((c) => c.side === 'ENEMY' && c.hp > 0 && !c.routed)
    .sort((a, b) => idNum(a.id) - idNum(b.id))

  for (const e of enemies) {
    const self = combatantById(s, e.id)
    if (!self || self.hp <= 0 || self.routed) continue
    const plan = planUnit(s, self, shadowHp)
    if (!plan) continue
    if (plan.move) {
      s = applyCommand(s, plan.move) // positions only, no rng — keeps occupancy correct for later units
      cmds.push(plan.move)
    }
    if (plan.attackTargetId) {
      cmds.push({ kind: 'ATTACK', id: self.id, targetId: plan.attackTargetId })
      shadowHp[plan.attackTargetId] = (shadowHp[plan.attackTargetId] ?? 0) - plan.expectedKills
    }
  }

  cmds.push({ kind: 'END_TURN' })
  return cmds
}
