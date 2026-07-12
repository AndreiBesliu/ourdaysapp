// src/logic/units.ts
import { RankIndex } from './types'
import type { Rank, Unit, SoldierType } from './types'

import { Registry } from './registry';

type UnitLoadout = Unit['loadout'];
type Bucket = { r: Rank; count: number; avgXP: number };

function getDef(id: string) {
  const def = Registry.getUnit(id);
  if (!def) {
    console.warn(`Unit definition not found for ${id}`);
    return {
      id, type: id, name: id,
      req: { weapons: {}, armors: {}, horses: {} },
      loadout: {}
    };
  }
  return def;
}

export const defaultLoadout = (t: SoldierType): UnitLoadout => {
  return getDef(t).loadout || {};
}

export const computeUnitAvgXP = (buckets: Bucket[]) => {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  const wx = buckets.reduce((a, b) => a + b.count * b.avgXP, 0)
  return total === 0 ? 0 : Math.floor(wx / total)
}

export const requiredCountsFor = (u: Unit): {
  weapons: Partial<Record<string, number>>;
  armors: Partial<Record<string, number>>;
  horses: Partial<Record<string, number>>;
} => {
  const size = u.buckets.reduce((a, b) => a + b.count, 0)

  // Get reqs from Registry
  const def = getDef(u.type);
  const baseReq = def.req || {};

  const req: any = { weapons: {}, armors: {}, horses: {} }

  // Multiply base reqs by size
  if (baseReq.weapons) {
    for (const [k, v] of Object.entries(baseReq.weapons)) req.weapons[k] = (v as number) * size;
  }
  if (baseReq.armors) {
    for (const [k, v] of Object.entries(baseReq.armors)) req.armors[k] = (v as number) * size;
  }
  if (baseReq.horses) {
    for (const [k, v] of Object.entries(baseReq.horses)) req.horses[k] = (v as number) * size;
  }

  // If the unit's loadout specifies a different weapon than the registry default, swap the requirement.
  if (u.loadout?.weapon) {
    const defWeapon = def.loadout?.weapon;
    const curWeapon = u.loadout.weapon;
    if (defWeapon && curWeapon && defWeapon !== curWeapon) {
      delete req.weapons[defWeapon];
      req.weapons[curWeapon] = size;
    }
  }

  return req
}

// Soldiers actually equipped from the unit's own `equip` pool, capped by headcount.
// NOTE: in the current game `u.equip` is left empty (gear is consumed from inventory
// at unit creation, never stamped onto the unit), so this returns 0 for real units.
// The combat bridge treats 0 here as "no equip data → use full headcount"; a future
// fix that populates `u.equip` will make this a real cap for both readiness and combat.
export const computeEquipped = (u: Unit): number => {
  const size = u.buckets.reduce((a, b) => a + b.count, 0)
  const req = requiredCountsFor(u)
  const caps: number[] = []
  for (const [w, n] of Object.entries(req.weapons)) caps.push(Math.floor(((u.equip.weapons[w as any] || 0) / (n as number)) * size))
  for (const [a, n] of Object.entries(req.armors)) caps.push(Math.floor(((u.equip.armors[a as any] || 0) / (n as number)) * size))
  for (const [h, n] of Object.entries(req.horses)) caps.push(Math.floor(((u.equip.horses[h as any] || 0) / (n as number)) * size))
  return caps.length ? Math.min(size, ...caps) : size
}

export const computeReady = (u: Unit): number => {
  const equipped = computeEquipped(u)
  // Morale reduces effective combat strength: 50 morale = 75% effectiveness, 0 = 50%
  const moraleFactor = 0.5 + 0.5 * ((u.morale ?? 100) / 100)
  return Math.floor(equipped * moraleFactor)
}

// Call once per day tick; foodShortage=true dacă armata nu a primit hrană
export function applyMoraleChange(u: Unit, upkeepPaid: boolean, foodShortage: boolean): Unit {
  const current = u.morale ?? 100
  let delta = 0
  if (!upkeepPaid) delta -= 10
  if (foodShortage) delta -= 15
  if (upkeepPaid && !foodShortage) delta += 5  // recuperare lentă
  const newMorale = Math.max(0, Math.min(100, current + delta))
  return { ...u, morale: newMorale }
}

// ---- Missing equipment list ----
export function missingEquipmentList(u: Unit): string[] {
  const req = requiredCountsFor(u)
  const out: string[] = []
  for (const [w, need] of Object.entries(req.weapons)) {
    const have = u.equip.weapons[w] || 0
    if ((need as number) > have) out.push(`${w}: ${(need as number) - have}`)
  }
  for (const [a, need] of Object.entries(req.armors)) {
    const have = u.equip.armors[a] || 0
    if ((need as number) > have) out.push(`${a}: ${(need as number) - have}`)
  }
  for (const [h, need] of Object.entries(req.horses)) {
    const have = u.equip.horses[h] || 0
    if ((need as number) > have) out.push(`${h}: ${(need as number) - have}`)
  }
  return out
}

// ---- Split / Merge ----
function cloneBuckets(b: Bucket[]): Bucket[] { return b.map(x => ({ ...x })) }

function splitScalarEquip(equip: Record<string, number>, ratio: number): Record<string, number> {
  return Object.fromEntries(Object.entries(equip).map(([k, v]) => [k, Math.floor((v || 0) * ratio)]))
}

function subtractScalarEquip(
  total: Record<string, number>,
  taken: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(Object.keys(total).map(k => [k, (total[k] || 0) - (taken[k] || 0)]))
}
function mergeBucketArrays(a: Bucket[], b: Bucket[]): Bucket[] {
  const map = new Map<Rank, { count: number, wx: number }>()
  const add = (arr: Bucket[]) => arr.forEach(({ r, count, avgXP }) => {
    const prev = map.get(r) || { count: 0, wx: 0 }
    prev.count += count; prev.wx += count * avgXP; map.set(r, prev)
  })
  add(a); add(b)
  return Array.from(map.entries()).map(([r, v]) => ({
    r, count: v.count, avgXP: v.count ? Math.floor(v.wx / v.count) : 0
  }))
}
export function splitUnit(u: Unit, takeCount: number): { taken: Unit; remaining: Unit } {
  const size = u.buckets.reduce((a, b) => a + b.count, 0)
  const amt = Math.max(0, Math.min(takeCount, size))
  const ratio = size ? (amt / size) : 0

  const takenBuckets: Bucket[] = []
  const remainBuckets: Bucket[] = []
  let carried = 0
  for (const b of u.buckets) {
    const want = Math.round(b.count * ratio)
    const take = Math.min(want, b.count)
    const left = b.count - take
    if (take > 0) takenBuckets.push({ r: b.r, count: take, avgXP: b.avgXP })
    if (left > 0) remainBuckets.push({ r: b.r, count: left, avgXP: b.avgXP })
    carried += take
  }
  let diff = amt - carried
  for (const b of remainBuckets) {
    if (diff <= 0) break
    const move = Math.min(diff, b.count)
    b.count -= move
    const tb = takenBuckets.find(x => x.r === b.r)
    if (tb) tb.count += move
    else takenBuckets.push({ r: b.r, count: move, avgXP: b.avgXP })
    diff -= move
  }

  const takeWeapons = splitScalarEquip(u.equip.weapons, ratio)
  const takeArmors = splitScalarEquip(u.equip.armors, ratio)
  // horses are { active, inactive } objects — split only active, inactive stays with remaining
  const takeHorses = Object.fromEntries(
    Object.entries(u.equip.horses).map(([k, v]) => {
      const active = Math.floor(((v as any).active || 0) * ratio)
      return [k, { active, inactive: 0 }]
    })
  )
  const remHorses = Object.fromEntries(
    Object.entries(u.equip.horses).map(([k, v]) => {
      const takenActive = (takeHorses[k] as any)?.active || 0
      return [k, { active: ((v as any).active || 0) - takenActive, inactive: (v as any).inactive || 0 }]
    })
  )

  const takeEq = {
    weapons: takeWeapons as any,
    armors: takeArmors as any,
    horses: takeHorses as any,
  }
  const remEq = {
    weapons: subtractScalarEquip(u.equip.weapons, takeWeapons) as any,
    armors: subtractScalarEquip(u.equip.armors, takeArmors) as any,
    horses: remHorses as any,
  }

  const taken: Unit = {
    id: `U_${Math.random().toString(36).slice(2, 7)}`,
    type: u.type,
    buckets: takenBuckets,
    avgXP: computeUnitAvgXP(takenBuckets),
    training: false,
    morale: u.morale ?? 100,
    equip: takeEq,
    loadout: u.loadout,
  }
  const remaining: Unit = {
    ...u,
    buckets: remainBuckets,
    avgXP: computeUnitAvgXP(remainBuckets),
    equip: remEq,
  }
  return { taken, remaining }
}
export function mergeUnits(a: Unit, b: Unit): Unit {
  if (a.type !== b.type) throw new Error('Cannot merge units of different types')
  const buckets = mergeBucketArrays(cloneBuckets(a.buckets), cloneBuckets(b.buckets))
  const sizeA = a.buckets.reduce((s, x) => s + x.count, 0)
  const sizeB = b.buckets.reduce((s, x) => s + x.count, 0)
  const totalSize = sizeA + sizeB
  const mergedMorale = totalSize > 0
    ? Math.round(((a.morale ?? 100) * sizeA + (b.morale ?? 100) * sizeB) / totalSize)
    : 100
  return {
    id: `U_${Math.random().toString(36).slice(2, 7)}`,
    type: a.type,
    buckets,
    avgXP: computeUnitAvgXP(buckets),
    training: false,
    morale: mergedMorale,
    loadout: a.loadout,
    equip: {
      weapons: Object.fromEntries(Object.keys({ ...a.equip.weapons, ...b.equip.weapons })
        .map(k => [k as any, ((a.equip.weapons as any)[k] || 0) + ((b.equip.weapons as any)[k] || 0)])) as any,
      armors: Object.fromEntries(Object.keys({ ...a.equip.armors, ...b.equip.armors })
        .map(k => [k as any, ((a.equip.armors as any)[k] || 0) + ((b.equip.armors as any)[k] || 0)])) as any,
      horses: Object.fromEntries(Object.keys({ ...a.equip.horses, ...b.equip.horses })
        .map(k => [k as any, ((a.equip.horses as any)[k] || 0) + ((b.equip.horses as any)[k] || 0)])) as any,
    }
  }
}

export const trainingGainPerDay = (r: Rank) =>
  (RankIndex[r] >= 3 ? 0 : 25 + 10 * RankIndex[r])

// ---- Rank promotion ----
// XP a bucket must reach to promote OUT of its rank. Training XP alone carries a
// soldier to VETERAN (trainingGainPerDay is 0 at VETERAN+); ELITE is earned in battle.
export const PROMOTE_AT: Record<Rank, number | null> = {
  NOVICE: 100,
  TRAINED: 250,
  ADVANCED: 450,
  VETERAN: 700,
  ELITE: null,
}

const RANK_ORDER: Rank[] = ['NOVICE', 'TRAINED', 'ADVANCED', 'VETERAN', 'ELITE']

export function nextRank(r: Rank): Rank | null {
  const i = RANK_ORDER.indexOf(r)
  return i >= 0 && i < RANK_ORDER.length - 1 ? RANK_ORDER[i + 1] : null
}

export interface Promotion { from: Rank; to: Rank; count: number }

// Promote every bucket whose avgXP reached its rank's threshold, carrying overflow XP
// into the next rank (so training days aren't wasted). Buckets landing on an existing
// higher bucket merge with a count-weighted XP average. Pure; returns the SAME array
// reference when nothing promotes so callers can cheaply skip no-op state writes.
export function promoteBuckets(buckets: Bucket[]): { buckets: Bucket[]; promotions: Promotion[] } {
  const promotions: Promotion[] = []
  let cur = buckets
  // A bucket promotes at most one rank per pass; loop until stable (bounded by ranks).
  for (let pass = 0; pass < RANK_ORDER.length; pass++) {
    let changed = false
    const out: Bucket[] = []
    for (const b of cur) {
      const threshold = PROMOTE_AT[b.r]
      const to = nextRank(b.r)
      if (threshold !== null && to && b.count > 0 && b.avgXP >= threshold) {
        promotions.push({ from: b.r, to, count: b.count })
        out.push({ r: to, count: b.count, avgXP: Math.max(0, b.avgXP - threshold) })
        changed = true
      } else {
        out.push({ ...b })
      }
    }
    if (!changed) break
    // merge duplicates of the same rank (promoted bucket meets an existing one)
    const merged = new Map<Rank, { count: number; wx: number }>()
    for (const b of out) {
      const prev = merged.get(b.r) || { count: 0, wx: 0 }
      prev.count += b.count
      prev.wx += b.count * b.avgXP
      merged.set(b.r, prev)
    }
    cur = RANK_ORDER
      .filter(r => merged.has(r))
      .map(r => {
        const m = merged.get(r)!
        return { r, count: m.count, avgXP: m.count ? Math.floor(m.wx / m.count) : 0 }
      })
  }
  return promotions.length ? { buckets: cur, promotions } : { buckets, promotions }
}
