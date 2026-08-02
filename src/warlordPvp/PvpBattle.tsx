// Live PvP battle view — OurDaysApp-only. Renders the shared BattleState with the
// synced game components; every command goes to the server callable (the single
// authority). The local applyCommand is used ONLY for optimistic display and is
// discarded as soon as the authoritative snapshot arrives (identical by determinism).
import { useEffect, useState } from 'react';
import type { BattleState, Side, Command } from '@warlord/logic/combat/types';
import { applyCommand, combatantById, legalTargets, forecastAttack } from '@warlord/logic/combat/engine';
import { applyBattleResult, type BattleOutcome } from '@warlord/logic/combat/army';
import BattleGrid from '@warlord/components/campaign/BattleGrid';
import BattleLog from '@warlord/components/campaign/BattleLog';
import GameIcon from '@warlord/components/common/GameIcon';
import { getIconForGameItem } from '@warlord/logic/iconHelpers';
import { submitWarlordCommand, forfeitWarlordBattle, claimWarlordTimeout } from '../serverActions';
import {
  type WarlordGameDoc, readLocalArmy, writeLocalArmy, hasAppliedBattle, markBattleApplied,
  WARLORD_TURN_TIMEOUT_HOURS,
} from './pvpApi';

interface Props {
  game: WarlordGameDoc;
  myUid: string;
  names: Record<string, string>;
  onBack: () => void;
}

export default function PvpBattle({ game, myUid, names, onBack }: Props) {
  const mySide: Side = game.players[0] === myUid ? 'PLAYER' : 'ENEMY';
  const oppUid = game.players[0] === myUid ? game.players[1] : game.players[0];

  const [optimistic, setOptimistic] = useState<BattleState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The authoritative snapshot always wins; optimistic is only a latency mask.
  // Keyed on turn/side/rngCursor rather than object identity: onSnapshot rebuilds a new
  // object on EVERY emission (including unrelated battles in the same query), which would
  // otherwise throw away a pending optimistic move and make the board flicker backwards.
  const stateStamp = game.state
    ? `${game.state.turn}:${game.state.side}:${game.state.rngCursor}:${game.state.status}`
    : 'none';
  useEffect(() => { setOptimistic(null); }, [stateStamp]);

  const battle = optimistic ?? game.state;

  // Drop a stale/dead selection.
  useEffect(() => {
    if (!battle || battle.side !== mySide || battle.status !== 'ONGOING') { setSelectedId(null); return; }
    if (selectedId) {
      const c = combatantById(battle, selectedId);
      if (!c || c.hp <= 0) setSelectedId(null);
    }
  }, [battle, selectedId, mySide]);

  // ── Casualty write-back (real losses), idempotent per (uid, gameId) ──
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [writeBackNote, setWriteBackNote] = useState<string | null>(null);
  useEffect(() => {
    if (game.status !== 'finished' || !game.state) return;
    const myDeploy = game.deploy?.[myUid];
    if (!myDeploy?.unitIds?.length) return;
    const localUnits = readLocalArmy(myUid);
    const result = applyBattleResult(localUnits, game.state, myDeploy.unitIds, mySide);
    setOutcome(result);
    if (hasAppliedBattle(myUid, game.id)) {
      setWriteBackNote('Casualties already applied to your army.');
      return;
    }
    if (localUnits.length === 0) {
      setWriteBackNote('No local army found on this device — casualties not applied here.');
      return;
    }
    const ok = writeLocalArmy(myUid, result.units);
    markBattleApplied(myUid, game.id);
    setWriteBackNote(ok ? 'Casualties applied to your army.' : 'Could not update the local save.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status, game.id]);

  async function send(cmd: Command) {
    if (!game.state || busy) return;
    setError(null);
    // Optimistic: render the deterministic local result instantly...
    setOptimistic(applyCommand(optimistic ?? game.state, cmd));
    setBusy(true);
    try {
      const res = await submitWarlordCommand({ gameId: game.id, command: cmd });
      if (!res.applied) {
        setOptimistic(null); // engine rejected it — roll back, resync from doc
      }
    } catch (e: any) {
      setOptimistic(null);
      setError(e?.message || 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  if (!battle) return null;
  const over = game.status === 'finished';
  const myTurn = battle.side === mySide && battle.status === 'ONGOING' && !over;
  const sel = selectedId ? combatantById(battle, selectedId) : null;
  const count = (side: Side) => battle.combatants.filter((c) => c.side === side && c.hp > 0).length;
  const myName = names[myUid] || 'You';
  const oppName = names[oppUid] || 'Opponent';
  const iAmBlue = mySide === 'PLAYER';
  // Hours since the opponent's last move (the server re-checks before granting a claim).
  const lastMoveMs = game.lastMoveAt?.toMillis?.() ?? 0;
  const stalledHours = lastMoveMs ? (Date.now() - lastMoveMs) / 3600000 : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="px-3 py-1 border rounded text-sm">← Battles</button>
        <span className="text-sm">
          <span className="text-blue-700 font-semibold">{iAmBlue ? myName : oppName}</span>
          <span className="text-stone-400"> vs </span>
          <span className="text-red-700 font-semibold">{iAmBlue ? oppName : myName}</span>
        </span>
        <span className={`px-2 py-1 rounded text-sm font-semibold ${over ? 'bg-stone-200 text-stone-700' : myTurn ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
          {over ? 'Battle over' : myTurn ? 'Your turn' : `Waiting for ${oppName}…`}
        </span>
        <span className="text-sm text-stone-600 font-mono">Turn {battle.turn}</span>
        <span className="text-sm text-blue-700 font-mono">🛡 {count('PLAYER')}</span>
        <span className="text-sm text-red-700 font-mono">⚔ {count('ENEMY')}</span>
        <div className="ml-auto flex gap-2">
          {!over && !myTurn && stalledHours >= WARLORD_TURN_TIMEOUT_HOURS && (
            // The opponent stopped playing. Without this the battle never ends and the
            // units staked in it stay locked out of every new deployment.
            <button
              onClick={() => claimWarlordTimeout(game.id).catch((e) => setError(e?.message || 'Failed'))}
              className="px-3 py-1 rounded bg-green-700 text-white hover:bg-green-800"
              title={`No move for over ${WARLORD_TURN_TIMEOUT_HOURS}h`}
            >
              Claim victory ⏱
            </button>
          )}
          {!over && (
            <>
              <button
                onClick={() => { send({ kind: 'END_TURN' }); setSelectedId(null); }}
                disabled={!myTurn || busy}
                className={`px-3 py-1 rounded text-white ${myTurn && !busy ? 'bg-black hover:bg-stone-800' : 'bg-stone-300 cursor-not-allowed'}`}
              >
                End turn ▶
              </button>
              <button
                onClick={() => { if (confirm('Retreat? This counts as a loss and your casualties are permanent.')) forfeitWarlordBattle(game.id).catch((e) => setError(e?.message || 'Failed')); }}
                className="px-3 py-1 rounded border border-red-300 text-red-700"
              >
                Retreat
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1">{error}</div>}

      {over && (
        <div className={`rounded-lg border p-3 ${game.winner === myUid ? 'bg-green-50 border-green-300' : game.winner ? 'bg-red-50 border-red-300' : 'bg-stone-50'}`}>
          <div className="font-serif text-xl font-bold">
            {game.winner === myUid ? '🏆 Victory!' : game.winner ? '💀 Defeat' : '🤝 Draw'}
            {game.forfeitedBy && <span className="text-sm font-normal text-stone-500"> (by retreat)</span>}
            {game.timedOutBy && <span className="text-sm font-normal text-stone-500"> (opponent timed out)</span>}
          </div>
          {writeBackNote && <div className="text-xs text-stone-600 mt-1">{writeBackNote}</div>}
          {outcome && outcome.report.length > 0 && (
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="text-stone-400">
                  <th className="text-left px-2 py-1 font-normal">Your unit</th>
                  <th className="text-right px-2 py-1 font-normal">Fielded</th>
                  <th className="text-right px-2 py-1 font-normal">Lost</th>
                  <th className="text-right px-2 py-1 font-normal">XP</th>
                </tr>
              </thead>
              <tbody>
                {outcome.report.map((r) => (
                  <tr key={r.unitId} className={`border-t border-stone-100 ${r.destroyed ? 'text-red-700' : ''}`}>
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-1">
                        <GameIcon name={getIconForGameItem(r.type) || 'sword'} size={14} />
                        {r.name}{r.destroyed && ' 💀'}
                        {r.promotions.map((p, i) => (
                          <span key={i} className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 border border-amber-300">⬆ {p.to}</span>
                        ))}
                      </span>
                    </td>
                    <td className="text-right px-2 py-1 font-mono">{r.fielded}</td>
                    <td className="text-right px-2 py-1 font-mono">{r.lost > 0 ? `-${r.lost}` : '—'}</td>
                    <td className="text-right px-2 py-1 font-mono">{r.xpGain > 0 ? `+${r.xpGain}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="overflow-auto">
          <BattleGrid
            battle={battle}
            controlSide={mySide}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(x, y) => selectedId && send({ kind: 'MOVE', id: selectedId, to: { x, y } })}
            onAttack={(targetId) => selectedId && send({ kind: 'ATTACK', id: selectedId, targetId })}
          />
          <div className="text-xs text-stone-500 mt-1">
            You command the {iAmBlue ? 'blue' : 'red'} units.
          </div>
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
                {myTurn ? 'Select one of your units, then click a green tile to move or a highlighted enemy to attack.' : over ? 'The battle has ended.' : 'Waiting for the enemy…'}
              </div>
            )}
          </div>

          {sel && myTurn && !sel.hasActed && (() => {
            const forecasts = legalTargets(battle, sel.id)
              .map((tid) => forecastAttack(battle, sel.id, tid))
              .filter((f): f is NonNullable<typeof f> => !!f);
            if (forecasts.length === 0) return null;
            return (
              <div className="border rounded-lg p-3 bg-red-50/60">
                <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">Attack forecast</div>
                <div className="space-y-1">
                  {forecasts.map((f) => (
                    <button
                      key={f.targetId}
                      onClick={() => send({ kind: 'ATTACK', id: sel.id, targetId: f.targetId })}
                      className="w-full text-left text-xs border rounded px-2 py-1 bg-white hover:bg-red-100 transition-colors"
                    >
                      <span className="font-semibold">{f.targetName}</span>{' '}
                      <span className="text-red-700 font-mono">~{f.kills} kills{f.lethal ? ' ☠' : ''}</span>
                      {f.melee && f.retalKills > 0 && <span className="text-stone-500 font-mono"> / lose ~{f.retalKills}</span>}
                      {!f.melee && <span className="text-stone-400"> (ranged)</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="border rounded-lg p-3 bg-stone-50">
            <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">Battle log</div>
            <BattleLog battle={battle} />
          </div>
        </div>
      </div>
    </div>
  );
}
