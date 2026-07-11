import { useState } from 'react'

export default function SplitMergeControls({
  size,
  onSplit,
  selectedForMerge,
  onToggleMergeSelect
}: {
  size: number
  onSplit: (n: number) => void
  selectedForMerge: boolean
  onToggleMergeSelect: () => void
}) {
  const [take, setTake] = useState(Math.max(1, Math.floor(size/2)))
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <div className="flex items-center gap-1">
        <label className="text-xs text-gray-600">Split size</label>
        <input
          className="border rounded px-2 py-1 w-24"
          type="number" min={1} max={size-1}
          value={take}
          onChange={(e)=>setTake(Math.max(1, Math.min(size-1, parseInt(e.target.value||'0'))))}
        />
        <button className="px-3 py-1 border rounded" onClick={()=>onSplit(take)}>Split</button>
      </div>
      <label className="flex items-center gap-1 ml-4">
        <input type="checkbox" checked={selectedForMerge} onChange={onToggleMergeSelect}/>
        Select for merge
      </label>
    </div>
  )
}
