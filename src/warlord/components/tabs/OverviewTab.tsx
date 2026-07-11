import Card from '../common/Card'
import InvSummary from '../common/InvSummary'
import type { GameStateShape } from '../../state/useGameState'
import GameIcon from '../common/GameIcon'
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
          Passive coin/day = 10% of cost. Foregone coin → items at 70% value.
        </div>
      </Card>

      <Card title="Inventory">
        <div className="mb-2 text-sm flex items-center gap-2">
          <span>Wallet:</span>
          <MoneyDisplay amount={wallet} />
        </div>
        <InvSummary inv={inv} />
      </Card>

      {/* Temporary Icon Test Area */}
      <Card title="Icon Debug">
        <div className="flex flex-wrap gap-4">
          {(['sword', 'spear', 'halberd', 'bow', 'heavy_armor', 'light_armor', 'horse_armor', 'light_horse', 'heavy_horse', 'gold', 'silver', 'copper'] as const).map(name => (
            <div key={name} className="flex flex-col items-center">
              <GameIcon name={name} size={32} />
              <span className="text-[10px] text-gray-400 mt-1">{name}</span>
            </div>
          ))}
        </div>
      </Card>

    </div>
  )
}
