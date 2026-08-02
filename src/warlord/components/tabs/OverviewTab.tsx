import Card from '../common/Card'
import InvSummary from '../common/InvSummary'
import type { GameStateShape } from '../../state/useGameState'
import MoneyDisplay from '../common/MoneyDisplay'

export default function OverviewTab({ state }: { state: GameStateShape }) {
  const { buildings, wallet, inv } = state
  const buildingsArr = buildings ?? []

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card title="Buildings">
        <ul className="text-sm list-disc ml-4">
          {buildingsArr.map((b: any) => (
            <li key={b.id}>
              {b.type} — focus {b.focusCoinPct}%{b.outputItem ? ` → ${b.outputItem}` : ''}
            </li>
          ))}
        </ul>
        <div className="text-xs text-gray-500 mt-2">
          Coin/day scales with the building price (or its resource value), its level and research. Coin you give up becomes goods — see the bar at the top for what tomorrow actually brings.
        </div>
      </Card>

      <Card title="Inventory">
        <div className="mb-2 text-sm flex items-center gap-2">
          <span>Wallet:</span>
          <MoneyDisplay amount={wallet} />
        </div>
        <InvSummary inv={inv} />
      </Card>
    </div>
  )
}
