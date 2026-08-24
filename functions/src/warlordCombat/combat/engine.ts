// src/logic/combat/engine.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// The pure, deterministic combat reducer. The same code runs client-side for PvE and inside
// a Cloud Function for PvP, which has been live for months. No React, no Firestore, no clock.
//
// applyCommand(state, cmd) -> state is the single entry point for advancing a battle.
// An illegal/stale command returns state unchanged with a `skipped` log entry — it
// never throws, so a bad client message can't desync a PvP match.

import type { SoldierType } from '../types'
import type {
  BattleState, Combatant, Command, Side, TerrainType, BattleConfig, Difficulty, CombatStats,
} from './types'
import { hash32, mulberry32Once } from './rng'
import {
  resolveStats, TERRAIN, weaponVsArmor, weaponVsMounted, moraleCurve,
  CAV_VS_RANGED, SHIELD_VS_BOW, BRACE_MULT, BRACE_CHARGE_NEGATE,
  LETHALITY, RETAL_FACTOR, ROUT_THRESHOLD, COUNTER_MIN, COUNTER_MAX,
} from './stats'

const DEFAULT_CONFIG: BattleConfig = { lethality: LETHALITY, maxTurns: 40 }

// ---- Small pure helpers ----

export function moraleMult(m: number): number {
  return moraleCurve(m)
}

export function inBounds(s: BattleState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.width && y < s.height
}

export function terrainAt(s: BattleState, x: number, y: number): TerrainType {
  const row = s.terrain[String(y)]
  return (row && row[x]) || 'PLAINS'
}

export function combatantById(s: BattleState, id: string): Combatant | undefined {
  return s.combatants.find((c) => c.id === id)
}

export function combatantAt(s: BattleState, x: number, y: number): Combatant | undefined {
  return s.combatants.find((c) => c.x === x && c.y === y && c.hp > 0)
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

function statsOf(c: Combatant): CombatStats {
  return resolveStats(c.type as SoldierType, c.loadoutWeapon, c.statsOverride)
}

function cloneState(s: BattleState): BattleState {
  return structuredClone(s)
}

// Draw one deterministic float in [0,1) and advance the state's rng cursor in place.
function draw(s: BattleState): number {
  const v = mulberry32Once(hash32(s.seed, s.rngCursor))
  s.rngCursor++
  return v
}

// ---- Line of sight (ranged) ----
// Blocked if any strictly-intermediate tile is FOREST (forest blocks LOS beyond 1 tile).
export function hasLineOfSight(s: BattleState, ax: number, ay: number, bx: number, by: number): boolean {
  const steps = chebyshev(ax, ay, bx, by)
  if (steps <= 1) return true
  for (let i = 1; i < steps; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / steps)
    const y = Math.round(ay + ((by - ay) * i) / steps)
    if (terrainAt(s, x, y) === 'FOREST') return false
  }
  return true
}

// ---- Movement ----
const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

// Reachable, unoccupied tiles within the unit's move budget (uniform-cost search over
// terrain move cost). Occupied tiles are impassable (can't pass through or stop on them).
export function legalMoves(s: BattleState, id: string): { x: number; y: number }[] {
  const c = combatantById(s, id)
  if (!c || c.hp <= 0 || c.routed || c.hasMoved) return []
  const st = statsOf(c)
  const budget = st.speed
  const key = (x: number, y: number) => `${x},${y}`
  const dist: Record<string, number> = { [key(c.x, c.y)]: 0 }
  // simple Dijkstra with a linear frontier (grids are tiny)
  const frontier: { x: number; y: number }[] = [{ x: c.x, y: c.y }]
  const out: { x: number; y: number }[] = []
  while (frontier.length) {
    // pop the lowest-dist node
    let bi = 0
    for (let i = 1; i < frontier.length; i++) {
      if (dist[key(frontier[i].x, frontier[i].y)] < dist[key(frontier[bi].x, frontier[bi].y)]) bi = i
    }
    const cur = frontier.splice(bi, 1)[0]
    const curD = dist[key(cur.x, cur.y)]
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx
      const ny = cur.y + dy
      if (!inBounds(s, nx, ny)) continue
      if (combatantAt(s, nx, ny)) continue // impassable
      const t = TERRAIN[terrainAt(s, nx, ny)]
      const cost = st.mounted ? t.moveCostMounted : t.moveCost
      const nd = curD + cost
      if (nd > budget) continue
      const k = key(nx, ny)
      if (dist[k] === undefined || nd < dist[k]) {
        dist[k] = nd
        frontier.push({ x: nx, y: ny })
        out.push({ x: nx, y: ny })
      }
    }
  }
  // de-dup (a tile may be pushed twice with improving dist)
  const seen = new Set<string>()
  return out.filter((p) => {
    const k = key(p.x, p.y)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function effectiveRange(s: BattleState, c: Combatant): number {
  const st = statsOf(c)
  const isRanged = st.range >= 2
  const bonus = isRanged ? TERRAIN[terrainAt(s, c.x, c.y)].rangeBonus : 0
  return st.range + bonus
}

export function legalTargets(s: BattleState, id: string): string[] {
  const c = combatantById(s, id)
  if (!c || c.hp <= 0 || c.routed || c.hasActed) return []
  const range = effectiveRange(s, c)
  const out: string[] = []
  for (const t of s.combatants) {
    if (t.side === c.side || t.hp <= 0) continue
    const d = chebyshev(c.x, c.y, t.x, t.y)
    if (d < 1 || d > range) continue
    if (d >= 2 && !hasLineOfSight(s, c.x, c.y, t.x, t.y)) continue
    out.push(t.id)
  }
  return out
}

// ---- Damage ----
interface DamageOpts {
  isMelee: boolean
  allowCharge: boolean
  factor: number // 1.0 primary, RETAL_FACTOR for retaliation
}

interface KillsCoreOpts {
  isMelee: boolean
  allowCharge: boolean
  factor: number
  variance: number
  aX: number
  aY: number
  aMoved: boolean
}

// Pure kills computation with EXPLICIT variance and attacker position — no rng access,
// no state mutation. Both real resolution (variance from rng) and the AI's mean-damage
// estimate (variance = 1.0, hypothetical position) go through this one function.
function computeKillsCore(s: BattleState, a: Combatant, d: Combatant, o: KillsCoreOpts): number {
  const sa = statsOf(a)
  const sd = statsOf(d)
  const aTile = TERRAIN[terrainAt(s, o.aX, o.aY)]
  const dTile = TERRAIN[terrainAt(s, d.x, d.y)]
  const isRanged = !o.isMelee

  let atk = sa.atk * (1 + 0.1 * a.vet) * moraleCurve(a.morale)
  if (sa.weaponClass === 'bow' && o.isMelee) atk *= 0.5 // archers are weak in melee

  const braced = o.isMelee && sa.mounted && (sd.weaponClass === 'spear' || sd.weaponClass === 'halberd')
  const braceMult = braced ? BRACE_MULT : 1.0
  const shieldMult = sd.hasShield && sa.weaponClass === 'bow' ? SHIELD_VS_BOW : 1.0
  const def = sd.def * (1 + 0.08 * d.vet) * dTile.defMult * braceMult * shieldMult

  let counter = weaponVsArmor[sa.weaponClass][sd.armorClass]
  if (sd.mounted && o.isMelee) counter *= weaponVsMounted[sa.weaponClass]
  if (o.isMelee && sa.mounted && sd.weaponClass === 'bow' && !sd.mounted) counter *= CAV_VS_RANGED
  counter = Math.max(COUNTER_MIN, Math.min(COUNTER_MAX, counter))

  let charge = 1.0
  if (o.allowCharge && sa.mounted && o.aMoved && o.isMelee) {
    charge = sa.chargeBonus * aTile.chargeMult
    if (braced) charge = 1 + (charge - 1) * BRACE_CHARGE_NEGATE
  }

  const terrainAtk = isRanged ? aTile.rangedAtkMult : aTile.atkMult
  const ratio = atk / (atk + def)
  const raw = a.hp * ratio * counter * charge * terrainAtk * s.config.lethality * o.variance * o.factor
  return Math.max(0, Math.min(Math.round(raw), d.hp))
}

// Real damage: consumes exactly one rng draw (variance), advancing the state cursor.
function resolveDamage(s: BattleState, a: Combatant, d: Combatant, opts: DamageOpts): number {
  const variance = 0.9 + 0.2 * draw(s)
  return computeKillsCore(s, a, d, {
    isMelee: opts.isMelee, allowCharge: opts.allowCharge, factor: opts.factor,
    variance, aX: a.x, aY: a.y, aMoved: a.hasMoved,
  })
}

// Mean-damage estimate for AI planning: no rng, no mutation. Attacker may be evaluated
// at a hypothetical tile (aX/aY) with aMoved=true to score a charge after moving.
export function estimateKills(
  s: BattleState, a: Combatant, d: Combatant,
  opts: { isMelee: boolean; allowCharge?: boolean; aX?: number; aY?: number; aMoved?: boolean; factor?: number },
): number {
  return computeKillsCore(s, a, d, {
    isMelee: opts.isMelee,
    allowCharge: opts.allowCharge ?? true,
    factor: opts.factor ?? 1.0,
    variance: 1.0,
    aX: opts.aX ?? a.x,
    aY: opts.aY ?? a.y,
    aMoved: opts.aMoved ?? a.hasMoved,
  })
}

export interface AttackForecast {
  targetId: string
  targetName: string
  melee: boolean
  kills: number // expected enemy soldiers killed (mean variance)
  retalKills: number // expected own soldiers lost to retaliation (0 for ranged)
  lethal: boolean // expected to destroy the target outright
}

// Player-facing attack preview: mean-variance estimate of an attack and the likely
// retaliation. Pure — consumes NO rng and never mutates state, so showing it cannot
// desync a battle (critical for PvP later). Returns null for illegal targets.
export function forecastAttack(s: BattleState, attackerId: string, targetId: string): AttackForecast | null {
  const a = combatantById(s, attackerId)
  const d = combatantById(s, targetId)
  if (!a || !d) return null
  if (!legalTargets(s, attackerId).includes(targetId)) return null

  const melee = chebyshev(a.x, a.y, d.x, d.y) <= 1
  const kills = estimateKills(s, a, d, { isMelee: melee, allowCharge: true })
  const hpAfter = d.hp - kills

  let retalKills = 0
  if (melee && hpAfter > 0) {
    // Mirror the real retaliation rules: survivor retaliates unless the morale hit routs it.
    const lossFrac = kills / Math.max(1, d.hp)
    const moraleAfter = Math.max(0, Math.min(100, d.morale - Math.round(20 * lossFrac)))
    if (moraleAfter > ROUT_THRESHOLD) {
      const dAfter: Combatant = { ...d, hp: hpAfter, morale: moraleAfter }
      retalKills = estimateKills(s, dAfter, a, { isMelee: true, allowCharge: false, factor: RETAL_FACTOR })
    }
  }

  return { targetId, targetName: d.name, melee, kills, retalKills, lethal: hpAfter <= 0 }
}

function applyMoraleHit(c: Combatant, kills: number, hpBefore: number): void {
  const lossFrac = kills / Math.max(1, hpBefore)
  c.morale = Math.max(0, Math.min(100, c.morale - Math.round(20 * lossFrac)))
  if (c.morale <= ROUT_THRESHOLD) c.routed = true
}

// ---- Reducer ----

export function applyCommand(state: BattleState, cmd: Command): BattleState {
  if (state.status !== 'ONGOING') return state
  const s = cloneState(state)

  if (cmd.kind === 'END_TURN') return endTurn(s)

  const actor = combatantById(s, cmd.id)
  if (!actor || actor.side !== s.side || actor.hp <= 0 || actor.routed) {
    return skip(s, cmd)
  }

  if (cmd.kind === 'MOVE') {
    if (actor.hasMoved) return skip(s, cmd)
    const legal = legalMoves(s, actor.id).some((p) => p.x === cmd.to.x && p.y === cmd.to.y)
    if (!legal) return skip(s, cmd)
    const fromX = actor.x
    const fromY = actor.y
    actor.x = cmd.to.x
    actor.y = cmd.to.y
    actor.hasMoved = true
    s.log.push({ turn: s.turn, side: s.side, kind: 'move', actorId: actor.id, detail: { fromX, fromY, toX: cmd.to.x, toY: cmd.to.y } })
    return s
  }

  // ATTACK
  if (actor.hasActed) return skip(s, cmd)
  if (!legalTargets(s, actor.id).includes(cmd.targetId)) return skip(s, cmd)
  const target = combatantById(s, cmd.targetId)!

  const dist = chebyshev(actor.x, actor.y, target.x, target.y)
  const isMelee = dist <= 1
  actor.hasActed = true

  const defHpBefore = target.hp
  const kills = resolveDamage(s, actor, target, { isMelee, allowCharge: true, factor: 1.0 })
  target.hp -= kills
  actor.kills += kills
  applyMoraleHit(target, kills, defHpBefore)
  s.log.push({
    turn: s.turn, side: s.side, kind: 'attack', actorId: actor.id, targetId: target.id,
    detail: { kills, melee: isMelee ? 1 : 0, targetHp: Math.max(0, target.hp), targetMorale: target.morale },
  })

  if (target.hp <= 0) {
    s.log.push({ turn: s.turn, side: s.side, kind: 'destroyed', targetId: target.id, detail: { name: target.name } })
  } else if (isMelee && !target.routed) {
    // Melee retaliation (single, no charge, no counter-retaliation)
    const atkHpBefore = actor.hp
    const rk = resolveDamage(s, target, actor, { isMelee: true, allowCharge: false, factor: RETAL_FACTOR })
    actor.hp -= rk
    target.kills += rk
    applyMoraleHit(actor, rk, atkHpBefore)
    s.log.push({
      turn: s.turn, side: target.side, kind: 'retaliate', actorId: target.id, targetId: actor.id,
      detail: { kills: rk, targetHp: Math.max(0, actor.hp) },
    })
    if (actor.hp <= 0) {
      s.log.push({ turn: s.turn, side: target.side, kind: 'destroyed', targetId: actor.id, detail: { name: actor.name } })
    }
  }

  // Destroyed combatants STAY in the array (hp 0). Every consumer already filters on
  // hp > 0 (combatantAt, legalTargets, sideActive, the AI, the grid) — keeping them
  // preserves their kill counts for the battle report and post-battle XP write-back.
  return checkVictory(s)
}

function skip(s: BattleState, cmd: Command): BattleState {
  s.log.push({ turn: s.turn, side: s.side, kind: 'skipped', detail: { cmd: cmd.kind, id: (cmd as any).id ?? '' } })
  return s
}

function endTurn(s: BattleState): BattleState {
  const nextSide: Side = s.side === 'PLAYER' ? 'ENEMY' : 'PLAYER'
  for (const c of s.combatants) {
    if (c.side === nextSide) {
      c.hasMoved = false
      c.hasActed = false
    }
  }
  if (nextSide === 'PLAYER') s.turn++
  s.side = nextSide
  s.phase = nextSide === 'PLAYER' ? 'PLAYER_TURN' : 'ENEMY_TURN'
  s.log.push({ turn: s.turn, side: s.side, kind: 'end_turn' })
  return checkVictory(s)
}

function sideActive(s: BattleState, side: Side): boolean {
  return s.combatants.some((c) => c.side === side && c.hp > 0 && !c.routed)
}

export function checkVictory(s: BattleState): BattleState {
  const p = sideActive(s, 'PLAYER')
  const e = sideActive(s, 'ENEMY')
  if (!p && !e) {
    s.status = 'DRAW'; s.winner = null; s.phase = 'RESOLVED'
  } else if (!e) {
    s.status = 'PLAYER_WON'; s.winner = 'PLAYER'; s.phase = 'RESOLVED'
  } else if (!p) {
    s.status = 'ENEMY_WON'; s.winner = 'ENEMY'; s.phase = 'RESOLVED'
  } else if (s.turn > s.config.maxTurns) {
    const hp = (side: Side) => s.combatants.filter((c) => c.side === side).reduce((a, c) => a + c.hp, 0)
    const ph = hp('PLAYER'); const eh = hp('ENEMY')
    s.status = ph > eh ? 'PLAYER_WON' : eh > ph ? 'ENEMY_WON' : 'DRAW'
    s.winner = s.status === 'PLAYER_WON' ? 'PLAYER' : s.status === 'ENEMY_WON' ? 'ENEMY' : null
    s.phase = 'RESOLVED'
  }
  if (s.phase === 'RESOLVED' && s.status !== 'ONGOING') {
    s.log.push({ turn: s.turn, side: s.side, kind: 'victory', detail: { status: s.status } })
  }
  return s
}

export function buildBattle(params: {
  playerCombatants: Combatant[]
  enemyCombatants: Combatant[]
  terrain: Record<string, TerrainType[]>
  width: number
  height: number
  seed: number
  difficulty: Difficulty
  config?: BattleConfig
}): BattleState {
  const s: BattleState = {
    version: 1,
    seed: params.seed >>> 0,
    rngCursor: 0,
    width: params.width,
    height: params.height,
    terrain: params.terrain,
    combatants: [...params.playerCombatants, ...params.enemyCombatants],
    turn: 1,
    side: 'PLAYER',
    phase: 'PLAYER_TURN',
    status: 'ONGOING',
    winner: null,
    log: [{ turn: 1, side: 'PLAYER', kind: 'start', detail: { difficulty: params.difficulty } }],
    config: params.config ?? { ...DEFAULT_CONFIG },
    difficulty: params.difficulty,
  }
  return s
}
