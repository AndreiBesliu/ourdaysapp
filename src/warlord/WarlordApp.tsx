// src/App.tsx
import { useEffect, useState } from 'react'
import BuildingsTab from './components/tabs/BuildingsTab'
import ResourcesTab from './components/tabs/ResourcesTab'
import MarketTab from './components/tabs/MarketTab'
import OverviewTab from './components/tabs/OverviewTab'
import UnitsTab from './components/tabs/UnitsTab'
import LogTab from './components/tabs/LogTab'
import CampaignTab from './components/tabs/CampaignTab'

import BarracksTab from './components/tabs/BarracksTab'
import { useGameState } from './state/useGameState'

import { fmtCopper as fmtCopperUtil } from './logic/types'

// saveKey scopes ALL persistence (game save + tick timers). The OurDaysApp embed passes
// a per-user key (warlord_save_<uid>) so users on one device don't share saves, and may
// pass initialBlob/onPersist to back the save with the cloud instead of localStorage.
export default function App({
  saveKey = 'warlord_save',
  initialBlob,
  onPersist,
}: {
  saveKey?: string
  initialBlob?: any
  onPersist?: (blob: any) => void
}) {
  const state = useGameState(saveKey, { initialBlob, onPersist })

  // ---- auto day-tick every 5 minutes ----
  const TICK_MS = 5 * 60 * 1000; // 5 min

  // persisted auto/pause and next-tick target
  const [autoTick, setAutoTick] = useState<boolean>(() => {
    const v = localStorage.getItem(`${saveKey}:autoTick`);
    return v ? v === 'true' : true; // default ON
  });
  const [nextTickAt, setNextTickAt] = useState<number>(() => {
    const v = localStorage.getItem(`${saveKey}:nextTickAt`);
    // start a new 5-min window if missing or in the past
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) && n > Date.now() ? n : Date.now() + TICK_MS;
  });
  const [remaining, setRemaining] = useState<number>(nextTickAt - Date.now());

  // keep localStorage in sync
  useEffect(() => {
    localStorage.setItem(`${saveKey}:autoTick`, String(autoTick));
  }, [saveKey, autoTick]);
  useEffect(() => {
    localStorage.setItem(`${saveKey}:nextTickAt`, String(nextTickAt));
  }, [saveKey, nextTickAt]);

  // 1s heartbeat to update countdown and fire daily ticks
  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      const now = Date.now();
      const left = nextTickAt - now;
      if (left <= 0) {
        // fire a tick and schedule the next window
        state.runDailyTick();
        const next = now + TICK_MS;
        setNextTickAt(next);
        setRemaining(next - now);
      } else {
        setRemaining(left);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [autoTick, nextTickAt, state]);

  // manual “run now” also resets the 5-min window
  function runDayNow() {
    state.runDailyTick();
    const next = Date.now() + TICK_MS;
    setNextTickAt(next);
    setRemaining(next - Date.now());
  }

  // util for header display
  function mmss(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  const {
    day, wallet,
    fmtCopper: fmtFromState,
    loadSave, resetAll,
  } = state

  const fmtCopper = fmtFromState || fmtCopperUtil

  const [tab, setTab] = useState<'overview' | 'resources' | 'buildings' | 'barracks' | 'units' | 'market' | 'campaign' | 'log'>('overview')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex gap-2 items-center">
        <h1 className="text-3xl font-bold">Warlord</h1>
        <div className="ml-auto flex gap-2">
          <div className="ml-4 flex items-center gap-3">
            <span className="text-lg">Day:</span>
            <span className="px-2 py-1 bg-gray-100 rounded font-mono">{day}</span>
          </div>
          <button className="px-3 py-2 border rounded" onClick={loadSave}>Load</button>
          <button className="px-3 py-2 border rounded" onClick={resetAll}>Reset</button>
          <div className="ml-auto flex gap-2 items-center">
            <div className="text-sm text-gray-600">
              Next day in <span className="font-mono">{mmss(remaining)}</span>
            </div>
            <button
              className="px-3 py-2 border rounded"
              onClick={() => setAutoTick(a => !a)}
            >
              {autoTick ? 'Pause Auto' : 'Resume Auto'}
            </button>
            <button
              className="px-3 py-2 bg-black text-white rounded"
              onClick={runDayNow}
            >
              Run Day ▶
            </button>
          </div>

        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <span className="text-lg">Wallet:</span>
        <span className="px-2 py-1 bg-gray-100 rounded font-mono">{fmtCopper(wallet)}</span>
      </div>

      <nav className="flex flex-wrap gap-2">
        {[
          ['overview', 'Overview'],
          ['resources', 'Resources'],
          ['buildings', 'Buildings'],
          ['barracks', 'Barracks'],
          ['units', 'Units'],
          ['market', 'Market'],
          ['campaign', 'Campaign'],
          ['log', 'Log']
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k as any)}
            className={`px-3 py-1 rounded border ${tab === k ? 'bg-black text-white' : 'bg-white'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab state={state} />}

      {tab === 'resources' && <ResourcesTab resources={state.resources} />}

      {tab === 'buildings' && <BuildingsTab state={state} setTab={setTab as any} />}

      {tab === 'barracks' && <BarracksTab state={state} />}

      {tab === 'units' && <UnitsTab state={state} />}

      {tab === 'market' && <MarketTab state={state} />}

      {tab === 'campaign' && <CampaignTab state={state} />}

      {tab === 'log' && <LogTab state={state} />}

    </div>
  )
}
