// src/logic/combat/types.ts
//
// TWO COPIES. This file is duplicated byte-for-byte in
// OurDaysApp/functions/src/warlordCombat/combat/, because PvP is server-authoritative and the
// Cloud Functions run on another runtime with another tsconfig. Edit one, edit the other, then
// `firebase deploy --only functions`. A divergence has no error of its own: the server would
// simply resolve a battle differently from the client that submitted the move.
// Enforced by OurDaysApp/src/warlordServerCopy.test.ts, which normalises line endings so that a
// failure there is always a real difference and never a checkout artefact.
// Pure, JSON-serializable types for the tactical grid combat engine.
// NO React, NO Firestore, NO class instances, NO Map/Set — everything here must
// round-trip through JSON.stringify so the exact same BattleState can run on the
// client (PvE) today and inside a Cloud Function (PvP) later.

import type { SoldierType, Rank, UnitBucket, Weapon } from '../types'

export type Side = 'PLAYER' | 'ENEMY'
export type Phase = 'PLAYER_TURN' | 'ENEMY_TURN' | 'RESOLVED'
export type TerrainType = 'PLAINS' | 'FOREST' | 'HILL' | 'RIVER'
export type ArmorClass = 'none' | 'light' | 'heavy'
export type WeaponClass = 'sword' | 'spear' | 'halberd' | 'bow'
export type Difficulty = 'BANDIT_RAID' | 'RIVAL_BARON' | 'INVASION'

export interface CombatStats {
  atk: number
  def: number
  range: number // 1 = melee, 3 = ranged
  speed: number // move budget in tiles/turn
  armorClass: ArmorClass
  weaponClass: WeaponClass
  mounted: boolean
  chargeBonus: number // damage mult when mounted & moved before a melee attack
  hasShield: boolean
}

export interface Combatant {
  id: string // deterministic: 'P0','P1',... 'E0','E1',...
  side: Side
  unitId: string // source Unit.id for casualty write-back ('' for synthetic enemies)
  type: SoldierType
  loadoutWeapon?: Weapon
  name: string
  x: number
  y: number
  hp: number // current effective soldiers
  hpStart: number // fielded soldiers at setup
  morale: number // live 0..100
  vet: number // precomputed bucket-count-weighted RankNumber 0..4
  kills: number // enemy soldiers killed (for XP write-back)
  hasMoved: boolean
  hasActed: boolean
  routed: boolean
  buckets: UnitBucket[] // snapshot; casualties applied at battle end, then written back
  statsOverride?: Partial<CombatStats> // moddable stat overrides, baked in at setup
}

export interface BattleLogEntry {
  turn: number
  side: Side
  kind: 'move' | 'attack' | 'retaliate' | 'rout' | 'destroyed' | 'skipped' | 'victory' | 'start' | 'end_turn'
  actorId?: string
  targetId?: string
  detail?: Record<string, number | string>
}

export interface BattleConfig {
  lethality: number
  maxTurns: number
}

export interface BattleState {
  version: 1
  seed: number
  rngCursor: number // # of rng draws consumed; fully captures the PRNG position
  width: number
  height: number
  terrain: Record<string, TerrainType[]> // "y" -> row array indexed by x (map-of-rows: no nested arrays)
  combatants: Combatant[]
  turn: number
  side: Side
  phase: Phase
  status: 'ONGOING' | 'PLAYER_WON' | 'ENEMY_WON' | 'DRAW'
  winner: Side | null
  log: BattleLogEntry[]
  config: BattleConfig
  difficulty: Difficulty
}

export type Command =
  | { kind: 'MOVE'; id: string; to: { x: number; y: number } }
  | { kind: 'ATTACK'; id: string; targetId: string }
  | { kind: 'END_TURN' }

export interface MissionPreset {
  id: Difficulty
  name: string
  ratio: number // enemy total strength ≈ playerStrength * ratio
  minTokens: number
  maxTokens: number
  typeWeights: Partial<Record<SoldierType, number>>
  rankWeights: Partial<Record<Rank, number>>
  baseMorale: number
  baseXP: number
  // Reward on victory, scaled by mission ratio & player strength at fight time.
  rewardCopperPerStrength: number
  rewardResources: Partial<Record<string, number>>
}
