import { useState } from 'react'
import Card from '../common/Card'
import MarketPanel from '../common/MarketPanel'
import { Registry } from '../../logic/registry'
import marketBg from '../../assets/market_bg.png'
import stallWeaponBg from '../../assets/stall_weapon.png'
import stallArmorBg from '../../assets/stall_armor.png'
import stallStableBg from '../../assets/stall_stable.png'

type MarketCategory = 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE'

export default function MarketTab({ state }: { state: any }) {
  const { inv, buy, sell, buildings, resources } = state
  const hasStable = buildings?.some((b: any) => b.type === 'STABLE')
  const [selectedCategory, setSelectedCategory] = useState<MarketCategory | null>(null)

  const items = Registry.getAllItems();
  const weapons = items.filter(i => i.type === 'WEAPON');
  const armors = items.filter(i => i.type === 'ARMOR');
  const horses = items.filter(i => i.type === 'HORSE');
  const resourceItems = items.filter(i => i.type === 'RESOURCE');

  // Main Scene View
  if (!selectedCategory) {
    return (
      <Card title="Market Square" className="relative p-0 overflow-hidden bg-stone-900 border-stone-800" titleClassName="text-amber-100 bg-stone-950/80 border-b border-stone-800">
        <div className="aspect-[16/9] relative group cursor-default">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${marketBg})` }}
          />

          {/* Overlay Gradient for depth */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />

          {/* Click Zones - Split into 4 */}
          {/* Resources (Left) */}
          <div
            className="absolute inset-y-0 left-0 w-[25%] hover:bg-white/10 cursor-pointer transition-colors duration-200 group/zone flex flex-col justify-end p-6"
            onClick={() => setSelectedCategory('RESOURCE')}
          >
            <div className="bg-black/80 text-amber-100 px-3 py-1.5 rounded border border-amber-900/50 text-center opacity-0 group-hover/zone:opacity-100 transition-opacity transform translate-y-2 group-hover/zone:translate-y-0 duration-300">
              <div className="font-serif font-bold text-lg">Trade Goods</div>
              <div className="text-xs text-amber-200/70 font-mono">Wood, Stone, Ore</div>
            </div>
          </div>

          {/* Weapon Smith (25-50) */}
          <div
            className="absolute inset-y-0 left-[25%] w-[25%] hover:bg-white/10 cursor-pointer transition-colors duration-200 group/zone flex flex-col justify-end p-6"
            onClick={() => setSelectedCategory('WEAPON')}
          >
            <div className="bg-black/80 text-amber-100 px-3 py-1.5 rounded border border-amber-900/50 text-center opacity-0 group-hover/zone:opacity-100 transition-opacity transform translate-y-2 group-hover/zone:translate-y-0 duration-300">
              <div className="font-serif font-bold text-lg">Weapon Smith</div>
              <div className="text-xs text-amber-200/70 font-mono">Swords, Spears, Halberds</div>
            </div>
          </div>

          {/* Armorer (50-75) */}
          <div
            className="absolute inset-y-0 left-[50%] w-[25%] hover:bg-white/10 cursor-pointer transition-colors duration-200 group/zone flex flex-col justify-end p-6"
            onClick={() => setSelectedCategory('ARMOR')}
          >
            <div className="bg-black/80 text-amber-100 px-3 py-1.5 rounded border border-amber-900/50 text-center opacity-0 group-hover/zone:opacity-100 transition-opacity transform translate-y-2 group-hover/zone:translate-y-0 duration-300">
              <div className="font-serif font-bold text-lg">Armorer</div>
              <div className="text-xs text-amber-200/70 font-mono">Shields, Light & Heavy Armor</div>
            </div>
          </div>

          {/* Stables (Right 25%) */}
          <div
            className="absolute inset-y-0 right-0 w-[25%] hover:bg-white/10 cursor-pointer transition-colors duration-200 group/zone flex flex-col justify-end p-6"
            onClick={() => {
              if (hasStable) setSelectedCategory('HORSE')
            }}
          >
            <div className={`bg-black/80 text-amber-100 px-3 py-1.5 rounded border border-amber-900/50 text-center opacity-0 group-hover/zone:opacity-100 transition-opacity transform translate-y-2 group-hover/zone:translate-y-0 duration-300 ${!hasStable ? 'grayscale' : ''}`}>
              <div className="font-serif font-bold text-lg">{hasStable ? 'Royal Stables' : 'Stables (Closed)'}</div>
              <div className="text-xs text-amber-200/70 font-mono">{hasStable ? 'Purchase Horses' : 'Build Stable to unlock'}</div>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // Detail View
  const close = () => setSelectedCategory(null)

  let panelProps: {
    kind: 'WEAPON' | 'ARMOR' | 'HORSE' | 'RESOURCE',
    title: string,
    options: typeof weapons,
    haveMap: any,
    bg: string
  } = {
    kind: 'WEAPON',
    title: 'Weapon Smith',
    options: weapons,
    haveMap: inv.weapons,
    bg: stallWeaponBg
  }

  if (selectedCategory === 'ARMOR') {
    panelProps = { kind: 'ARMOR', title: 'Armorer', options: armors, haveMap: inv.armors, bg: stallArmorBg }
  } else if (selectedCategory === 'HORSE') {
    panelProps = { kind: 'HORSE', title: 'Royal Stables', options: horses, haveMap: inv.horses, bg: stallStableBg }
  } else if (selectedCategory === 'RESOURCE') {
    // Reuse a background or define a new one ideally
    panelProps = { kind: 'RESOURCE', title: 'Trade Goods', options: resourceItems, haveMap: resources, bg: stallWeaponBg }
  }

  return (
    <Card title={`Market - ${panelProps.title}`} className="relative p-0 overflow-hidden bg-stone-900 border-stone-800" titleClassName="text-amber-100 bg-stone-950/80 border-b border-stone-800">
      <div className="relative min-h-[600px] flex items-center justify-center p-4">
        {/* Detail Background */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-in-out"
          style={{ backgroundImage: `url(${panelProps.bg})` }}
        />
        {/* Blur/Darken Backdrop */}
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[1px]" />

        {/* Framed Panel */}
        <div className="relative z-10 w-full max-w-3xl bg-[#f5f5f0] p-6 rounded-lg shadow-2xl border-2 border-stone-600">
          {/* Custom Header with Close Button */}
          <div className="flex justify-between items-start mb-4 border-b border-stone-300 pb-3">
            <div>
              <h2 className="text-2xl font-serif font-bold text-stone-800">{panelProps.title}</h2>
              <p className="text-sm text-stone-500 italic">Select items to purchase or sell.</p>
            </div>
            <button
              onClick={close}
              className="text-stone-500 hover:text-red-600 transition-colors p-1"
              title="Close Shop"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <MarketPanel
            title=""
            kind={panelProps.kind}
            options={panelProps.options.map(i => ({ k: i.subtype, price: i.price }))}
            have={(k) => {
              if (selectedCategory === 'HORSE') return (panelProps.haveMap as any)[k]?.active ?? 0
              return (panelProps.haveMap as any)[k] ?? 0
            }}
            onBuy={buy}
            onSell={sell}
          />
        </div>
      </div>
    </Card>
  )
}
