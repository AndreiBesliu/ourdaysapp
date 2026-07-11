import { useState } from 'react'
import Card from '../common/Card'
import MissingEquipment from '../units/MissingEquipment'
import SplitMergeControls from '../units/SplitMergeControls'
import type { GameStateShape } from '../../state/useGameState'
import CreateUnitForm from '../barracks/CreateUnitForm'
import { type Unit } from '../../logic/types'
import armyCampScene from '../../assets/army_camp_scene.png'

type ViewMode = 'SCENE' | 'FORMATION' | 'INSPECTION'

export default function UnitsTab({ state }: { state: GameStateShape }) {
  const [view, setView] = useState<ViewMode>('SCENE')

  const {
    units = [],
    mergePick = [],
    computeReady,
    doSplit,
    togglePickForMerge,
    doMergeIfReady,
    toggleTraining,
    createUnit,
    inv,
    barracks
  } = state as any

  const safeComputeReady = (computeReady ?? ((_u: Unit) => 0)) as (u: Unit) => number
  const safeDoSplit = (doSplit ?? (() => { })) as (id: string, n: number) => void
  const safeTogglePick = (togglePickForMerge ?? (() => { })) as (id: string) => void
  const safeDoMerge = (doMergeIfReady ?? (() => { })) as () => void
  const safeToggleTraining = (toggleTraining ?? (() => { })) as (id: string) => void

  // Wrapper for sub-views
  const BackBtn = () => (
    <button
      onClick={() => setView('SCENE')}
      className="mb-4 text-sm text-blue-600 hover:underline flex items-center gap-1"
    >
      ← Back to Army Camp
    </button>
  )

  if (view === 'SCENE') {
    return (
      <Card title="Army Camp" className="relative p-0 overflow-hidden select-none">
        <div className="relative w-full aspect-[2/1] bg-gray-900 overflow-hidden">
          <img src={armyCampScene} className="w-full h-full object-cover" alt="Army Camp" draggable={false} />

          {/* CLICK ZONES */}

          {/* 1. Commander's Tent (Formation) - Center/Right Foreground (Red/Blue Tent) */}
          <div
            className="absolute bottom-[5%] left-[45%] w-[45%] h-[65%] cursor-pointer group hover:bg-white/10 rounded-xl transition-all border-2 border-transparent hover:border-yellow-400/50"
            onClick={() => setView('FORMATION')}
            title="Commander's Tent (Formation)"
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Formation (Assign Units) ⛺
            </div>
          </div>

          {/* 2. Encampment (Inspection) - Background/Left Field */}
          <div
            className="absolute top-[20%] left-[5%] w-[50%] h-[50%] cursor-pointer group hover:bg-white/10 rounded-xl transition-all border-2 border-transparent hover:border-blue-400/50"
            onClick={() => setView('INSPECTION')}
            title="Encampment (Inspection)"
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Inspection (Manage Army) 🛡️
            </div>
          </div>

          {/* HUD Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-2 flex justify-between text-xs px-4">
            <span>Active Units: {units.length}</span>
          </div>
        </div>
        <div className="p-4 text-sm text-gray-500 text-center">
          Visit the <b>Commander's Tent</b> (Big Tent) to form units or the <b>Encampment</b> (Field) to inspect them.
        </div>
      </Card>
    )
  }

  if (view === 'FORMATION') {
    return (
      <Card title="Unit Formation (Commander's Tent)">
        <BackBtn />
        <div className="p-2">
          <div className="mb-4 text-sm text-gray-600">
            Assign unassigned soldiers from the Barracks pool to form new combat units.
          </div>
          <CreateUnitForm
            barracks={barracks}
            inv={inv}
            onCreate={createUnit}
          />
        </div>
      </Card>
    )
  }

  if (view === 'INSPECTION') {
    return (
      <Card title="Army Inspection (Encampment)">
        <BackBtn />

        <div className="mb-4 flex items-center gap-2 text-sm bg-gray-50 p-2 rounded border">
          <span className="font-semibold text-gray-700">Merge Operations:</span>
          <span className="px-2 py-0.5 bg-white border rounded text-xs font-mono">
            {Array.isArray(mergePick) && mergePick.length ? mergePick.join(' + ') : 'None selected'}
          </span>
          <button
            className="ml-auto px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 disabled:bg-gray-400 text-xs shadow-sm hover:bg-blue-700 transition"
            disabled={!Array.isArray(mergePick) || mergePick.length !== 2}
            onClick={safeDoMerge}
          >
            Merge Selected
          </button>
        </div>

        {(!Array.isArray(units) || units.length === 0) && (
          <div className="text-center p-8 text-gray-400 bg-gray-50 rounded italic border border-dashed">
            The encampment is empty. Go to the Commander's Tent to form units.
          </div>
        )}

        <div className="space-y-4">
          {Array.isArray(units) && units.map((u: Unit) => {
            const size = u.buckets.reduce((a, b) => a + b.count, 0)
            const isTraining = !!u.training
            return (
              <div key={u.id} className={`border rounded p-3 bg-white shadow-sm transition-all ${isTraining ? 'ring-2 ring-yellow-400/50' : ''}`}>
                <div className="flex items-center gap-3 border-b pb-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${isTraining ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} title={isTraining ? "Training" : "Ready"} />
                  <div className="font-bold text-lg text-gray-800">{u.id}</div>
                  <div className="text-sm px-2 py-0.5 bg-gray-100 rounded text-gray-600 font-medium">{u.type}</div>
                  <div className="ml-auto text-xs text-gray-500">Avg XP: <span className="font-mono text-black">{u.avgXP.toFixed(1)}</span></div>
                </div>

                <div className="grid grid-cols-5 gap-2 mt-2 text-sm">
                  {u.buckets.map((b) => (
                    <div key={b.r} className="p-2 bg-gray-50 rounded border border-gray-100 flex flex-col items-center">
                      <div className="text-[10px] uppercase font-bold text-gray-400">{b.r}</div>
                      <div className="font-mono text-lg font-bold text-gray-700">{b.count}</div>
                      <div className="text-[10px] text-gray-400">XP {b.avgXP.toFixed(0)}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between bg-slate-50 p-2 rounded text-xs text-gray-600">
                  <div>Ready: <span className="font-bold text-gray-900">{safeComputeReady(u)}</span> / {size}</div>
                  <MissingEquipment unit={u} />
                </div>

                <div className="mt-3 flex items-center gap-4 border-t pt-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <div className={`w-5 h-5 border rounded flex items-center justify-center transition-colors ${isTraining ? 'bg-yellow-500 border-yellow-600' : 'bg-white border-gray-300 group-hover:border-gray-400'}`}>
                      {isTraining && <span className="text-white text-xs">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={isTraining}
                      onChange={() => safeToggleTraining(u.id)}
                    />
                    <span className={`text-sm font-medium ${isTraining ? 'text-yellow-700' : 'text-gray-600'}`}>Training Mode (XP++)</span>
                  </label>

                  <div className="ml-auto w-full max-w-[50%]">
                    <SplitMergeControls
                      size={size}
                      onSplit={(n) => safeDoSplit(u.id, n)}
                      selectedForMerge={Array.isArray(mergePick) && mergePick.includes(u.id)}
                      onToggleMergeSelect={() => safeTogglePick(u.id)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    )
  }

  return null
}