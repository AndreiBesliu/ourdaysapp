import { useMemo, useState } from 'react'
import { Ranks, type BarracksPool, type Rank, type SoldierType } from '../../logic/types'
import { demandFor, missingFromInventory } from '../../logic/equipment'

export default function ReplenishForm({
  unitType,
  pool,
  inv,
  onReplenish,
}: {
  unitId: string
  unitType: SoldierType
  pool: BarracksPool
  inv: any
  onReplenish: (plan: Partial<Record<Rank, number>>, opts?: { autoBuy?: boolean }) => void
}) {
  const [plan, setPlan] = useState<Partial<Record<Rank, number>>>({})
  const [autoBuy, setAutoBuy] = useState(true)

  const total = useMemo(()=>Object.values(plan).reduce((a,b)=>a+(b||0),0),[plan])
  const need  = useMemo(()=> demandFor(unitType, total), [unitType, total])
  const miss  = useMemo(()=> missingFromInventory(inv, need), [inv, need])

  return (
    <div className="mt-2 border rounded p-2 bg-gray-50">
      <div className="text-sm font-semibold mb-1">Replenish from Pools</div>

      <div className="grid grid-cols-5 gap-2 text-sm">
        {Ranks.map(r => {
          const avail = pool[unitType][r].count
          return (
            <div key={r} className="flex flex-col">
              <label className="text-xs text-gray-500">{r} (avail {avail})</label>
              <input
                className="border rounded px-2 py-1"
                type="number"
                min={0}
                max={avail}
                value={plan[r] || 0}
                onChange={e => {
                  const n = Math.max(0, Math.min(avail, parseInt(e.target.value || '0')))
                  setPlan(p => ({ ...p, [r]: n }))
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 text-xs">
        Need:
        {' '}
        {Object.entries(need.weapons).map(([k,v])=>`${k}:${v}`).join(' ') || '—'}
        {' | '}
        {Object.entries(need.armors).map(([k,v])=>`${k}:${v}`).join(' ') || '—'}
        {' | '}
        {Object.entries(need.horses).map(([k,v])=>`${k}:${v}`).join(' ') || '—'}
      </div>
      {!autoBuy && miss.any && <div className="text-xs text-red-600 mt-1">Missing gear in stock.</div>}

      <div className="mt-2 flex items-center gap-3">
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={autoBuy} onChange={e=>setAutoBuy(e.target.checked)} />
          Auto-buy missing gear
        </label>
        <button
          className="px-3 py-1 border rounded text-sm disabled:opacity-50"
          disabled={total===0 || (!autoBuy && miss.any)}
          onClick={()=>onReplenish(plan, { autoBuy })}
        >
          Replenish
        </button>
      </div>
    </div>
  )
}
