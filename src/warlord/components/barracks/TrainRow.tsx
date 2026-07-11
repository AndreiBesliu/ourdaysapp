import { useState } from 'react'

export default function TrainRow({ label, onTrain }:{label:string; onTrain:(n:number)=>void}) {
  const [n, setN] = useState(20)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">{label}</div>
      <input className="border rounded px-2 py-1 w-24" type="number" min={1} value={n}
        onChange={e=>setN(Math.max(1, parseInt(e.target.value||'1')))} />
      <button className="px-3 py-1 border rounded" onClick={()=>onTrain(n)}>Train</button>
    </div>
  )
}
