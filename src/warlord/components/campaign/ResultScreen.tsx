import type { LastBattleResult } from '../../state/useCampaign'
import MoneyDisplay from '../common/MoneyDisplay'
import GameIcon from '../common/GameIcon'
import { getIconForGameItem } from '../../logic/iconHelpers'

interface Props {
  result: LastBattleResult
  record: { wins: number; losses: number }
  onDismiss: () => void
}

export default function ResultScreen({ result, record, onDismiss }: Props) {
  const won = result.won
  return (
    <div className="max-w-md mx-auto text-center space-y-4 py-6">
      <div className={`text-4xl font-serif font-bold ${won ? 'text-green-700' : 'text-red-800'}`}>
        {won ? '🏆 Victory' : '💀 Defeat'}
      </div>
      <div className="text-stone-600">{won ? 'The field is yours.' : 'Your host is broken.'}</div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="border rounded-lg p-3 bg-white">
          <div className="font-mono text-xl font-bold text-red-700">{result.totalLosses}</div>
          <div className="text-xs text-stone-500">soldiers lost</div>
        </div>
        <div className="border rounded-lg p-3 bg-white">
          <div className="font-mono text-xl font-bold text-green-700">{result.totalKills}</div>
          <div className="text-xs text-stone-500">enemies slain</div>
        </div>
        <div className="border rounded-lg p-3 bg-white">
          <div className="font-mono text-xl font-bold">{result.destroyed}</div>
          <div className="text-xs text-stone-500">units wiped</div>
        </div>
      </div>

      {won && result.reward && (
        <div className="border rounded-lg p-3 bg-amber-50 inline-flex flex-col items-center gap-2">
          <div className="text-xs uppercase tracking-wide text-amber-800">Loot</div>
          <MoneyDisplay amount={result.reward.copper} />
          <div className="flex flex-wrap gap-2 justify-center">
            {Object.entries(result.reward.resources).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 text-sm">
                <GameIcon name={getIconForGameItem(k) || 'wood'} size={18} />
                <span className="font-mono">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-stone-500">Record: {record.wins}W / {record.losses}L</div>
      <button onClick={onDismiss} className="px-5 py-2 bg-black text-white rounded hover:bg-stone-800">
        Return to camp
      </button>
    </div>
  )
}
