import { useState } from 'react'
import type { Unit } from '../logic/types'
import { computeReady, splitUnit, mergeUnits } from '../logic/units'
import { demandFor, ensureEquipOrBuy } from '../logic/equipment'

export function useUnits(savedUnits?: Unit[]) {
  const [units, setUnits] = useState<Unit[]>(() => savedUnits ?? [])
  const [mergePick, setMergePick] = useState<string[]>([])

  // expose helpers; the hook that composes can pass inv/wallet/setters
  return {
    units, setUnits,
    mergePick, setMergePick,
    computeReady, splitUnit, mergeUnits,
    demandFor, ensureEquipOrBuy,  // tools used by create/replenish
  }
}
