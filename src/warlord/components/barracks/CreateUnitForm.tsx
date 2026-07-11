import { useMemo, useState } from 'react'
import { SoldierTypes, Ranks, type SoldierType, type Rank, type BarracksPool } from '../../logic/types'
import { demandFor, missingFromInventory } from '../../logic/equipment'

export default function CreateUnitForm({
  barracks,
  onCreate,
  inv,
}:{
  barracks: BarracksPool
  inv: any
  onCreate: (type: SoldierType, take: Partial<Record<Rank, number>>, opts?:{autoBuy?:boolean}) => void
}){
  const [type, setType] = useState<SoldierType>('LIGHT_INF_SPEAR')
  const [plan, setPlan] = useState<Partial<Record<Rank, number>>>({})
  const [autoBuy, setAutoBuy] = useState(true)

  const total = useMemo(()=>Object.values(plan).reduce((a,b)=>a+(b||0),0),[plan])
  const need = useMemo(()=> demandFor(type, total), [type, total])
  const miss = useMemo(()=> missingFromInventory(inv, need), [inv, need])

  return (
    <div className="border rounded p-2 space-y-2">
      <div className="flex gap-2">
        <label className="text-sm">Type</label>
        <select className="border rounded px-2 py-1" value={type} onChange={e=>setType(e.target.value as SoldierType)}>
          {SoldierTypes.map(t=> <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="ml-auto text-sm flex items-center gap-2">
          <input type="checkbox" checked={autoBuy} onChange={e=>setAutoBuy(e.target.checked)} />
          Auto-buy missing gear
        </label>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {Ranks.map(r=>(
          <div key={r} className="flex flex-col">
            <label className="text-xs text-gray-500">{r} (avail {barracks[type][r].count})</label>
            <input className="border rounded px-2 py-1" type="number" min={0}
              value={plan[r]||0}
              onChange={e=>setPlan({...plan, [r]: Math.max(0, parseInt(e.target.value||'0'))})}/>
          </div>
        ))}
      </div>

      {/* Equipment preview */}
      <div className="text-sm bg-gray-50 rounded p-2">
        <div className="font-semibold mb-1">Equipment needed for {total} {type}:</div>
        <div className="grid md:grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-gray-500">Weapons</div>
            {Object.entries(need.weapons).map(([k,v])=>{
              const have = inv.weapons[k] ?? 0
              return <div key={k} className={have>=v?'':'text-red-600'}>{k}: {v} (have {have})</div>
            })}
          </div>
          <div>
            <div className="text-xs text-gray-500">Armors</div>
            {Object.entries(need.armors).map(([k,v])=>{
              const have = inv.armors[k] ?? 0
              return <div key={k} className={have>=v?'':'text-red-600'}>{k}: {v} (have {have})</div>
            })}
          </div>
          <div>
            <div className="text-xs text-gray-500">Horses</div>
            {Object.entries(need.horses).map(([k,v])=>{
              const have = inv.horses[k as any]?.active ?? 0
              return <div key={k} className={have>=v?'':'text-red-600'}>{k}: {v} (have {have})</div>
            })}
          </div>
        </div>
        {!autoBuy && miss.any && <div className="mt-1 text-red-700 text-xs">Missing gear present — enable auto-buy or adjust.</div>}
      </div>

      <button
        className="px-3 py-1 border rounded disabled:opacity-50"
        disabled={total===0 || (!autoBuy && miss.any)}
        onClick={()=>onCreate(type, plan, { autoBuy })}
      >
        Create Unit
      </button>
    </div>
  )
}
