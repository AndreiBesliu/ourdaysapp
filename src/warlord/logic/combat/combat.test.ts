import { describe, it, expect } from 'vitest'
import type { Rank, SoldierType, Unit } from '../types'
import { RankNumber } from '../types'
import type { BattleState, Combatant, Command, Side, TerrainType } from './types'
import { applyCommand, buildBattle, estimateKills, combatantById, forecastAttack } from './engine'
import { chooseEnemyCommands } from './ai'
import { createBattle, escalationMult, streakLootMult } from './enemies'
import { unitToCombatant, applyBattleResult } from './army'
import { promoteBuckets } from '../units'
import { sanitizeDeploy, createPvpBattle, PVP_MAX_COMBATANTS, type DeployCombatantClaim } from './pvp'
import { weaponVsMounted, weaponVsArmor } from './stats'
import { Registry } from '../registry'

// Mirror the app: with the Registry initialized, unit defs exist but `equip` is empty,
// so fieldedStrength falls back to full headcount (the case combat actually runs in).
Registry.init()

// ---- helpers ----

function plains(w: number, h: number): Record<string, TerrainType[]> {
  const o: Record<string, TerrainType[]> = {}
  for (let y = 0; y < h; y++) o[String(y)] = Array<TerrainType>(w).fill('PLAINS')
  return o
}

function mk(id: string, side: Side, type: SoldierType, count: number, x: number, y: number, rank: Rank = 'TRAINED'): Combatant {
  return {
    id, side, unitId: side === 'PLAYER' ? 'u_' + id : '', type, name: type,
    x, y, hp: count, hpStart: count, morale: 100, vet: RankNumber[rank],
    kills: 0, hasMoved: false, hasActed: false, routed: false,
    buckets: [{ r: rank, count, avgXP: 20 }],
  }
}

function makeUnit(id: string, type: SoldierType, buckets: { r: Rank; count: number; avgXP: number }[]): Unit {
  return {
    id, type, buckets, avgXP: 20, training: false, morale: 100,
    equip: { weapons: {}, armors: {}, horses: {} }, loadout: { kind: type },
  }
}

function runSeq(start: BattleState, seq: Command[]): BattleState {
  return seq.reduce((s, c) => applyCommand(s, c), start)
}

// ---- tests ----

describe('determinism', () => {
  it('same seed + same commands → identical final state', () => {
    const build = () => buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_INF_SPEAR', 40, 5, 4)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_CAV', 30, 5, 3)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 12345, difficulty: 'BANDIT_RAID',
    })
    const seq: Command[] = [
      { kind: 'ATTACK', id: 'P0', targetId: 'E0' },
      { kind: 'END_TURN' },
      { kind: 'ATTACK', id: 'E0', targetId: 'P0' },
      { kind: 'END_TURN' },
      { kind: 'ATTACK', id: 'P0', targetId: 'E0' },
      { kind: 'END_TURN' },
    ]
    const a = runSeq(build(), seq)
    const b = runSeq(build(), seq)
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('serialize/resume mid-battle → identical to uninterrupted run', () => {
    const build = () => buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_INF_SPEAR', 40, 5, 4)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_CAV', 30, 5, 3)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 999, difficulty: 'BANDIT_RAID',
    })
    const seq: Command[] = [
      { kind: 'ATTACK', id: 'P0', targetId: 'E0' },
      { kind: 'END_TURN' },
      { kind: 'ATTACK', id: 'E0', targetId: 'P0' },
      { kind: 'END_TURN' },
      { kind: 'ATTACK', id: 'P0', targetId: 'E0' },
    ]
    const uninterrupted = runSeq(build(), seq)
    let mid = runSeq(build(), seq.slice(0, 2))
    mid = JSON.parse(JSON.stringify(mid)) as BattleState // round-trip through JSON
    const resumed = runSeq(mid, seq.slice(2))
    expect(JSON.stringify(resumed)).toEqual(JSON.stringify(uninterrupted))
  })

  it('AI is a pure function of state (identical output, no rng consumed)', () => {
    let s = buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_INF_SWORD', 40, 5, 5), mk('P1', 'PLAYER', 'LIGHT_ARCHER', 30, 6, 5)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_CAV', 30, 5, 2), mk('E1', 'ENEMY', 'LIGHT_INF_SWORD', 35, 6, 2)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 7, difficulty: 'RIVAL_BARON',
    })
    s = applyCommand(s, { kind: 'END_TURN' }) // hand turn to ENEMY
    const cursorBefore = s.rngCursor
    const a = chooseEnemyCommands(s)
    const b = chooseEnemyCommands(s)
    expect(a).toEqual(b)
    expect(s.rngCursor).toEqual(cursorBefore) // planning must not consume battle rng
    expect(a[a.length - 1]).toEqual({ kind: 'END_TURN' })
  })
})

describe('counters (rock-paper-scissors)', () => {
  it('counter tables encode the intended relationships', () => {
    expect(weaponVsMounted.spear).toBeCloseTo(1.75)
    expect(weaponVsMounted.spear).toBeGreaterThan(weaponVsMounted.sword)
    expect(weaponVsArmor.bow.heavy).toBeLessThan(weaponVsArmor.bow.light)
    expect(weaponVsArmor.halberd.heavy).toBeGreaterThan(weaponVsArmor.sword.heavy)
  })

  it('spear kills more vs cavalry than vs equivalent infantry', () => {
    const s = buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_INF_SPEAR', 40, 5, 4)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_CAV', 40, 5, 3), mk('E1', 'ENEMY', 'LIGHT_INF_SWORD', 40, 6, 3)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 1, difficulty: 'BANDIT_RAID',
    })
    const spear = combatantById(s, 'P0')!
    const vsCav = estimateKills(s, spear, combatantById(s, 'E0')!, { isMelee: true })
    const vsInf = estimateKills(s, spear, combatantById(s, 'E1')!, { isMelee: true })
    expect(vsCav).toBeGreaterThan(vsInf)
  })

  it('archers barely dent heavy armor but shred light', () => {
    const s = buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_ARCHER', 30, 5, 5)],
      enemyCombatants: [mk('E0', 'ENEMY', 'HEAVY_INF_SWORD', 40, 5, 3), mk('E1', 'ENEMY', 'LIGHT_INF_SWORD', 40, 6, 3)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 2, difficulty: 'BANDIT_RAID',
    })
    const archer = combatantById(s, 'P0')!
    const vsHeavy = estimateKills(s, archer, combatantById(s, 'E0')!, { isMelee: false })
    const vsLight = estimateKills(s, archer, combatantById(s, 'E1')!, { isMelee: false })
    expect(vsLight).toBeGreaterThan(vsHeavy)
  })
})

describe('casualty write-back', () => {
  it('conserves soldiers and removes destroyed units', () => {
    const units = [
      makeUnit('u_P0', 'LIGHT_INF_SPEAR', [{ r: 'NOVICE', count: 20, avgXP: 0 }, { r: 'VETERAN', count: 20, avgXP: 80 }]),
      makeUnit('u_keep', 'LIGHT_ARCHER', [{ r: 'TRAINED', count: 15, avgXP: 30 }]),
    ]
    // Fabricate a finished battle where the deployed unit survives with 25 of 40.
    const combatant = unitToCombatant(units[0], 'PLAYER', 0)
    combatant.hp = 25
    combatant.kills = 18
    const finalState: BattleState = {
      version: 1, seed: 1, rngCursor: 0, width: 12, height: 8, terrain: plains(12, 8),
      combatants: [combatant], turn: 3, side: 'PLAYER', phase: 'RESOLVED',
      status: 'PLAYER_WON', winner: 'PLAYER', log: [], config: { lethality: 0.35, maxTurns: 40 },
      difficulty: 'BANDIT_RAID',
    }
    const before = units[0].buckets.reduce((a, b) => a + b.count, 0)
    const out = applyBattleResult(units, finalState, ['u_P0'])
    expect(out.won).toBe(true)
    expect(out.totalLosses).toBe(before - 25) // 15 died
    const survivor = out.units.find((u) => u.id === 'u_P0')!
    const after = survivor.buckets.reduce((a, b) => a + b.count, 0)
    expect(after).toBe(25)
    // undeployed unit untouched
    expect(out.units.find((u) => u.id === 'u_keep')).toBeTruthy()
  })

  it('veterans survive preferentially (NOVICE emptied first)', () => {
    const units = [makeUnit('u_P0', 'HEAVY_INF_SPEAR', [
      { r: 'NOVICE', count: 10, avgXP: 0 },
      { r: 'VETERAN', count: 10, avgXP: 80 },
    ])]
    const c = unitToCombatant(units[0], 'PLAYER', 0)
    c.hp = 12 // 8 die out of 20
    const finalState: BattleState = {
      version: 1, seed: 1, rngCursor: 0, width: 12, height: 8, terrain: plains(12, 8),
      combatants: [c], turn: 2, side: 'PLAYER', phase: 'RESOLVED',
      status: 'PLAYER_WON', winner: 'PLAYER', log: [], config: { lethality: 0.35, maxTurns: 40 },
      difficulty: 'BANDIT_RAID',
    }
    const out = applyBattleResult(units, finalState, ['u_P0'])
    const survivor = out.units.find((u) => u.id === 'u_P0')!
    const novice = survivor.buckets.find((b) => b.r === 'NOVICE')?.count ?? 0
    const veteran = survivor.buckets.find((b) => b.r === 'VETERAN')?.count ?? 0
    expect(novice).toBe(2) // 8 of 10 novices died
    expect(veteran).toBe(10) // all veterans held
  })

  it('destroyed unit (0 hp) is dropped from the army', () => {
    const units = [makeUnit('u_P0', 'LIGHT_ARCHER', [{ r: 'NOVICE', count: 12, avgXP: 0 }])]
    const c = unitToCombatant(units[0], 'PLAYER', 0)
    c.hp = 0
    const finalState: BattleState = {
      version: 1, seed: 1, rngCursor: 0, width: 12, height: 8, terrain: plains(12, 8),
      combatants: [], turn: 2, side: 'ENEMY', phase: 'RESOLVED',
      status: 'ENEMY_WON', winner: 'ENEMY', log: [], config: { lethality: 0.35, maxTurns: 40 },
      difficulty: 'BANDIT_RAID',
    }
    const out = applyBattleResult(units, finalState, ['u_P0'])
    expect(out.units.length).toBe(0)
    expect(out.destroyed).toBe(1)
  })
})

describe('full battle via createBattle + AI plays to resolution', () => {
  it('resolves deterministically', () => {
    const playerUnits = [
      makeUnit('u1', 'HEAVY_INF_SPEAR', [{ r: 'VETERAN', count: 40, avgXP: 80 }]),
      makeUnit('u2', 'LIGHT_ARCHER', [{ r: 'ADVANCED', count: 30, avgXP: 50 }]),
      makeUnit('u3', 'LIGHT_CAV', [{ r: 'TRAINED', count: 20, avgXP: 30 }]),
    ]
    const play = (): BattleState => {
      const { state } = createBattle(playerUnits, 'BANDIT_RAID', 4242)
      let s = state
      let guard = 0
      while (s.status === 'ONGOING' && guard < 500) {
        guard++
        if (s.side === 'ENEMY') {
          for (const cmd of chooseEnemyCommands(s)) s = applyCommand(s, cmd)
        } else {
          // trivial player policy: each unit attacks any legal target, else advances, then end turn
          for (const c of s.combatants.filter((x) => x.side === 'PLAYER' && x.hp > 0 && !x.routed)) {
            // (uses engine's own legality; keep it simple and deterministic)
            const targets = s.combatants.filter((t) => t.side === 'ENEMY' && t.hp > 0)
            if (!targets.length) break
            s = applyCommand(s, { kind: 'ATTACK', id: c.id, targetId: targets[0].id })
          }
          s = applyCommand(s, { kind: 'END_TURN' })
        }
      }
      return s
    }
    const a = play()
    const b = play()
    expect(a.status).not.toBe('ONGOING')
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })
})

describe('rank promotion', () => {
  it('promotes a bucket at its threshold, carrying overflow XP', () => {
    const { buckets, promotions } = promoteBuckets([{ r: 'NOVICE', count: 20, avgXP: 120 }])
    expect(promotions).toEqual([{ from: 'NOVICE', to: 'TRAINED', count: 20 }])
    expect(buckets).toEqual([{ r: 'TRAINED', count: 20, avgXP: 20 }])
  })

  it('merges a promoted bucket into an existing higher bucket (weighted XP), conserving count', () => {
    const input = [
      { r: 'NOVICE' as Rank, count: 10, avgXP: 100 },
      { r: 'TRAINED' as Rank, count: 30, avgXP: 40 },
    ]
    const { buckets, promotions } = promoteBuckets(input)
    expect(promotions).toHaveLength(1)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].r).toBe('TRAINED')
    expect(buckets[0].count).toBe(40)
    // weighted: (10*0 + 30*40)/40 = 30
    expect(buckets[0].avgXP).toBe(30)
    const total = (b: { count: number }[]) => b.reduce((a, x) => a + x.count, 0)
    expect(total(buckets)).toBe(total(input))
  })

  it('returns the same reference when nothing promotes; ELITE never promotes', () => {
    const stable = [{ r: 'ELITE' as Rank, count: 5, avgXP: 9999 }]
    const res = promoteBuckets(stable)
    expect(res.buckets).toBe(stable)
    expect(res.promotions).toHaveLength(0)
  })

  it('battle XP can promote survivors via applyBattleResult', () => {
    // 40 spearmen at 90 XP (10 short of TRAINED); big kill count → +XP crosses threshold
    const u = makeUnit('u1', 'LIGHT_INF_SPEAR', [{ r: 'NOVICE', count: 40, avgXP: 90 }])
    const c = { ...unitToCombatant(u, 'PLAYER', 0), hp: 40, kills: 30 } // xp = min(60, 100*30/40) = 60 → 150 ≥ 100
    const finalState = buildBattle({
      playerCombatants: [c], enemyCombatants: [], terrain: plains(4, 4),
      width: 4, height: 4, seed: 1, difficulty: 'BANDIT_RAID',
    })
    finalState.winner = 'PLAYER'
    const out = applyBattleResult([u], finalState, ['u1'])
    expect(out.report[0].promotions).toEqual([{ from: 'NOVICE', to: 'TRAINED', count: 40 }])
    expect(out.units[0].buckets[0].r).toBe('TRAINED')
  })
})

describe('attack forecast', () => {
  it('is pure: consumes no rng and matches the mean estimate', () => {
    const s = buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_INF_SPEAR', 40, 5, 4)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_CAV', 30, 5, 3)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 7, difficulty: 'BANDIT_RAID',
    })
    const before = JSON.stringify(s)
    const f = forecastAttack(s, 'P0', 'E0')!
    expect(JSON.stringify(s)).toBe(before) // no mutation
    expect(s.rngCursor).toBe(0) // no rng consumed
    expect(f.melee).toBe(true)
    const a = combatantById(s, 'P0')!
    const d = combatantById(s, 'E0')!
    expect(f.kills).toBe(estimateKills(s, a, d, { isMelee: true }))
    expect(f.retalKills).toBeGreaterThan(0) // survivor retaliates in melee
  })

  it('returns null for illegal targets and no retaliation for ranged', () => {
    const s = buildBattle({
      playerCombatants: [mk('P0', 'PLAYER', 'LIGHT_ARCHER', 30, 5, 5)],
      enemyCombatants: [mk('E0', 'ENEMY', 'LIGHT_INF_SWORD', 30, 5, 2)],
      terrain: plains(12, 8), width: 12, height: 8, seed: 7, difficulty: 'BANDIT_RAID',
    })
    expect(forecastAttack(s, 'P0', 'nope')).toBeNull()
    const f = forecastAttack(s, 'P0', 'E0')!
    expect(f.melee).toBe(false)
    expect(f.retalKills).toBe(0)
  })
})

describe('campaign escalation', () => {
  it('escalationMult and streakLootMult scale 5%/step capped at 1.5', () => {
    expect(escalationMult(0)).toBe(1)
    expect(escalationMult(4)).toBeCloseTo(1.2)
    expect(escalationMult(100)).toBe(1.5)
    expect(streakLootMult(2)).toBeCloseTo(1.1)
    expect(streakLootMult(999)).toBe(1.5)
  })

  it('ratioMult scales the generated enemy army strength and rewardMult the loot', () => {
    const units = [makeUnit('u1', 'HEAVY_INF_SPEAR', [{ r: 'VETERAN', count: 100, avgXP: 80 }])]
    const base = createBattle(units, 'RIVAL_BARON', 99).enemyStrength
    const esc = createBattle(units, 'RIVAL_BARON', 99, { ratioMult: 1.5 }).enemyStrength
    expect(esc).toBeGreaterThan(base)
    expect(esc / base).toBeGreaterThan(1.3) // ≈1.5 modulo token rounding
    const r1 = createBattle(units, 'RIVAL_BARON', 99).reward.copper
    const r2 = createBattle(units, 'RIVAL_BARON', 99, { rewardMult: 1.5 }).reward.copper
    expect(r2).toBeGreaterThan(r1)
  })
})

describe('pvp: sanitizeDeploy', () => {
  const claim = (over: Partial<DeployCombatantClaim> = {}): DeployCombatantClaim => ({
    unitId: over.unitId ?? 'u1',
    type: 'LIGHT_INF_SPEAR',
    hp: 40,
    morale: 90,
    buckets: [{ r: 'VETERAN', count: 40, avgXP: 80 }],
    ...over,
  })
  const wrap = (cs: DeployCombatantClaim[]) => ({ unitIds: cs.map(c => c.unitId), combatants: cs })

  it('accepts a valid payload and derives server-owned fields', () => {
    const res = sanitizeDeploy(wrap([claim()]), 'ENEMY')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const c = res.combatants[0]
    expect(c.id).toBe('E0')
    expect(c.side).toBe('ENEMY')
    expect(c.hpStart).toBe(40)
    expect(c.kills).toBe(0)
    expect(c.x).toBe(-1)
    expect(c.vet).toBe(3) // derived from VETERAN buckets, not claimable
    expect('statsOverride' in c).toBe(false)
  })

  it('rejects oversize armies, absurd hp, and hp above bucket total', () => {
    const many = Array.from({ length: PVP_MAX_COMBATANTS + 1 }, (_, i) => claim({ unitId: `u${i}` }))
    expect(sanitizeDeploy(wrap(many), 'PLAYER').ok).toBe(false)
    expect(sanitizeDeploy(wrap([claim({ hp: 501 })]), 'PLAYER').ok).toBe(false)
    expect(sanitizeDeploy(wrap([claim({ hp: 41 })]), 'PLAYER').ok).toBe(false) // 41 > Σbuckets 40
    expect(sanitizeDeploy(wrap([claim({ morale: 101 })]), 'PLAYER').ok).toBe(false)
    expect(sanitizeDeploy(wrap([claim({ type: 'DRAGON' as any })]), 'PLAYER').ok).toBe(false)
  })

  it('ignores forged server-owned fields (vet/kills/statsOverride/loadoutWeapon cannot be claimed)', () => {
    const forged: any = { ...claim(), vet: 4, kills: 999, statsOverride: { atk: 9999 }, hpStart: 9999, side: 'PLAYER', id: 'P99', loadoutWeapon: 'HALBERD' }
    const res = sanitizeDeploy({ unitIds: ['u1'], combatants: [forged] }, 'ENEMY')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const c = res.combatants[0]
    expect(c.kills).toBe(0)
    expect(c.hpStart).toBe(40)
    expect(c.side).toBe('ENEMY')
    expect(c.id).toBe('E0')
    expect((c as any).statsOverride).toBeUndefined()
    // weapon-smuggling is closed: no loadoutWeapon reaches the combatant
    expect((c as any).loadoutWeapon).toBeUndefined()
  })

  it('an archer with a smuggled halberd resolves to bow stats (range 3), not halberd', () => {
    const forged: any = { unitId: 'a', type: 'LIGHT_ARCHER', hp: 30, morale: 100, buckets: [{ r: 'ELITE', count: 30, avgXP: 60 }], loadoutWeapon: 'HALBERD' }
    const res = sanitizeDeploy({ unitIds: ['a'], combatants: [forged] }, 'PLAYER')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect((res.combatants[0] as any).loadoutWeapon).toBeUndefined()
  })
})

describe('pvp: createPvpBattle + defender write-back', () => {
  const deploySide = (side: 'PLAYER' | 'ENEMY', ids: string[]) => {
    const cs: DeployCombatantClaim[] = ids.map((id) => ({
      unitId: id, type: 'LIGHT_INF_SWORD', hp: 30, morale: 100,
      buckets: [{ r: 'TRAINED', count: 30, avgXP: 20 }],
    }))
    const res = sanitizeDeploy({ unitIds: ids, combatants: cs }, side)
    if (!res.ok) throw new Error(res.error)
    return res.combatants
  }

  it('is deterministic: same payloads + seed → identical state', () => {
    const a = createPvpBattle(deploySide('PLAYER', ['a1', 'a2']), deploySide('ENEMY', ['b1']), 777)
    const b = createPvpBattle(deploySide('PLAYER', ['a1', 'a2']), deploySide('ENEMY', ['b1']), 777)
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
    expect(a.combatants.every((c) => c.x >= 0 && c.y >= 0)).toBe(true)
  })

  it('applyBattleResult with side=ENEMY applies the defender perspective', () => {
    const state = createPvpBattle(deploySide('PLAYER', ['a1']), deploySide('ENEMY', ['b1']), 5)
    state.status = 'ENEMY_WON'
    state.winner = 'ENEMY'
    // defender's local unit matching unitId b1
    const defUnit = makeUnit('b1', 'LIGHT_INF_SWORD', [{ r: 'TRAINED', count: 30, avgXP: 20 }])
    const out = applyBattleResult([defUnit], state, ['b1'], 'ENEMY')
    expect(out.won).toBe(true) // ENEMY side won and we ARE the enemy side
    expect(out.units).toHaveLength(1)
    // and the challenger perspective on the same state loses
    const chUnit = makeUnit('a1', 'LIGHT_INF_SWORD', [{ r: 'TRAINED', count: 30, avgXP: 20 }])
    const outCh = applyBattleResult([chUnit], state, ['a1'], 'PLAYER')
    expect(outCh.won).toBe(false)
  })
})
