import { createPortal } from 'react-dom'
import { type Building } from '../../logic/types'
import { BuildingCostCopper, BuildingOutputChoices } from '../../logic/economy'
import { itemValueCopper } from '../../logic/items'
import { getIconForGameItem } from '../../logic/iconHelpers'
import MoneyDisplay from '../common/MoneyDisplay'
import GameIcon from '../common/GameIcon'
// Import backgrounds
import bgWoodworker from '../../assets/interiors/woodworker.png'
import bgBlacksmith from '../../assets/interiors/blacksmith.png'
import bgArmory from '../../assets/interiors/armory.png'
import bgTailor from '../../assets/interiors/tailor.png'

import bgLumberMill from '../../assets/interiors/lumber_mill_interior.png'

type Props = {
    building: Building
    onClose: () => void
    onSetOutput: (item: string) => void
    onSetFocus: (pct: number) => void
}

const InteriorMap: Record<string, string> = {
    WOODWORKER: bgWoodworker,
    BLACKSMITH: bgBlacksmith,
    ARMORY: bgArmory,
    TAILOR: bgTailor,
    LUMBER_MILL: bgLumberMill, // New image
    QUARRY: bgBlacksmith,
    SMELTER: bgBlacksmith,
    MINTER: bgTailor,
    // ... others
    IRON_MINE: bgBlacksmith,
    COAL_MINE: bgBlacksmith,
    COPPER_MINE: bgBlacksmith,
    SILVER_MINE: bgBlacksmith,
    STABLE: bgTailor,
    MARKET: bgTailor,
}

export default function ProductionModal({ building, onClose, onSetOutput, onSetFocus }: Props) {
    const bg = InteriorMap[building.type] || bgBlacksmith
    const options = BuildingOutputChoices[building.type]?.options || []

    // Calculate stats for preview
    let coinGain = 0
    let items = '0'

    if (building.type === 'LUMBER_MILL' && building.outputItem === 'WOOD') {
        coinGain = 0
        items = '10'
    } else {
        const cost = BuildingCostCopper[building.type] || 0
        const basePerDay = 0.10 * cost
        coinGain = Math.round(basePerDay * (building.focusCoinPct / 100))
        const remainderValue = basePerDay - coinGain
        const mv = itemValueCopper(building.outputItem || options[0] || '') || 1
        items = (remainderValue > 0 && mv > 0)
            ? (remainderValue / (0.7 * mv)).toFixed(1)
            : '0'
    }

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative w-full max-w-5xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-stone-600">

                {/* Background Image */}
                <div
                    className="absolute inset-0 bg-cover bg-center transition-all duration-700"
                    style={{ backgroundImage: `url(${bg})` }}
                />

                {/* Overlay Gradient for readability */}
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 bg-black/50 hover:bg-red-900/80 text-white rounded-full p-2 w-10 h-10 flex items-center justify-center border border-white/20 transition-colors"
                >
                    ✕
                </button>

                {/* Title */}
                <div className="absolute top-6 left-6 text-white drop-shadow-md">
                    <h2 className="text-4xl font-serif font-bold tracking-wide text-amber-100">{building.type.replace('_', ' ')}</h2>
                    <div className="text-amber-200/60 text-sm tracking-widest uppercase">Production Management</div>
                </div>

                {/* Interactive Item Showcase (Middle-ish) */}
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <div className="flex gap-8 pointer-events-auto transform translate-y-[-10%]">
                        {options.map((opt) => {
                            const isSelected = building.outputItem === opt
                            return (
                                <button
                                    key={opt}
                                    onClick={() => onSetOutput(opt)}
                                    className={`
                    group relative flex flex-col items-center gap-3 transition-all duration-300
                    ${isSelected ? 'scale-125 z-10' : 'scale-100 opacity-70 hover:opacity-100 hover:scale-110'}
                  `}
                                >
                                    {/* Glowing backing for selected */}
                                    {isSelected && <div className="absolute inset-0 bg-yellow-400/30 blur-xl rounded-full" />}

                                    <div className={`
                    w-20 h-20 flex items-center justify-center rounded-xl border-2 shadow-xl bg-black/60
                    ${isSelected ? 'border-yellow-400 shadow-yellow-500/20' : 'border-white/10 border-dashed'}
                  `}>
                                        <GameIcon name={getIconForGameItem(opt) || 'sword'} size={48} />
                                    </div>

                                    <span className={`
                     px-3 py-1 rounded bg-black/80 text-xs font-bold font-mono tracking-wider border
                     ${isSelected ? 'text-yellow-400 border-yellow-400/30' : 'text-gray-400 border-transparent'}
                  `}>
                                        {opt.replace(/_/g, ' ')}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Bottom Manager Controls */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-stone-900/90 border border-stone-700 p-6 rounded-xl shadow-2xl w-[600px] backdrop-blur-md flex flex-col gap-4">

                    {/* Stats Header */}
                    <div className="flex justify-between items-end border-b border-white/10 pb-2">
                        <div className="flex flex-col">
                            <span className="text-xs text-stone-400 uppercase tracking-widest">Daily Output Preview</span>
                            <div className="flex items-baseline gap-4 mt-1">
                                <span className="text-yellow-400 font-bold text-xl drop-shadow-sm">
                                    <MoneyDisplay amount={coinGain} />
                                </span>
                                <span className="text-stone-500 font-serif italic text-sm">and</span>
                                <span className="text-white font-bold text-xl drop-shadow-sm">
                                    {items} {building.outputItem?.replace(/_/g, ' ') || 'Items'}
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs text-stone-500 block">Current Focus</span>
                            <span className="text-2xl font-mono text-amber-500">{building.focusCoinPct}% Coin</span>
                        </div>
                    </div>

                    {/* Slider Control */}
                    <div className="pt-2">
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="20"
                            value={building.focusCoinPct}
                            onChange={(e) => onSetFocus(parseInt(e.target.value))}
                            className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                        <div className="flex justify-between text-[10px] text-stone-500 uppercase mt-2 font-bold tracking-widest">
                            <span>100% Goods</span>
                            <span>100% Coin</span>
                        </div>
                    </div>

                </div>

            </div>
        </div>,
        document.body
    )
}
