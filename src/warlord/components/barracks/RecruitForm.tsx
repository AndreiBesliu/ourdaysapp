import { useState } from 'react'

export default function RecruitForm({
  onRecruit,
}: { onRecruit: (qty: number) => void }) {
  const [q, setQ] = useState<number>(50)

  const onClick = () => {
    // guard against NaN/empty input
    const qty = Math.max(1, Math.floor(Number.isFinite(q) ? q : 1))
    onRecruit(qty)
  }

  return (
    <div className="flex gap-2 items-end">
      <div className="flex flex-col">
        <label className="text-sm">Qty</label>
        <input
          className="border rounded px-2 py-1 w-24"
          type="number"
          min={1}
          value={Number.isFinite(q) ? q : 1}
          onChange={(e) => {
            const n = parseInt(e.target.value || '0', 10)
            setQ(Number.isFinite(n) ? n : 0)
          }}
        />
      </div>
      <button className="px-3 py-2 bg-black text-white rounded" onClick={onClick}>
        Recruit
      </button>
    </div>
  )
}