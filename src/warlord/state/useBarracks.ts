import { useState, useCallback } from 'react'
import { Ranks, type SoldierType, type BarracksPool, type RecruitPool } from '../logic/types'
import { batchDurationDays, batchSlots, newBatchId, type TrainingBatch } from '../logic/batches'

export function emptyBarracks(): BarracksPool {
  const pool: any = {}
  const types: SoldierType[] = [
    'LIGHT_INF_SWORD','LIGHT_INF_SPEAR','LIGHT_INF_HALBERD',
    'HEAVY_INF_SWORD','HEAVY_INF_SPEAR','HEAVY_INF_HALBERD',
    'LIGHT_ARCHER','HEAVY_ARCHER','LIGHT_CAV','HEAVY_CAV','HORSE_ARCHER',
  ]
  types.forEach(t => {
    pool[t] = {}
    Ranks.forEach(r => { pool[t][r] = { r, count: 0, avgXP: 0 } })
  })
  return pool as BarracksPool
}

  export type BarracksDeps = {
    addLog: (s: string) => void
    setRecruits: React.Dispatch<React.SetStateAction<RecruitPool>>
  }
  export type BarracksAPI = ReturnType<typeof useBarracks>;

export interface BarracksSaved {
  barracks?: BarracksPool
  barracksLevel?: number
  recruits?: RecruitPool
  batches?: TrainingBatch[]
}

export default function useBarracks(saved?: BarracksSaved) {
  const [barracks, setBarracks] = useState<BarracksPool>(() => saved?.barracks ?? emptyBarracks())
  const [barracksLevel, setBarracksLevel] = useState(() => saved?.barracksLevel ?? 1)
  const [recruits, setRecruits] = useState<RecruitPool>(() => saved?.recruits ?? { count: 0, avgXP: 0 })
  const [batches, setBatches] = useState<TrainingBatch[]>(() => saved?.batches ?? [])

  function barracksUpgradeCost(level: number) {
    if (level === 1) return 50_00
    if (level === 2) return 150_00
    if (level === 3) return 400_00
    if (level === 4) return 800_00
    return Infinity
  }

  // plain recruit mutator (no logging here)
  const recruit = useCallback((qty: number) => {
    const n = Math.max(1, Math.floor(qty || 0))
    setRecruits((prev: RecruitPool) => {
      const oldCount = prev?.count ?? 0
      const newCount = oldCount + n
      // Blend avgXP: new recruits start at 0 XP, diluting the existing average
      const newAvgXP = oldCount > 0 ? Math.floor((prev.avgXP * oldCount) / newCount) : 0
      return { count: newCount, avgXP: newAvgXP }
    })
  }, [])

  return {
    // state
    barracks, setBarracks,
    barracksLevel, setBarracksLevel,
    recruits, setRecruits,
    batches, setBatches,

    // helpers
    barracksUpgradeCost,
    batchSlots,
    batchDurationDays,
    newBatchId,
    recruit, // note: logging happens in useGameState wrapper
  }
}