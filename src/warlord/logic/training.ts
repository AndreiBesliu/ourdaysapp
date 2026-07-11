// src/logic/training.ts
import type { Rank, SoldierType } from './types'
import { demandFor, ensureEquipOrBuy } from './equipment'
import { enqueueBatch, canEnqueue } from './batches'

type Ctx = {
  econ: {
    hasStable: boolean
    inv: any
    wallet: number
    setInv: (fn: (prev: any) => any) => void
    setWallet: (fn: (w: number) => number) => void
  }
  barr: {
    barracksLevel: number
    batches: any[]
    setBatches: (fn: (prev: any[]) => any[]) => void
    recruits: { count: number; avgXP: number }
    setRecruits: (fn: (prev: { count: number; avgXP: number }) => { count: number; avgXP: number }) => void
    barracks: any
    setBarracks: (fn: (prev: any) => any) => void
  }
  addLog: (s: string) => void
}

const ADV_PLUS: Rank[] = ['ADVANCED', 'VETERAN', 'ELITE']

import { type RankCount } from './batches'

function tryTakeSoldiers(pool: any, type: string, ranks: Rank[], qty: number): RankCount | null {
  let rem = qty
  const used: RankCount = {}
  for (const r of ranks) {
    const have = pool[type][r]?.count ?? 0
    const take = Math.min(have, rem)
    if (take > 0) {
      used[r] = take
      rem -= take
    }
    if (rem <= 0) break
  }
  return rem === 0 ? used : null
}

function assertQty(qty: number) {
  return Math.max(1, Math.min(50, Math.floor(qty || 0)))
}

function requireSlot(ctx: Ctx) {
  if (!canEnqueue(ctx.barr.batches, ctx.barr.barracksLevel)) {
    ctx.addLog('Training queue full.')
    return false
  }
  return true
}

export interface EconSlice {
  inv: {
    weapons: Record<string, number>
    armors: Record<string, number>
    horses: Record<'LIGHT_HORSE' | 'HEAVY_HORSE', { active: number; inactive: number }>
  }
  setInv: (updater: (prev: EconSlice['inv']) => EconSlice['inv']) => void
  wallet: number
  setWallet: (updater: (prev: number) => number) => void
}

export interface BarracksSlice {
  recruits: { count: number; avgXP: number }
  setRecruits: (updater: (prev: BarracksSlice['recruits']) => BarracksSlice['recruits']) => void
  barracks: any
  setBarracks: (updater: (prev: any) => any) => void
  batches: any[]
  setBatches: (updater: (prev: any[]) => any[]) => void
  barracksLevel: number
}

// recruits (untyped) -> light troop type
export function queueLightTraining(ctx: Ctx, target: SoldierType, qty: number) {
  const n = assertQty(qty)
  if (!requireSlot(ctx)) return
  if (!target.startsWith('LIGHT_')) {
    ctx.addLog('Only LIGHT_* training is allowed for recruits.')
    return
  }
  if (ctx.barr.recruits.count < n) {
    ctx.addLog('Not enough untyped recruits.')
    return
  }

  const demand = demandFor(target, n)
  const res = ensureEquipOrBuy(ctx.econ.inv, ctx.econ.wallet, demand, false)
  if (!res.ok) {
    ctx.addLog('Not enough equipment to train these troops.')
    return
  }

  // All checks passed — commit state changes
  ctx.barr.setRecruits(prev => ({ ...prev, count: prev.count - n }))
  ctx.econ.setInv(() => res.inv)
  if (res.spent > 0) ctx.econ.setWallet(w => w - res.spent)
  ctx.barr.setBatches(prev =>
    enqueueBatch(prev, { level: ctx.barr.barracksLevel, kind: 'LIGHT_TRAIN', target, qty: n })
  )
  ctx.addLog(`Queued LIGHT training: ${n} → ${target}.`)
}

// light inf -> light cav (consumes light horses immediately)
export function queueLightCavConversion(ctx: Ctx, fromType: SoldierType, qty: number) {
  const n = assertQty(qty)
  if (!requireSlot(ctx)) return
  if (!fromType.startsWith('LIGHT_INF')) {
    ctx.addLog('Light Cavalry converts from LIGHT_INF_* only.')
    return
  }

  const take = tryTakeSoldiers(ctx.barr.barracks, fromType, ['NOVICE'], n)
  if (!take) {
    ctx.addLog(`Not enough NOVICE units of ${fromType}.`)
    return
  }

  const haveHorses = ctx.econ.inv.horses.LIGHT_HORSE?.active ?? 0
  if (haveHorses < n) {
    ctx.addLog('Not enough Light Horses.')
    return
  }

  // All checks passed — commit state changes
  ctx.barr.setBarracks(prev => {
    const next = structuredClone(prev)
    for (const r in take) next[fromType][r as Rank].count -= take[r as Rank]!
    return next
  })
  ctx.econ.setInv(prev => {
    const next = structuredClone(prev)
    next.horses.LIGHT_HORSE.active -= n
    return next
  })
  ctx.barr.setBatches(prev =>
    enqueueBatch(prev, {
      level: ctx.barr.barracksLevel,
      kind: 'LIGHT_CAV',
      fromType,
      qty: n,
      takeByRank: take
    })
  )
  ctx.addLog(`Queued LIGHT_CAV conversion: ${n} from ${fromType}.`)
}

// heavy cav: from LIGHT_CAV (ADV+) or HEAVY_INF_* (ADV+)
export function queueHeavyConversion(ctx: Ctx, fromType: SoldierType, qty: number) {
  const n = assertQty(qty)
  if (!requireSlot(ctx)) return

  const fromLightCav = fromType === 'LIGHT_CAV'
  const fromHeavyInf = fromType.startsWith('HEAVY_INF')
  if (!fromLightCav && !fromHeavyInf) {
    ctx.addLog('Heavy Cavalry converts from LIGHT_CAV or HEAVY_INF_*.')
    return
  }

  const take = tryTakeSoldiers(ctx.barr.barracks, fromType, ADV_PLUS, n)
  if (!take) {
    ctx.addLog(`Not enough ADVANCED+ units of ${fromType}.`)
    return
  }

  const inv = ctx.econ.inv
  const hh = inv.horses.HEAVY_HORSE?.active ?? 0
  const ha = inv.armors.HORSE_ARMOR ?? 0
  if (hh < n || ha < n) {
    ctx.addLog('Need Heavy Horses and Horse Armor.')
    return
  }
  if (fromLightCav) {
    const heavyArmor = inv.armors.HEAVY_ARMOR ?? 0
    if (heavyArmor < n) {
      ctx.addLog('Need Heavy Armor to convert LIGHT_CAV → HEAVY_CAV.')
      return
    }
  }

  // All checks passed — commit state changes
  ctx.barr.setBarracks(prev => {
    const next = structuredClone(prev)
    for (const r in take) next[fromType][r as Rank].count -= take[r as Rank]!
    return next
  })
  ctx.econ.setInv(prev => {
    const next = structuredClone(prev)
    next.horses.HEAVY_HORSE.active -= n
    next.armors.HORSE_ARMOR -= n
    if (fromLightCav) next.armors.HEAVY_ARMOR -= n
    return next
  })
  ctx.barr.setBatches(prev =>
    enqueueBatch(prev, {
      level: ctx.barr.barracksLevel,
      kind: 'HEAVY_CAV',
      fromType,
      qty: n,
      takeByRank: take
    })
  )
  ctx.addLog(`Queued HEAVY_CAV conversion: ${n} from ${fromType} (ADV+).`)
}

// horse archers: from LIGHT_ARCHER (ADV+) with light horses
export function queueHorseArcherConversion(ctx: Ctx, qty: number) {
  const n = assertQty(qty)
  if (!requireSlot(ctx)) return

  const fromType = 'LIGHT_ARCHER'
  const take = tryTakeSoldiers(ctx.barr.barracks, fromType, ADV_PLUS, n)
  if (!take) {
    ctx.addLog('Not enough ADVANCED+ LIGHT_ARCHERs.')
    return
  }

  const have = ctx.econ.inv.horses.LIGHT_HORSE?.active ?? 0
  if (have < n) {
    ctx.addLog('Not enough Light Horses.')
    return
  }

  // All checks passed — commit state changes
  ctx.barr.setBarracks(prev => {
    const next = structuredClone(prev)
    for (const r in take) next[fromType][r as Rank].count -= take[r as Rank]!
    return next
  })
  ctx.econ.setInv(prev => {
    const next = structuredClone(prev)
    next.horses.LIGHT_HORSE.active -= n
    return next
  })
  ctx.barr.setBatches(prev =>
    enqueueBatch(prev, {
      level: ctx.barr.barracksLevel,
      kind: 'HORSE_ARCHER',
      fromType,
      qty: n,
      takeByRank: take
    })
  )
  ctx.addLog(`Queued HORSE_ARCHER conversion: ${n} (ADV+ from LIGHT_ARCHER).`)
}
