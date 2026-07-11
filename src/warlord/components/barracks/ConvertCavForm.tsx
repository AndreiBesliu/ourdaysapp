import { useEffect, useState } from 'react'
import { Ranks, type BarracksPool, type Rank, type SoldierType } from '../../logic/types'

export default function ConvertCavForm({
  barracks,
  onConvert
}:{
  barracks: BarracksPool,
  onConvert: (fromType: SoldierType, toType: 'LIGHT_CAV'|'HEAVY_CAV'|'HORSE_ARCHER',
              plan: Partial<Record<Rank, number>>) => void
}){
  const [to, setTo] = useState<'LIGHT_CAV'|'HEAVY_CAV'|'HORSE_ARCHER'>('LIGHT_CAV')
  const fromOptions: SoldierType[] = to==='LIGHT_CAV'
    ? ['LIGHT_INF_SWORD','LIGHT_INF_SPEAR','LIGHT_INF_HALBERD']
    : to==='HEAVY_CAV'
    ? ['HEAVY_INF_SWORD','HEAVY_INF_SPEAR','HEAVY_INF_HALBERD']
    : ['LIGHT_ARCHER']
  const [fromType, setFromType] = useState<SoldierType>(fromOptions[0])
  const [plan, setPlan] = useState<Partial<Record<Rank, number>>>({ NOVICE: 0, TRAINED: 0, ADVANCED: 0 })

  useEffect(()=>{ setFromType(fromOptions[0]) }, [to])

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-end">
        <div className="flex flex-col">
          <label className="text-sm">To</label>
          <select className="border rounded px-2 py-1" value={to} onChange={e=>setTo(e.target.value as any)}>
            <option value="LIGHT_CAV">LIGHT_CAV</option>
            <option value="HEAVY_CAV">HEAVY_CAV</option>
            <option value="HORSE_ARCHER">HORSE_ARCHER</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-sm">From</label>
          <select className="border rounded px-2 py-1" value={fromType} onChange={e=>setFromType(e.target.value as SoldierType)}>
            {fromOptions.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {Ranks.map(r=>(
          <div key={r} className="flex flex-col">
            <label className="text-xs text-gray-500">{r} (avail {barracks[fromType][r].count})</label>
            <input className="border rounded px-2 py-1" type="number" min={0} value={plan[r]||0}
              onChange={e=>setPlan({...plan, [r]: Math.max(0, parseInt(e.target.value||'0'))})}/>
          </div>
        ))}
      </div>
      <button className="px-3 py-1 border rounded" onClick={()=>onConvert(fromType, to, plan)}>Convert</button>
    </div>
  )
}
