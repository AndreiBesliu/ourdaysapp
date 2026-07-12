import { useEffect, useState } from 'react'
import type { GameStateShape } from '../../state/useGameState'
import type { Difficulty } from '../../logic/combat/types'
import { combatantById, legalTargets, forecastAttack } from '../../logic/combat/engine'
import Card from '../common/Card'
import BattleGrid from '../campaign/BattleGrid'
import BattleLog from '../campaign/BattleLog'
import MissionList from '../campaign/MissionList'
import DeployPanel from '../campaign/DeployPanel'
import ResultScreen from '../campaign/ResultScreen'

export default function CampaignTab({ state }: { state: GameStateShape }) {
  const { campaign } = state
  const battle = campaign.battle
  const [mode, setMode] = useState<'MENU' | 'DEPLOY'>('MENU')
  const [pendingDifficulty, setPendingDifficulty] = useState<Difficulty | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Enemy turn resolves deterministically in one step (AI plans, engine applies).
  const side = battle?.side
  const status = battle?.status
  useEffect(() => {
    if (battle && status === 'ONGOING' && side === 'ENEMY') {
      const id = setTimeout(() => state.runEnemyTurn(), 550)
      return () => clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, status])

  // Drop a stale selection when it's no longer the player's to command (or it died —
  // destroyed combatants stay in the array with hp 0 to preserve their kill stats).
  useEffect(() => {
    if (!battle || battle.side !== 'PLAYER' || battle.status !== 'ONGOING') { setSelectedId(null); return }
    if (selectedId) {
      const c = combatantById(battle, selectedId)
      if (!c || c.hp <= 0) setSelectedId(null)
    }
  }, [battle, selectedId])

  // ---- Active battle ----
  if (battle) {
    const canControl = battle.side === 'PLAYER' && battle.status === 'ONGOING'
    const over = battle.status !== 'ONGOING'
    const sel = selectedId ? combatantById(battle, selectedId) : null
    const playerCount = battle.combatants.filter((c) => c.side === 'PLAYER' && c.hp > 0).length
    const enemyCount = battle.combatants.filter((c) => c.side === 'ENEMY' && c.hp > 0).length

    return (
      <Card title={`Battle — ${state.MISSION_PRESETS[battle.difficulty].name}`} className="relative">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className={`px-2 py-1 rounded text-sm font-semibold ${battle.side === 'PLAYER' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
            {over ? 'Battle over' : battle.side === 'PLAYER' ? 'Your turn' : 'Enemy turn…'}
          </span>
          <span className="text-sm text-stone-600 font-mono">Turn {battle.turn}</span>
          <span className="text-sm text-blue-700 font-mono">🛡 {playerCount}</span>
          <span className="text-sm text-red-700 font-mono">⚔ {enemyCount}</span>
          <div className="ml-auto flex gap-2">
            {!over && (
              <>
                <button
                  onClick={() => { state.battleCommand({ kind: 'END_TURN' }); setSelectedId(null) }}
                  disabled={!canControl}
                  className={`px-3 py-1 rounded text-white ${canControl ? 'bg-black hover:bg-stone-800' : 'bg-stone-300 cursor-not-allowed'}`}
                >
                  End turn ▶
                </button>
                <button onClick={() => { if (confirm('Retreat? Casualties taken so far are permanent and this counts as a loss.')) state.abandonBattle() }} className="px-3 py-1 rounded border border-red-300 text-red-700">
                  Retreat
                </button>
              </>
            )}
            {over && (
              <button onClick={() => { state.finishBattle(); setSelectedId(null) }} className="px-4 py-1 rounded bg-green-700 text-white hover:bg-green-800">
                Collect result →
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="overflow-auto">
            <BattleGrid
              battle={battle}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={(x, y) => selectedId && state.battleCommand({ kind: 'MOVE', id: selectedId, to: { x, y } })}
              onAttack={(targetId) => selectedId && state.battleCommand({ kind: 'ATTACK', id: selectedId, targetId })}
            />
          </div>

          <div className="w-56 space-y-3">
            <div className="border rounded-lg p-3 bg-white min-h-[92px]">
              {sel ? (
                <div className="space-y-1">
                  <div className="font-semibold text-sm">{sel.name}</div>
                  <div className="text-xs font-mono text-stone-600">{sel.hp}/{sel.hpStart} soldiers</div>
                  <div className="text-xs font-mono text-stone-600">morale {Math.round(sel.morale)}</div>
                  <div className="text-xs text-stone-500">
                    {sel.hasMoved ? '● moved' : '○ can move'} · {sel.hasActed ? '● acted' : '○ can attack'}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-stone-500">
                  {canControl ? 'Select one of your units (blue), then click a green tile to move or a highlighted enemy to attack.' : 'Waiting for the enemy…'}
                </div>
              )}
            </div>

            {/* Attack forecast: mean-variance preview for every legal target of the selection */}
            {sel && canControl && !sel.hasActed && (() => {
              const forecasts = legalTargets(battle, sel.id)
                .map((tid) => forecastAttack(battle, sel.id, tid))
                .filter((f): f is NonNullable<typeof f> => !!f)
              if (forecasts.length === 0) return null
              return (
                <div className="border rounded-lg p-3 bg-red-50/60">
                  <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">Attack forecast</div>
                  <div className="space-y-1">
                    {forecasts.map((f) => (
                      <button
                        key={f.targetId}
                        onClick={() => state.battleCommand({ kind: 'ATTACK', id: sel.id, targetId: f.targetId })}
                        className="w-full text-left text-xs border rounded px-2 py-1 bg-white hover:bg-red-100 transition-colors"
                        title={f.melee ? 'Melee attack (may take retaliation)' : 'Ranged attack (no retaliation)'}
                      >
                        <span className="font-semibold">{f.targetName}</span>{' '}
                        <span className="text-red-700 font-mono">~{f.kills} kills{f.lethal ? ' ☠' : ''}</span>
                        {f.melee && f.retalKills > 0 && (
                          <span className="text-stone-500 font-mono"> / lose ~{f.retalKills}</span>
                        )}
                        {!f.melee && <span className="text-stone-400"> (ranged)</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}
            <div className="border rounded-lg p-3 bg-stone-50">
              <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">Battle log</div>
              <BattleLog battle={battle} />
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // ---- Result screen ----
  if (campaign.lastResult) {
    return (
      <Card title="Campaign">
        <ResultScreen
          result={campaign.lastResult}
          record={campaign.record}
          onDismiss={() => { state.dismissBattleResult(); setMode('MENU'); setPendingDifficulty(null) }}
        />
      </Card>
    )
  }

  // ---- Pre-battle (mission select / deploy) ----
  return (
    <Card title="Campaign">
      {mode === 'MENU' && (
        <MissionList
          presets={state.MISSION_PRESETS}
          difficulties={state.DIFFICULTIES}
          record={campaign.record}
          streak={campaign.streak ?? 0}
          clears={campaign.clears ?? {}}
          canFightToday={campaign.lastBattleDay !== state.day}
          onPick={(d) => { setPendingDifficulty(d); setMode('DEPLOY') }}
        />
      )}
      {mode === 'DEPLOY' && pendingDifficulty && (
        <DeployPanel
          units={state.units}
          difficulty={pendingDifficulty}
          preset={state.MISSION_PRESETS[pendingDifficulty]}
          clears={campaign.clears?.[pendingDifficulty] ?? 0}
          onConfirm={(ids) => { state.startBattle(ids, pendingDifficulty); setMode('MENU'); setPendingDifficulty(null) }}
          onBack={() => { setMode('MENU'); setPendingDifficulty(null) }}
        />
      )}
    </Card>
  )
}
