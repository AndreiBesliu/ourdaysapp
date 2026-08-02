import { forecastDay, explainResource } from '../../logic/forecast'
import { ResourceTypes, fmtCopper, type Building, type Inventories, type ResourceMap, type ResourceType, type Unit } from '../../logic/types'
import { formatGameTooltip, getIconForGameItem } from '../../logic/iconHelpers'
import GameIcon from './GameIcon'

type Props = {
  wallet: number
  resources: ResourceMap
  inv: Inventories
  buildings: Building[]
  units: Unit[]
  mods?: { prodMult?: number; craftEfficiency?: number; upkeepMult?: number; foodMult?: number }
}

// Always shown even at zero: these three decide whether the domain lives or starves.
const ALWAYS: ResourceType[] = ['FOOD', 'WOOD', 'STONE']

function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="text-stone-400 font-mono text-[11px]">±0</span>
  return (
    <span className={`font-mono text-[11px] ${n > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
      {n > 0 ? '+' : ''}{n}
    </span>
  )
}

export default function ResourceBar({ wallet, resources, inv, buildings, units, mods }: Props) {
  // Recomputed every render on purpose. It is one pass over a handful of buildings, and
  // memoising on `inv` would be WRONG: queueLightTraining mutates the inventory object in
  // place, so its identity does not change when equipment is spent.
  const f = forecastDay({ buildings, resources, inv, units, mods })

  const shown = ResourceTypes.filter(
    (r) => ALWAYS.includes(r) || (resources[r] ?? 0) > 0 || f.resourceDelta[r] !== 0,
  )

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 border border-amber-200"
        title={
          `Buildings and minting: ${fmtCopper(f.incomeWalletDelta)}/day\n` +
          `Soldier upkeep: −${fmtCopper(f.soldierUpkeep)}/day` +
          (f.walletDelta < 0 && wallet + f.walletDelta < 0 ? '\n⚠ The treasury goes negative tomorrow' : '')
        }
      >
        <GameIcon name="gold" size={16} />
        <span className="font-mono">{fmtCopper(wallet)}</span>
        <Delta n={f.walletDelta} />
      </span>

      {shown.map((r) => {
        const stock = resources[r] ?? 0
        const delta = f.resourceDelta[r]
        const empties = f.daysToEmpty[r]
        const starving = r === 'FOOD' && f.foodShortage
        const why = explainResource(f, r)
        return (
          <span
            key={r}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border ${
              starving ? 'bg-red-50 border-red-300' : 'bg-white border-stone-200'
            }`}
            title={
              `${formatGameTooltip(r)}\n` +
              (why.length ? why.join('\n') + '\n' : '') +
              (empties !== undefined ? `Empty in ${empties} day${empties === 1 ? '' : 's'}\n` : '') +
              (starving ? '⚠ Not enough food — morale is falling' : '')
            }
          >
            <GameIcon name={getIconForGameItem(r) || 'wood'} size={16} />
            <span className="font-mono">{stock}</span>
            <Delta n={delta} />
          </span>
        )
      })}

      {f.blocked.length > 0 && (
        <span
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 border border-amber-300 text-[11px] text-amber-900"
          title={f.blocked
            .map((l) => `${l.type} wants ${l.itemsWanted} ${l.outputItem} but has no inputs — the output is lost, not stored`)
            .join('\n')}
        >
          ⚠ {f.blocked.length} idle
        </span>
      )}
    </div>
  )
}
