
import { Ranks, type Rank, type BarracksPool, type SoldierType } from './types'

  export type BatchKind = 'LIGHT_TRAIN' | 'LIGHT_CAV' | 'HEAVY_CAV' | 'HORSE_ARCHER'

  export type RankCount = Partial<Record<Rank, number>>

  export interface TrainingBatch {
    id: string
    kind: BatchKind
    target?: SoldierType        // e.g., 'LIGHT_INF_SPEAR', 'LIGHT_ARCHER'
    fromType?: SoldierType      // e.g., 'LIGHT_CAV' or 'HEAVY_INF_*' for heavy cav
    qty: number                 // 1..50
    daysRemaining: number
    takeByRank?: RankCount      // if conversion, what ranks were consumed
  }

// L1=2 slots, +1 per level, cap 5 (reached at L4)
export function batchSlots(level: number, extra = 0) {
  return Math.min(level + 1, 5) + Math.max(0, Math.round(extra))
}

// L1=7 days, -1 per level, min 3 days
// `daysDelta` (negative) lets research shorten training; never below 1 day.
export function batchDurationDays(level: number, daysDelta = 0) {
  return Math.max(1, Math.max(7 - (level - 1), 3) + Math.round(daysDelta))
}

export function newBatchId() {
  return `B_${Math.random().toString(36).slice(2, 8)}`
}

export function enqueueBatch(
  current: TrainingBatch[],
  draft: Omit<TrainingBatch, 'id' | 'daysRemaining'> & { level: number }
): TrainingBatch[] {
  const id = newBatchId()
  const daysRemaining = batchDurationDays(draft.level)
  const next: TrainingBatch = {
    id,
    kind: draft.kind,
    target: draft.target,
    fromType: draft.fromType,
    qty: draft.qty,
    daysRemaining,
    takeByRank: draft.takeByRank
  }
  return [next, ...current]
}

export function canEnqueue(current: TrainingBatch[], level: number) {
  return current.length < batchSlots(level)
}

export function buildBatch(
  level: number,
  payload: { kind: BatchKind; target: SoldierType; qty: number; fromType?: SoldierType; takeByRank?: RankCount }
): TrainingBatch {
  return {
    id: newBatchId(),
    kind: payload.kind,
    target: payload.target,
    fromType: payload.fromType,
    qty: payload.qty,
    daysRemaining: batchDurationDays(level),
    takeByRank: payload.takeByRank
  }
}

  /** take from pool by rank using a plan, throws if insufficient */
  export function deductByRank(pool: BarracksPool, fromType: SoldierType, plan: RankCount) {
    for (const r of Ranks) {
      const want = plan[r] || 0
      if (want > 0 && pool[fromType][r].count < want) {
        throw new Error(`Not enough ${fromType} ${r}`)
      }
    }
    for (const r of Ranks) {
      const want = plan[r] || 0
      if (want > 0) pool[fromType][r].count -= want
    }
  }

  export function addByRank(pool: BarracksPool, toType: SoldierType, plan: RankCount) {
    for (const r of Ranks) {
      const q = plan[r] || 0
      if (q > 0) pool[toType][r].count += q
    }
  }

  export function sumPlan(plan: RankCount) {
    return Ranks.reduce((a,r)=>a+(plan[r]||0),0)
  }
