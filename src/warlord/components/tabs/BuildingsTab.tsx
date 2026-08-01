import { useState } from 'react'
import Card from '../common/Card'
import { fmtCopper, type Building, type ResourceMap } from '../../logic/types'
import type { GameStateShape } from '../../state/useGameState'
import { buildingUpgradeCostCopper, buildingLevelMult, BUILDING_MAX_LEVEL } from '../../logic/economy'
import { formatGameTooltip } from '../../logic/iconHelpers'
import MoneyDisplay from '../common/MoneyDisplay'
import parchmentBg from '../../assets/parchment_bg.png'
import ProductionModal from '../buildings/ProductionModal'

import bBarracks from '../../assets/building_barracks.png'
import bWoodworker from '../../assets/building_woodworker.png'
import bMarket from '../../assets/building_market.png'
import bBlacksmith from '../../assets/building_blacksmith.png'
import bArmory from '../../assets/building_armory.png'
import bTailor from '../../assets/building_tailor.png'
import bStable from '../../assets/building_stable.png'

import bQuarry from '../../assets/building_quarry.png'
import bIronMine from '../../assets/building_iron_mine.png'
import bCoalMine from '../../assets/building_coal_mine.png'
import bCopperMine from '../../assets/building_copper_mine.png'
import bSilverMine from '../../assets/building_silver_mine.png'

type Props = {
  state: GameStateShape
  setTab: (tab: 'overview' | 'buildings' | 'barracks' | 'units' | 'market' | 'research' | 'log') => void
}

export const BuildingImages: Record<string, string> = {
  'BARRACKS': bBarracks,
  'WOODWORKER': bWoodworker,
  'MARKET': bMarket,
  'BLACKSMITH': bBlacksmith,
  'ARMORY': bArmory,
  'TAILOR': bTailor,
  'STABLE': bStable,

  // Resources
  'LUMBER_MILL': bWoodworker, // Fallback/reuse if lumber mill specific doesn't exist yet as building icon (different from interior)
  'QUARRY': bQuarry,
  'IRON_MINE': bIronMine,
  'COAL_MINE': bCoalMine,
  'COPPER_MINE': bCopperMine,
  'SILVER_MINE': bSilverMine,

  'SMELTER': bBlacksmith,
  'MINTER': bMarket,
}

export function BuildingIcon({ type, size = 24 }: { type: string, size?: number }) {
  const imgSrc = BuildingImages[type]
  return (
    <div
      className="inline-block shrink-0 relative overflow-hidden rounded shadow-sm border border-amber-900/40 bg-white"
      style={{ width: size, height: size }}
    >
      {imgSrc ? <img src={imgSrc} className="w-full h-full object-cover mix-blend-multiply" alt={type} /> : <div className="w-full h-full bg-stone-300"></div>}
    </div>
  )
}

function BuildingImg({ type }: { type: string }) {
  const imgSrc = BuildingImages[type]
  return (
    <div className="w-full aspect-[4/3] relative overflow-hidden rounded border border-yellow-900/30 shadow-inner bg-[#fffbf0] flex items-center justify-center">
      {imgSrc ? (
        <img
          src={imgSrc}
          className="w-full h-full object-cover mix-blend-multiply opacity-90 hover:scale-105 transition-transform duration-700"
          alt={type}
        />
      ) : (
        <span className="text-amber-900/20 font-bold text-lg">{type[0]}</span>
      )}
    </div>
  )
}

function PriceTag({ cost, resCost }: { cost: number, resCost?: Partial<ResourceMap> }) {
  const resources = Object.entries(resCost || {})
  return (
    <div className="flex flex-col items-center gap-1.5 text-xs">
      <MoneyDisplay amount={cost} size={12} className="inline-flex font-bold" />
      {resources.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {resources.map(([r, amt]) => (
            <span key={r} className="bg-stone-200 px-1.5 py-0.5 rounded text-stone-700 font-mono font-bold">
              {amt} {formatGameTooltip(r)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BuildingsTab({ state, setTab }: Props) {
  const {
    buildings,
    buildingPrice,
    buildingResCost,
    buyBuilding,
    setBuildingFocus,
    setBuildingOutput,
    barracksLevel,
    upgradeBarracks,
    upgradeBuilding,
    mods,
  } = state

  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)

  const buildingsArr = buildings ?? []
  const owns = (t: Building['type']) => buildingsArr.some(b => b.type === t)

  const prodTypes = ['BLACKSMITH', 'ARMORY', 'WOODWORKER', 'TAILOR', 'STABLE', 'MARKET', 'SCRIPTORIUM'] as const
  const resTypes = ['LUMBER_MILL', 'QUARRY', 'IRON_MINE', 'COAL_MINE', 'COPPER_MINE', 'SILVER_MINE', 'SMELTER', 'MINTER', 'FARM'] as const

  const prodConstruction = prodTypes.filter(t => !owns(t))
  const resConstruction = resTypes.filter(t => !owns(t))

  const handleBuildingClick = (b: Building) => {
    if (b.type === 'SCRIPTORIUM') {
      setTab('research')
      return
    }
    if (b.type === 'BARRACKS') {
      setTab('barracks')
    } else if (['MARKET', 'STABLE'].includes(b.type)) {
      setTab('market')
    } else if (prodTypes.includes(b.type as any)) {
      setSelectedBuildingId(b.id)
    } else {
      // Resource buildings might have simple focus controls?
      // For now, open same modal or skip if no options
      // They usually have no output choices, but might have focus?
      setSelectedBuildingId(b.id)
    }
  }

  const selectedBuilding = selectedBuildingId ? buildingsArr.find(b => b.id === selectedBuildingId) : null

  return (
    <>
      {selectedBuilding && (
        <ProductionModal
          building={selectedBuilding}
          onClose={() => setSelectedBuildingId(null)}
          onSetOutput={(item) => setBuildingOutput(selectedBuilding.id, item)}
          onSetFocus={(pct) => setBuildingFocus(selectedBuilding.id, pct)}
          prodMult={mods?.prodMult ?? 1}
          craftEfficiency={mods?.craftEfficiency ?? 1}
        />
      )}

      <Card title="Town Infrastructure" className="relative p-0 overflow-hidden bg-stone-800">
        <div
          className="absolute inset-0 opacity-100 z-0 pointer-events-none"
          style={{ backgroundImage: `url(${parchmentBg})`, backgroundSize: 'cover' }}
        />

        <div className="relative z-10 p-6 space-y-8">

          {/* Established Buildings */}
          <div>
            <h3 className="font-serif text-2xl text-amber-900 mb-4 border-b border-amber-900/30 pb-2">Established Buildings</h3>
            {buildingsArr.length === 0 && <div className="text-amber-800/60 italic">Empty. Build below.</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {buildingsArr.map((b) => (
                <div
                  key={b.id}
                  className="bg-amber-50/80 p-3 rounded-lg shadow-md border border-amber-900/20 flex flex-col gap-3 relative group hover:-translate-y-1 transition-transform duration-300 cursor-pointer"
                  onClick={() => handleBuildingClick(b)}
                >
                  <div className="flex justify-between items-center border-b border-amber-900/10 pb-2">
                    <span className="font-bold text-amber-900 text-sm">{b.type.replace('_', ' ')}</span>
                    {b.type === 'BARRACKS' ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-amber-200/50 px-1 rounded text-amber-800 font-mono">L{barracksLevel}</span>
                        {barracksLevel < 5 && (
                          <button onClick={(e) => { e.stopPropagation(); upgradeBarracks() }} className="text-[9px] bg-red-800 text-white px-1.5 py-0.5 rounded shadow hover:bg-red-700">
                            UP
                          </button>
                        )}
                      </div>
                    ) : ['MARKET', 'STABLE'].includes(b.type) ? (
                      <span className="text-[10px] bg-amber-200/50 px-1 rounded text-amber-800 font-mono">L{b.level ?? 1}</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-amber-200/50 px-1 rounded text-amber-800 font-mono">L{b.level ?? 1}</span>
                        {(b.level ?? 1) < BUILDING_MAX_LEVEL && (
                          <button
                            onClick={(e) => { e.stopPropagation(); upgradeBuilding(b.id) }}
                            title={`Upgrade to L${(b.level ?? 1) + 1} — ${fmtCopper(buildingUpgradeCostCopper(b.type, b.level ?? 1, mods?.buildCostMult ?? 1))} (output ×${buildingLevelMult((b.level ?? 1) + 1).toFixed(1)})`}
                            className="text-[9px] bg-red-800 text-white px-1.5 py-0.5 rounded shadow hover:bg-red-700"
                          >
                            UP
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <BuildingImg type={b.type} />

                  <div className="space-y-2 mt-auto pt-2" onClick={(e) => e.stopPropagation()}>
                    {!['STABLE', 'MARKET', 'BARRACKS'].includes(b.type) && (
                      <div className="text-[10px] text-amber-800/70 px-1 bg-amber-100/30 rounded py-1 border border-amber-900/5">
                        <div className="flex justify-between">
                          <span>{b.focusCoinPct}% Tax</span>
                          {b.outputItem && (
                            <span className="font-mono text-amber-900">
                              Creating {formatGameTooltip(b.outputItem)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Construction Plans */}
          {(prodConstruction.length > 0 || resConstruction.length > 0) && (
            <div className="space-y-6">
              <h3 className="font-serif text-2xl text-amber-900 border-b border-amber-900/30 pb-2">Construction Plans</h3>

              {/* Production */}
              {prodConstruction.length > 0 && (
                <div>
                  <h4 className="font-bold text-amber-800 mb-2 uppercase text-xs tracking-wider">Production & Military</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {prodConstruction.map(t => (
                      <button key={t} onClick={() => buyBuilding(t)} className="flex flex-col items-center p-3 rounded border border-amber-900/20 bg-amber-50/40 hover:bg-amber-100 transition-colors">
                        <div className="w-24 h-24 mb-3"><img src={BuildingImages[t]} className="w-full h-full object-contain mix-blend-multiply" alt={t} /></div>
                        <span className="font-bold text-sm text-amber-900 mb-2">{t}</span>
                        <PriceTag cost={buildingPrice(t)} resCost={buildingResCost(t)} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Resources */}
              {resConstruction.length > 0 && (
                <div>
                  <h4 className="font-bold text-amber-800 mb-2 uppercase text-xs tracking-wider">Resource Management</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {resConstruction.map(t => (
                      <button key={t} onClick={() => buyBuilding(t)} className="flex flex-col items-center p-3 rounded border border-amber-900/20 bg-stone-100/40 hover:bg-stone-200 transition-colors">
                        <div className="w-24 h-24 mb-3 flex items-center justify-center">
                          {BuildingImages[t] ?
                            <img src={BuildingImages[t]} className="w-full h-full object-contain mix-blend-multiply" alt={t} />
                            : <span className="text-4xl text-stone-400 font-bold">{t[0]}</span>
                          }
                        </div>
                        <span className="font-bold text-sm text-stone-800 mb-2">{t.replace('_', ' ')}</span>
                        <PriceTag cost={buildingPrice(t)} resCost={buildingResCost(t)} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-center text-xs text-amber-800/50 pt-8 font-serif italic">
            "A prosperous town fuels a mighty army."
          </div>

        </div>
      </Card>
    </>
  )
}
