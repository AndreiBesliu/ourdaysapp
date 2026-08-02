// src/App.tsx
import { useEffect, useRef, useState } from 'react'
import BuildingsTab from './components/tabs/BuildingsTab'
import ResourcesTab from './components/tabs/ResourcesTab'
import MarketTab from './components/tabs/MarketTab'
import OverviewTab from './components/tabs/OverviewTab'
import UnitsTab from './components/tabs/UnitsTab'
import LogTab from './components/tabs/LogTab'
import CampaignTab from './components/tabs/CampaignTab'
import ResearchTab from './components/tabs/ResearchTab'

import BarracksTab from './components/tabs/BarracksTab'
import ResourceBar from './components/common/ResourceBar'
import { useGameState } from './state/useGameState'
import { GameConfig } from './logic/config'
import { planTicks, mmss, humanDuration } from './logic/tick'
import type { GameConfigOverrides } from './logic/config'


// saveKey scopes ALL persistence (game save + tick timers). The OurDaysApp embed passes
// a per-user key (warlord_save_<uid>) so users on one device don't share saves, and may
// pass initialBlob/onPersist to back the save with the cloud instead of localStorage.
export default function App({
  saveKey = 'warlord_save',
  initialBlob,
  onPersist,
  config,
}: {
  saveKey?: string
  initialBlob?: any
  onPersist?: (blob: any) => void
  config?: GameConfigOverrides | null // admin-tuned balance (absent = built-in defaults)
}) {
  const state = useGameState(saveKey, { initialBlob, onPersist, config })

  // ---- day clock ----
  // Every day is derived from `state.lastTickAt` (the timestamp of the last completed
  // day, stored IN THE SAVE). Nothing is scheduled against an in-memory deadline any
  // more: closing the app used to discard the elapsed window and restart the countdown,
  // so time spent away credited zero days and short visits never advanced a day at all.
  const TICK_MS = GameConfig.tickMs();
  const MAX_OFFLINE_DAYS = GameConfig.tick().maxOfflineDays;

  const [autoTick, setAutoTick] = useState<boolean>(() => {
    const v = localStorage.getItem(`${saveKey}:autoTick`);
    return v ? v === 'true' : true; // default ON
  });
  const [remaining, setRemaining] = useState<number>(
    () => planTicks(Date.now(), state.lastTickAt, TICK_MS, MAX_OFFLINE_DAYS).remainingMs
  );
  // Days still owed to the player, drained one per commit (see below).
  const [pendingDays, setPendingDays] = useState(0);

  useEffect(() => {
    localStorage.setItem(`${saveKey}:autoTick`, String(autoTick));
  }, [saveKey, autoTick]);

  // The heartbeat reads the game through a ref so the interval is installed ONCE.
  // `state` is a fresh object every render, so keeping it in the dependency array
  // tore down and re-created the interval on every single render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef(pendingDays);
  pendingRef.current = pendingDays;
  // The anchor a backlog was last planned from. Guards against crediting the same
  // absence twice when the effect runs more than once for one mount (StrictMode).
  const plannedFromRef = useRef(0);

  useEffect(() => {
    if (!autoTick) return;

    const check = () => {
      const g = stateRef.current;
      const plan = planTicks(Date.now(), g.lastTickAt, TICK_MS, MAX_OFFLINE_DAYS);
      setRemaining(plan.remainingMs);
      if (pendingRef.current > 0) return; // a drain is in flight — never touch the anchor
      if (plan.grant <= 0) {
        // A clock that ran backwards (device time change, sleep/resume) leaves the
        // anchor in the future; rebase it so the countdown can't stick at a nonsense value.
        if (plan.anchor !== g.lastTickAt) g.setLastTickAt(plan.anchor);
        return;
      }
      if (plan.anchor === plannedFromRef.current) return; // already planned this window
      plannedFromRef.current = plan.anchor;
      if (plan.due > 1) {
        const away = humanDuration(plan.due * TICK_MS);
        g.addLog(
          plan.forfeited > 0
            ? `⏳ Away ${away} — resolving ${plan.grant} days (${plan.forfeited} beyond the ${MAX_OFFLINE_DAYS}-day catch-up limit were skipped).`
            : `⏳ Away ${away} — resolving ${plan.grant} days.`
        );
      }
      // Rewind the anchor so the days about to run land it exactly on now-minus-remainder.
      g.setLastTickAt(plan.anchor);
      setPendingDays(plan.grant);
    };

    check(); // credit an absence immediately on mount, before the first interval fires
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [autoTick, TICK_MS, MAX_OFFLINE_DAYS]);

  // Drain the backlog ONE DAY PER COMMIT. runDailyTick reads the render snapshot
  // (`const nextDay = day + 1`, `for (const u of unit.units)`, ...), so calling it N
  // times in a row from one closure would compute every day from the same stale state
  // and advance the day by exactly 1.
  useEffect(() => {
    if (pendingDays <= 0) return;
    state.runDailyTick();
    setPendingDays(n => n - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDays]);

  // Manual “run now” also restarts the countdown from this instant.
  function runDayNow() {
    state.runDailyTick(Date.now());
    setRemaining(TICK_MS);
  }

  const {
    day, wallet,
    loadSave, resetAll,
  } = state

  const [tab, setTab] = useState<'overview' | 'resources' | 'buildings' | 'barracks' | 'units' | 'market' | 'research' | 'campaign' | 'log'>('overview')

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

      {/* Stores and what tomorrow does to them — visible from every tab, so a change to a
          building's focus can be judged without hunting through screens. */}
      <ResourceBar
        wallet={wallet}
        resources={state.resources}
        inv={state.inv}
        buildings={state.buildings}
        units={state.units}
        mods={state.mods}
      />

      <nav className="flex flex-wrap gap-2">
        {[
          ['overview', 'Overview'],
          ['resources', 'Resources'],
          ['buildings', 'Buildings'],
          ['barracks', 'Barracks'],
          ['units', 'Units'],
          ['market', 'Market'],
          ...(state.hasResearchBuilding ? [['research', 'Research'] as const] : []),
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

      {tab === 'research' && <ResearchTab state={state} />}

      {tab === 'campaign' && <CampaignTab state={state} />}

      {tab === 'log' && <LogTab state={state} />}

    </div>
  )
}
