import { useState } from 'react'
import Card from '../common/Card'
import RecruitForm from '../barracks/RecruitForm'
import MoneyDisplay from '../common/MoneyDisplay'
import { type SoldierType, } from '../../logic/types'
import type { GameStateShape } from '../../state/useGameState'
import { Registry } from '../../logic/registry'
import GameIcon from '../common/GameIcon'
import { getIconForGameItem } from '../../logic/iconHelpers'
import barracksScene from '../../assets/barracks_scene.png'

type ViewMode = 'SCENE' | 'RECRUIT' | 'TRAINING' | 'MANAGEMENT'

export default function BarracksTab({ state }: { state: GameStateShape }) {
  const [view, setView] = useState<ViewMode>('SCENE')

  // -- Scene View --
  if (view === 'SCENE') {
    return (
      <Card title="Barracks Hub" className="relative p-0 overflow-hidden select-none">

        {/* Main Scene Container */}
        <div className="relative w-full aspect-[2/1] bg-gray-900 overflow-hidden">
          <img src={barracksScene} className="w-full h-full object-cover" alt="Barracks Scene" draggable={false} />

          {/* CLICK ZONES */}
          {/* 1. Training Yard (Left) */}
          <div
            className="absolute top-[20%] left-[5%] w-[35%] h-[60%] cursor-pointer group hover:bg-white/10 rounded-xl transition-all border-2 border-transparent hover:border-yellow-400/50"
            onClick={() => setView('TRAINING')}
            title="Training Yard"
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Training Grounds ⚔️
            </div>
          </div>

          {/* 2. Recruitment Tent (Right) */}
          <div
            className="absolute top-[30%] right-[5%] w-[30%] h-[50%] cursor-pointer group hover:bg-white/10 rounded-xl transition-all border-2 border-transparent hover:border-blue-400/50"
            onClick={() => setView('RECRUIT')}
            title="Recruitment"
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Recruitment Office 📜
            </div>
          </div>

          {/* 3. Headquarters (Top Center) */}
          <div
            className="absolute top-[5%] left-[40%] w-[20%] h-[40%] cursor-pointer group hover:bg-white/10 rounded-xl transition-all border-2 border-transparent hover:border-red-400/50"
            onClick={() => setView('MANAGEMENT')}
            title="Management"
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Headquarters 🏰
            </div>
          </div>

          {/* HUD Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-2 flex justify-between text-xs px-4">
            <span>Level {state.barracksLevel} Barracks</span>
            <span>Active Batches: {state.batches.length}</span>
            <span>Recruits: {state.recruits.count}</span>
          </div>
        </div>

        <div className="p-4 text-sm text-gray-500 text-center">
          Click on an area to enter. Hover for details.
        </div>
      </Card>
    )
  }

  // Wrapper for sub-views
  const BackBtn = () => (
    <button
      onClick={() => setView('SCENE')}
      className="mb-4 text-sm text-blue-600 hover:underline flex items-center gap-1"
    >
      ← Back to Barracks Scene
    </button>
  )

  // -- Sub Views --
  if (view === 'RECRUIT') {
    return (
      <Card title="Recruitment Office">
        <BackBtn />
        <div className="p-2">
          <RecruitForm onRecruit={(qty) => state.recruit(qty)} />
          <div className="mt-4 text-sm text-gray-600">
            Current Untyped Recruits: <span className="font-bold">{state.recruits.count}</span>
          </div>
        </div>
      </Card>
    )
  }

  if (view === 'MANAGEMENT') {
    const { barracksLevel, barracksUpgradeCost, upgradeBarracks, batches, batchSlots, batchDurationDays } = state
    const hasCostFn = typeof barracksUpgradeCost === 'function'
    const nextCost = hasCostFn ? barracksUpgradeCost(barracksLevel) : 0

    return (
      <Card title="Headquarters">
        <BackBtn />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded p-4">
            <h3 className="font-semibold mb-2">Facility Status</h3>
            <div className="text-sm space-y-2">
              <div>Level: <span className="font-bold">{barracksLevel}</span></div>
              <div>Batch Slots: {batchSlots(barracksLevel)}</div>
              <div>Batch Duration: {batchDurationDays(barracksLevel)} days</div>
            </div>
            <div className="mt-4">
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:bg-gray-400 flex items-center gap-2 shadow hover:bg-blue-700 transition"
                disabled={barracksLevel >= 5 || !hasCostFn}
                onClick={upgradeBarracks}
              >
                Upgrade Barracks
                {barracksLevel < 5 && hasCostFn && <span className="text-blue-100 text-xs">(<MoneyDisplay amount={nextCost} size={12} className="inline-flex text-white" />)</span>}
                {barracksLevel >= 5 && <span className="text-blue-100 text-xs">(Max)</span>}
              </button>
            </div>
          </div>

          <div className="border rounded p-4">
            <h3 className="font-semibold mb-2">Active Batches ({batches.length})</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {batches.length === 0 && <div className="text-sm text-gray-500">No active training batches.</div>}
              {batches.map((b: any) => (
                <div key={b.id} className="border rounded p-2 text-sm bg-gray-50">
                  <div className="flex justify-between font-bold">
                    <span>{b.kind}</span>
                    <span className="text-xs font-mono text-gray-400">{b.id.slice(0, 4)}</span>
                  </div>
                  <div>Target: {b.target}{b.fromType ? ` (from ${b.fromType})` : ''}</div>
                  <div>Qty: {b.qty}</div>
                  <div className="text-blue-600 font-semibold">Days remaining: {b.daysRemaining}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    )
  }

  if (view === 'TRAINING') {
    return <TrainingView state={state} onBack={() => setView('SCENE')} />
  }

  return null
}

// Extracted Training View for cleanliness
function TrainingView({ state, onBack }: { state: GameStateShape, onBack: () => void }) {
  const {
    queueLightTraining, queueHeavyConversion, queueLightCavConversion, queueHorseArcherConversion
  } = state

  const [lightType, setLightType] = useState<SoldierType>('LIGHT_INF_SPEAR')
  const [lightQty, setLightQty] = useState(20)
  const [heavySrc, setHeavySrc] = useState<SoldierType>('LIGHT_CAV')
  const [heavyQty, setHeavyQty] = useState(10)
  const [lcSrc, setLcSrc] = useState<SoldierType>('LIGHT_INF_SPEAR')
  const [lcQty, setLcQty] = useState(10)
  const [haQty, setHaQty] = useState(10)

  // Reused Requirement Helper
  const renderReqs = (qty: number, type?: string | undefined, unitId?: string, _isHeavy?: boolean, heavySrcVal?: string) => {
    // Custom logic for conversions OR Registry logic for training
    // If unitId is passed, use Registry
    if (unitId) {
      const def = Registry.getUnit(unitId);
      if (!def || !def.req) return null;
      const { weapons, armors, horses } = def.req;

      const list: { id: string; count: number; name: string }[] = [];
      const add = (rec?: Record<string, number>) => {
        if (rec) Object.entries(rec).forEach(([k, v]) => {
          list.push({ id: k, count: v * qty, name: Registry.getItem(k)?.name || k });
        });
      };
      add(weapons); add(armors); add(horses);

      if (list.length === 0) return <div className="text-xs text-green-600 mt-2">No gear required.</div>;

      return (
        <div className="flex flex-wrap gap-4 mt-2">
          <span className="text-xs text-gray-500 flex items-center">Requires:</span>
          {list.map(item => (
            <div key={item.id} className="flex items-center gap-1 text-xs text-gray-700">
              <GameIcon name={getIconForGameItem(item.id) || 'sword'} size={24} />
              <span className="font-mono">{item.count}</span>
              <span>{item.name}</span>
            </div>
          ))}
        </div>
      );
    }

    // Hardcoded conversions logic from previous step
    if (type === 'LIGHT_CAV') {
      // Light Cav: 1 Light Horse
      return (
        <div className="flex flex-wrap gap-4 mt-2">
          <div className="flex items-center gap-1 text-xs text-gray-700">
            <span className="text-gray-500 mr-1">Requires:</span>
            <GameIcon name="light_horse" size={24} />
            <span className="font-mono">{qty}</span>
            <span>Light Horse</span>
          </div>
        </div>
      )
    }
    if (type === 'HORSE_ARCHER') {
      return (
        <div className="flex flex-wrap gap-4 mt-2">
          <div className="flex items-center gap-1 text-xs text-gray-700">
            <span className="text-gray-500 mr-1">Requires:</span>
            <GameIcon name="light_horse" size={24} />
            <span className="font-mono">{qty}</span>
            <span>Light Horse</span>
          </div>
        </div>
      )
    }
    if (type === 'HEAVY_CAV') {
      return (
        <div className="flex flex-wrap gap-4 mt-2">
          <div className="flex items-center gap-1 text-xs text-gray-700">
            <span className="text-gray-500 mr-1">Requires:</span>
            <div className="flex items-center gap-1">
              <GameIcon name="heavy_horse" size={24} />
              <span className="font-mono">{qty}</span>
              <span>Heavy Horse</span>
            </div>
            <div className="flex items-center gap-1">
              <GameIcon name="horse_armor" size={24} />
              <span className="font-mono">{qty}</span>
              <span>Horse Armor</span>
            </div>
            {heavySrcVal === 'LIGHT_CAV' && (
              <div className="flex items-center gap-1">
                <GameIcon name="heavy_armor" size={24} />
                <span className="font-mono">{qty}</span>
                <span>Heavy Armor</span>
              </div>
            )}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card title="Training Grounds">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-blue-600 hover:underline flex items-center gap-1"
      >
        ← Back to Barracks Scene
      </button>

      <div className="space-y-6">

        {/* Basic Training */}
        <div className="border rounded p-4 bg-white shadow-sm">
          <div className="font-semibold mb-2 text-lg border-b pb-1">Basic Training</div>
          <div className="text-sm text-gray-500 mb-2">Train untyped recruits into specialized light infantry.</div>
          <div className="flex gap-4 items-end flex-wrap">
            <div className="flex flex-col">
              <label className="text-sm font-medium">Target Unit</label>
              <select className="border rounded px-2 py-1 bg-gray-50" value={lightType} onChange={e => setLightType(e.target.value as SoldierType)}>
                {Registry.getAllUnits()
                  .filter(u => u.id.startsWith('LIGHT_INF') || u.id === 'LIGHT_ARCHER')
                  .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium">Quantity</label>
              <input className="border rounded px-2 py-1 w-24 bg-gray-50" type="number" min={1} max={50}
                value={lightQty} onChange={e => setLightQty(Math.max(1, Math.min(50, parseInt(e.target.value || '1'))))} />
            </div>
            <button className="px-4 py-1 bg-green-600 text-white rounded hover:bg-green-700" onClick={() => queueLightTraining(lightType, lightQty)}>
              Train Batch
            </button>
          </div>
          {renderReqs(lightQty, undefined, lightType)}
        </div>

        {/* Conversions Grid */}
        <div className="grid md:grid-cols-2 gap-4">

          {/* Light Cav */}
          <div className="border rounded p-4 bg-white shadow-sm">
            <div className="font-semibold mb-2 border-b pb-1">Light Cavalry Conversion</div>
            <div className="flex gap-2 items-end">
              <div className="flex flex-col grow">
                <label className="text-xs">From (Novice+)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={lcSrc} onChange={e => setLcSrc(e.target.value as SoldierType)}>
                  {(['LIGHT_INF_SWORD', 'LIGHT_INF_SPEAR', 'LIGHT_INF_HALBERD'] as SoldierType[])
                    .map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs">Qty</label>
                <input className="border rounded px-2 py-1 w-16 text-sm" type="number" min={1} max={50}
                  value={lcQty} onChange={e => setLcQty(Math.max(1, Math.min(50, parseInt(e.target.value || '1'))))} />
              </div>
              <button className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 text-sm" onClick={() => queueLightCavConversion(lcSrc, lcQty)}>
                Queue
              </button>
            </div>
            {renderReqs(lcQty, 'LIGHT_CAV')}
          </div>

          {/* Horse Archer */}
          <div className="border rounded p-4 bg-white shadow-sm">
            <div className="font-semibold mb-2 border-b pb-1">Horse Archer Conversion</div>
            <div className="flex gap-2 items-end">
              <div className="flex flex-col grow">
                <div className="text-sm py-1 text-gray-600">From LIGHT_ARCHER (Adv+)</div>
              </div>
              <div className="flex flex-col">
                <label className="text-xs">Qty</label>
                <input className="border rounded px-2 py-1 w-16 text-sm" type="number" min={1} max={50}
                  value={haQty} onChange={e => setHaQty(Math.max(1, Math.min(50, parseInt(e.target.value || '1'))))} />
              </div>
              <button className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 text-sm" onClick={() => queueHorseArcherConversion(haQty)}>
                Queue
              </button>
            </div>
            {renderReqs(haQty, 'HORSE_ARCHER')}
          </div>
        </div>

        {/* Heavy Cav (Full Width) */}
        <div className="border rounded p-4 bg-white shadow-sm">
          <div className="font-semibold mb-2 border-b pb-1">Heavy Cavalry Conversion</div>
          <div className="flex gap-4 items-end flex-wrap">
            <div className="flex flex-col">
              <label className="text-sm">From (Advanced+)</label>
              <select className="border rounded px-2 py-1 text-sm bg-gray-50" value={heavySrc} onChange={e => setHeavySrc(e.target.value as SoldierType)}>
                {(['LIGHT_CAV', 'HEAVY_INF_SWORD', 'HEAVY_INF_SPEAR', 'HEAVY_INF_HALBERD'] as SoldierType[])
                  .map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-sm">Quantity</label>
              <input className="border rounded px-2 py-1 w-20 text-sm bg-gray-50" type="number" min={1} max={50}
                value={heavyQty} onChange={e => setHeavyQty(Math.max(1, Math.min(50, parseInt(e.target.value || '1'))))} />
            </div>
            <button className="px-4 py-1 bg-gray-800 text-white rounded hover:bg-black text-sm" onClick={() => queueHeavyConversion(heavySrc, heavyQty)}>
              Initialize Conversion
            </button>
          </div>
          {renderReqs(heavyQty, 'HEAVY_CAV', undefined, true, heavySrc)}
        </div>

      </div>
    </Card>
  )
}
