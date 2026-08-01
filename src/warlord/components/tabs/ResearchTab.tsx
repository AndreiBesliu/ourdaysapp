import Card from '../common/Card'
import MoneyDisplay from '../common/MoneyDisplay'
import GameIcon from '../common/GameIcon'
import type { GameStateShape } from '../../state/useGameState'
import type { Branch, Modifiers } from '../../logic/research/effects'
import { BRANCH_LABEL, prereqsMet, missingBuildings, techById, type TechDef } from '../../logic/research/catalog'
import { getIconForGameItem, formatGameTooltip } from '../../logic/iconHelpers'

const BRANCHES: Branch[] = ['ECONOMY', 'ARMY', 'CAMPAIGN', 'UNLOCKS']

const BRANCH_STYLE: Record<Branch, string> = {
  ECONOMY: 'bg-amber-50 border-amber-300',
  ARMY: 'bg-red-50 border-red-300',
  CAMPAIGN: 'bg-blue-50 border-blue-300',
  UNLOCKS: 'bg-violet-50 border-violet-300',
}

const BRANCH_HEAD: Record<Branch, string> = {
  ECONOMY: 'text-amber-900',
  ARMY: 'text-red-900',
  CAMPAIGN: 'text-blue-900',
  UNLOCKS: 'text-violet-900',
}

// Human-readable summary of the aggregated modifiers — so the player can always see
// exactly what their research + momentum is worth right now.
function effectLines(m: Modifiers): string[] {
  const out: string[] = []
  const pct = (v: number) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`
  if (m.prodMult !== 1) out.push(`Production ${pct(m.prodMult)}`)
  if (m.craftEfficiency !== 1) out.push(`Crafting ${pct(m.craftEfficiency)}`)
  if (m.buildCostMult !== 1) out.push(`Build cost ${pct(m.buildCostMult)}`)
  if (m.upkeepMult !== 1) out.push(`Upkeep ${pct(m.upkeepMult)}`)
  if (m.foodMult !== 1) out.push(`Food use ${pct(m.foodMult)}`)
  if (m.trainXpMult !== 1) out.push(`Training XP ${pct(m.trainXpMult)}`)
  if (m.trainDaysDelta !== 0) out.push(`Training ${m.trainDaysDelta}d`)
  if (m.trainSlotsDelta !== 0) out.push(`+${m.trainSlotsDelta} training slot${m.trainSlotsDelta > 1 ? 's' : ''}`)
  if (m.lootMult !== 1) out.push(`Battle loot ${pct(m.lootMult)}`)
  if (m.postBattleMoraleBonus !== 0) out.push(`Post-battle morale +${m.postBattleMoraleBonus}`)
  return out
}

export default function ResearchTab({ state }: { state: GameStateShape }) {
  const { research, mods, catalog, startResearch, wallet, resources, buildings } = state
  const inProgress = new Map(research.queue.map((p) => [p.id, p]))

  const canAfford = (t: TechDef) =>
    wallet >= t.costCopper &&
    Object.entries(t.costResources).every(([r, amt]) => (resources[r as keyof typeof resources] || 0) >= (amt as number))

  const effects = effectLines(mods)

  return (
    <div className="space-y-4">
      {/* Momentum — the cross-branch effects. Front and centre so they're felt. */}
      <Card title="Momentum & Standing">
        <div className="space-y-3">
          {research.buffs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {research.buffs.map((b) => (
                <div
                  key={b.id}
                  title={b.desc}
                  className={`px-3 py-2 rounded-lg border text-sm ${b.good ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}
                >
                  <div className="font-semibold">{b.good ? '🔥' : '🩸'} {b.name}</div>
                  <div className="text-xs text-stone-600">{b.daysRemaining}d left</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-600">
              No active momentum. Win a battle or finish a research project — victories lift
              your workshops and your soldiers in training for a few days.
            </p>
          )}

          <div className="border-t pt-2">
            <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">Total effect</div>
            {effects.length === 0 ? (
              <span className="text-sm text-stone-500">Nothing researched yet.</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {effects.map((e) => (
                  <span key={e} className="text-xs font-mono px-2 py-1 rounded bg-stone-100 border">{e}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BRANCHES.map((branch) => (
          <div key={branch} className="space-y-2">
            <h3 className={`font-serif text-lg font-bold ${BRANCH_HEAD[branch]}`}>{BRANCH_LABEL[branch]}</h3>
            {catalog
              .filter((t) => t.branch === branch)
              .sort((a, b) => a.tier - b.tier)
              .map((t) => {
                const done = research.unlocked.includes(t.id)
                const busy = inProgress.get(t.id)
                const missingB = missingBuildings(t, buildings ?? [])
                const ready = prereqsMet(t, research.unlocked) && missingB.length === 0
                const affordable = canAfford(t)
                const missingReq = t.requires
                  .filter((r) => !research.unlocked.includes(r))
                  .map((r) => techById(catalog, r)?.name ?? r)

                return (
                  <div
                    key={t.id}
                    className={`border rounded-lg p-3 ${done ? 'bg-green-50 border-green-300' : busy ? 'bg-yellow-50 border-yellow-400' : ready ? BRANCH_STYLE[branch] : 'bg-stone-100 border-stone-300 opacity-70'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm">
                        {done ? '✔ ' : busy ? '⏳ ' : !ready ? '🔒 ' : ''}{t.name}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/70 border font-mono">T{t.tier}</span>
                    </div>
                    <p className="text-xs text-stone-600 mt-1 min-h-[32px]">{t.desc}</p>

                    {done && <div className="text-xs text-green-800 font-semibold">Researched</div>}

                    {busy && (
                      <div className="text-xs text-yellow-900 font-semibold">
                        In progress — {busy.daysRemaining} day{busy.daysRemaining > 1 ? 's' : ''} left
                      </div>
                    )}

                    {!done && !busy && (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs mt-1">
                          <MoneyDisplay amount={t.costCopper} size={14} />
                          {Object.entries(t.costResources).map(([r, amt]) => (
                            <span key={r} className="inline-flex items-center gap-1" title={formatGameTooltip(r)}>
                              <GameIcon name={getIconForGameItem(r) || 'wood'} size={14} />
                              <span className="font-mono">{amt as number}</span>
                            </span>
                          ))}
                          <span className="text-stone-500 font-mono">{t.days}d</span>
                        </div>
                        {!ready ? (
                          <div className="text-xs text-stone-500 mt-1">
                            {missingReq.length > 0 && <div>Requires: {missingReq.join(', ')}</div>}
                            {missingB.length > 0 && <div>Needs: {missingB.join(', ')}</div>}
                          </div>
                        ) : (
                          <button
                            onClick={() => startResearch(t.id)}
                            disabled={!affordable}
                            className={`mt-2 w-full px-3 py-1 rounded text-sm ${affordable ? 'bg-black text-white hover:bg-stone-800' : 'bg-stone-300 text-stone-500 cursor-not-allowed'}`}
                          >
                            {affordable ? 'Research 🔬' : 'Cannot afford'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
          </div>
        ))}
      </div>

      <div className="text-center text-xs text-stone-500 italic">
        Research improves your domain — production, training, supply and campaign spoils.
        Battles are always fought on even stats; a stronger economy simply fields a better army.
      </div>
    </div>
  )
}
