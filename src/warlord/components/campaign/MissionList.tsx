import type { Difficulty, MissionPreset } from '../../logic/combat/types'

interface Props {
  presets: Record<Difficulty, MissionPreset>
  difficulties: Difficulty[]
  record: { wins: number; losses: number }
  onPick: (d: Difficulty) => void
}

const BADGE: Record<Difficulty, string> = {
  BANDIT_RAID: 'bg-green-100 text-green-800 border-green-300',
  RIVAL_BARON: 'bg-amber-100 text-amber-800 border-amber-300',
  INVASION: 'bg-red-100 text-red-800 border-red-300',
}

const FLAVOR: Record<Difficulty, string> = {
  BANDIT_RAID: 'A ragged warband harasses your lands. A gentle first blooding.',
  RIVAL_BARON: 'A neighbouring lord tests your borders with a balanced host.',
  INVASION: 'A disciplined army marches on your seat. Bring your best.',
}

export default function MissionList({ presets, difficulties, record, onPick }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm">
        <span className="font-semibold">Campaign record:</span>
        <span className="text-green-700 font-mono">{record.wins} W</span>
        <span className="text-red-700 font-mono">{record.losses} L</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {difficulties.map((d) => {
          const p = presets[d]
          return (
            <div key={d} className="border rounded-xl p-4 bg-white flex flex-col gap-2 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-lg font-bold">{p.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide ${BADGE[d]}`}>
                  {d === 'BANDIT_RAID' ? 'Easy' : d === 'RIVAL_BARON' ? 'Medium' : 'Hard'}
                </span>
              </div>
              <p className="text-xs text-stone-600 min-h-[48px]">{FLAVOR[d]}</p>
              <div className="text-xs text-stone-500">Enemy strength ≈ <span className="font-mono">{Math.round(p.ratio * 100)}%</span> of your host</div>
              <button
                onClick={() => onPick(d)}
                className="mt-1 px-3 py-2 bg-black text-white rounded hover:bg-stone-800 transition-colors"
              >
                Prepare ⚔
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
