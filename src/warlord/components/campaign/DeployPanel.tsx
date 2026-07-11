import { useState } from 'react'
import type { Unit } from '../../logic/types'
import type { Difficulty, MissionPreset } from '../../logic/combat/types'
import { fieldedStrength, prettyName } from '../../logic/combat/army'
import GameIcon from '../common/GameIcon'
import { getIconForGameItem } from '../../logic/iconHelpers'

interface Props {
  units: Unit[]
  difficulty: Difficulty
  preset: MissionPreset
  onConfirm: (ids: string[]) => void
  onBack: () => void
}

export default function DeployPanel({ units, preset, onConfirm, onBack }: Props) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const deployStrength = units.filter((u) => picked.includes(u.id)).reduce((a, u) => a + fieldedStrength(u), 0)
  const estEnemy = Math.round(deployStrength * preset.ratio)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold">Deploy for {preset.name}</h3>
        <button onClick={onBack} className="px-3 py-1 border rounded text-sm">← Missions</button>
      </div>

      {units.length === 0 ? (
        <p className="text-sm text-stone-600">You have no formed units. Create units in the Units tab before marching to battle.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {units.map((u) => {
            const size = u.buckets.reduce((a, b) => a + b.count, 0)
            const on = picked.includes(u.id)
            return (
              <button
                key={u.id}
                onClick={() => toggle(u.id)}
                className={`flex items-center gap-3 border rounded-lg p-2 text-left transition-all ${on ? 'ring-2 ring-yellow-400 bg-yellow-50' : 'bg-white hover:bg-stone-50'}`}
              >
                <GameIcon name={getIconForGameItem(u.type) || 'sword'} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{prettyName(u.type)}</div>
                  <div className="text-xs text-stone-500 font-mono">{size} soldiers · morale {Math.round(u.morale ?? 100)} · fielded {fieldedStrength(u)}</div>
                </div>
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-black text-white' : 'bg-white'}`}>{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-sm text-stone-600">
          Deploying <span className="font-mono font-bold">{picked.length}</span> units ·
          strength <span className="font-mono font-bold">{deployStrength}</span> ·
          est. enemy <span className="font-mono font-bold text-red-700">≈{estEnemy}</span>
        </div>
        <button
          disabled={picked.length === 0}
          onClick={() => onConfirm(picked)}
          className={`px-4 py-2 rounded text-white ${picked.length ? 'bg-red-800 hover:bg-red-900' : 'bg-stone-300 cursor-not-allowed'}`}
        >
          March to battle ⚔
        </button>
      </div>
    </div>
  )
}
