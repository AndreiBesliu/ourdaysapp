import { useState } from 'react'
import GameIcon from './GameIcon'
import MoneyDisplay from './MoneyDisplay'
import { getIconForGameItem, formatGameTooltip } from '../../logic/iconHelpers'

export default function MarketPanel({
  title,
  options,
  kind,
  have,
  onBuy,
  onSell,
}: {
  title: string
  options: { k: string; price: number }[]
  kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE'
  have: (k: string) => number
  onBuy: (kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE', subtype: string, qty: number) => void
  onSell: (kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE', subtype: string, qty: number) => void
}) {
  const [qty, setQty] = useState(10)
  return (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="space-y-2">
        {options.map(({ k, price }) => {
          return (
            <div key={k} className="border rounded p-2 flex items-center gap-2">
              <GameIcon name={getIconForGameItem(k) || 'sword'} size={32} />
              <div className="flex-1">
                <div className="font-medium">{formatGameTooltip(k)}</div>
                <div className="text-xs text-gray-600 flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    Price: <MoneyDisplay amount={price} size={12} />
                  </span>
                  <span>•</span>
                  <span>Have: <span className="font-mono">{have(k)}</span></span>
                </div>
              </div>
              <input
                className="border rounded px-2 py-1 w-20"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || '1')))}
              />
              <button className="px-3 py-1 border rounded" onClick={() => onSell(kind, k, qty)}>Sell</button>
              <button className="px-3 py-1 bg-black text-white rounded" onClick={() => onBuy(kind, k, qty)}>Buy</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
