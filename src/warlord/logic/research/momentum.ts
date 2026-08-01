// src/logic/research/momentum.ts
// Momentum: short-lived, cross-branch consequences of what happens in the game.
//
// The point (Andrei's brief): winning a battle should not only pay loot — it should
// ripple into the OTHER branches. A victory lifts the workshops for a few days AND
// gives the soldiers still in training a burst of drive. Finishing a research project
// lifts morale. Losing a battle costs you a little production while you recover.
//
// Crucially these buffs carry the SAME `EffectDelta` as techs and are folded by the
// SAME aggregate(), so there is exactly one bonus pipeline — not a parallel system.

import type { EffectDelta } from './effects'
import type { TechDef, TechId } from './catalog'
import { prereqsMet } from './catalog'
import { applyDelta, clampModifiers, emptyModifiers, type Modifiers } from './effects'

export interface BuffDef {
  id: string
  name: string
  desc: string
  days: number
  effects: EffectDelta
  good: boolean // drives the UI colour; a malus is still just a delta
}

export interface ActiveBuff {
  id: string
  name: string
  desc: string
  daysRemaining: number
  effects: EffectDelta
  good: boolean
}

// ---- Trigger tables (data, so the future admin can retune them) ----

export const BUFF_DEFS: Record<string, BuffDef> = {
  WAR_SPOILS: {
    id: 'WAR_SPOILS',
    name: 'War Spoils',
    desc: 'Captured stores and tools flow into the workshops. +25% production.',
    days: 3,
    effects: { prodMult: 1.25 },
    good: true,
  },
  MARTIAL_FERVOUR: {
    id: 'MARTIAL_FERVOUR',
    name: 'Martial Fervour',
    desc: 'Word of the victory reaches the drill fields. +50% training XP.',
    days: 3,
    effects: { trainXpMult: 1.5 },
    good: true,
  },
  BREAKTHROUGH: {
    id: 'BREAKTHROUGH',
    name: 'Breakthrough',
    desc: 'A discovery lifts the whole domain. +10% production, +20% training XP.',
    days: 2,
    effects: { prodMult: 1.1, trainXpMult: 1.2 },
    good: true,
  },
  LICKING_WOUNDS: {
    id: 'LICKING_WOUNDS',
    name: 'Licking Wounds',
    desc: 'The defeat costs you hands and heart. −15% production while you recover.',
    days: 2,
    effects: { prodMult: 0.85 },
    good: false,
  },
}

export type BuffTable = Record<string, BuffDef>

// Admin overrides merged over the defaults. Only sane values survive: a buff whose
// duration or multiplier was typed wrong must fall back, never poison the economy.
export function resolveBuffs(overrides?: Record<string, Partial<Omit<BuffDef, 'id'>>> | null): BuffTable {
  if (!overrides || typeof overrides !== 'object') return BUFF_DEFS
  const out: BuffTable = {}
  for (const [id, def] of Object.entries(BUFF_DEFS)) {
    const ov = overrides[id]
    if (!ov || typeof ov !== 'object') { out[id] = def; continue }
    const days = typeof ov.days === 'number' && Number.isFinite(ov.days) && ov.days >= 1 ? Math.round(ov.days) : def.days
    const effects: EffectDelta = { ...def.effects }
    if (ov.effects && typeof ov.effects === 'object') {
      for (const [k, v] of Object.entries(ov.effects)) {
        if (typeof v === 'number' && Number.isFinite(v)) (effects as Record<string, number>)[k] = v
      }
    }
    out[id] = {
      ...def,
      days,
      effects,
      name: typeof ov.name === 'string' && ov.name.trim() ? ov.name : def.name,
      desc: typeof ov.desc === 'string' && ov.desc.trim() ? ov.desc : def.desc,
    }
  }
  return out
}

function instantiate(def: BuffDef): ActiveBuff {
  return { id: def.id, name: def.name, desc: def.desc, daysRemaining: def.days, effects: def.effects, good: def.good }
}

// Re-applying an active buff REFRESHES its duration rather than stacking a second copy —
// otherwise a win streak would compound into an unbounded economy.
export function addBuff(buffs: ActiveBuff[], def: BuffDef): ActiveBuff[] {
  const fresh = instantiate(def)
  const i = buffs.findIndex((b) => b.id === def.id)
  if (i === -1) return [...buffs, fresh]
  const next = [...buffs]
  next[i] = fresh
  return next
}

// A victory ripples into economy AND training — the cross-branch effect Andrei asked for.
export function onBattleWon(buffs: ActiveBuff[], table: BuffTable = BUFF_DEFS): ActiveBuff[] {
  return addBuff(addBuff(buffs, table.WAR_SPOILS), table.MARTIAL_FERVOUR)
}

export function onBattleLost(buffs: ActiveBuff[], table: BuffTable = BUFF_DEFS): ActiveBuff[] {
  return addBuff(buffs, table.LICKING_WOUNDS)
}

export function onResearchCompleted(buffs: ActiveBuff[], table: BuffTable = BUFF_DEFS): ActiveBuff[] {
  return addBuff(buffs, table.BREAKTHROUGH)
}

// One day passes: decrement and drop the expired. Pure; returns the survivors and the
// names that just ran out (for the daily log).
export function tickBuffs(buffs: ActiveBuff[]): { buffs: ActiveBuff[]; expired: string[] } {
  const kept: ActiveBuff[] = []
  const expired: string[] = []
  for (const b of buffs) {
    const left = b.daysRemaining - 1
    if (left > 0) kept.push({ ...b, daysRemaining: left })
    else expired.push(b.name)
  }
  return { buffs: kept, expired }
}

// ---- The single aggregation point ----

// Researched techs + active buffs → one Modifiers object, clamped. Everything in the
// game that can be boosted reads the result of this function and nothing else.
export function aggregate(unlocked: TechId[], buffs: ActiveBuff[], catalog: TechDef[]): Modifiers {
  let m = emptyModifiers()
  for (const t of catalog) {
    if (unlocked.includes(t.id)) m = applyDelta(m, t.effects)
  }
  for (const b of buffs) m = applyDelta(m, b.effects)
  return clampModifiers(m)
}

// Techs the player can start right now (not researched, not queued, prereqs met).
export function availableTechs(catalog: TechDef[], unlocked: TechId[], queued: TechId[]): TechDef[] {
  return catalog.filter((t) => !unlocked.includes(t.id) && !queued.includes(t.id) && prereqsMet(t, unlocked))
}
