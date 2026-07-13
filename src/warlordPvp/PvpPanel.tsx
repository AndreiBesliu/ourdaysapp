// Warlord PvP lobby — OurDaysApp-only. Lists my battles, creates challenges
// (pick group → opponent → deploy units from the local army), accepts incoming
// challenges (pick units → server callable builds the authoritative battle).
import { useEffect, useMemo, useState } from 'react';
import type { Unit } from '../warlord/logic/types';
import { fieldedStrength, prettyName } from '../warlord/logic/combat/army';
import { PVP_MAX_COMBATANTS } from '../warlord/logic/combat/pvp';
import GameIcon from '../warlord/components/common/GameIcon';
import { getIconForGameItem } from '../warlord/logic/iconHelpers';
import { acceptWarlordChallenge } from '../serverActions';
import {
  type WarlordGameDoc, type GroupInfo,
  subscribeMyBattles, subscribeMyGroups, fetchProfileNames,
  createChallenge, cancelChallenge, readLocalArmy, unitToClaim,
} from './pvpApi';
import PvpBattle from './PvpBattle';

// Shared unit-picker used by both the challenge wizard and the accept flow.
function UnitPicker({ units, picked, onToggle }: {
  units: Unit[];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (units.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        You have no formed units on this device. Build your army in the Domain tab first.
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {units.map((u) => {
        const size = u.buckets.reduce((a, b) => a + b.count, 0);
        const on = picked.includes(u.id);
        const full = !on && picked.length >= PVP_MAX_COMBATANTS;
        return (
          <button
            key={u.id}
            onClick={() => !full && onToggle(u.id)}
            disabled={full}
            className={`flex items-center gap-3 border rounded-lg p-2 text-left transition-all ${on ? 'ring-2 ring-yellow-400 bg-yellow-50' : full ? 'bg-stone-100 opacity-60' : 'bg-white hover:bg-stone-50'}`}
          >
            <GameIcon name={getIconForGameItem(u.type) || 'sword'} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{prettyName(u.type)}</div>
              <div className="text-xs text-stone-500 font-mono">{size} soldiers · morale {Math.round(u.morale ?? 100)} · fields {fieldedStrength(u)}</div>
            </div>
            <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-black text-white' : 'bg-white'}`}>{on ? '✓' : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function PvpPanel({ myUid }: { myUid: string }) {
  const [battles, setBattles] = useState<WarlordGameDoc[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<'LIST' | 'CHALLENGE' | { accept: string } | { battle: string }>('LIST');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wizard state
  const [groupId, setGroupId] = useState<string>('');
  const [opponentUid, setOpponentUid] = useState<string>('');
  const [picked, setPicked] = useState<string[]>([]);

  const army = useMemo(() => readLocalArmy(myUid), [myUid, view]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  useEffect(() => subscribeMyBattles(myUid, setBattles), [myUid]);
  useEffect(() => subscribeMyGroups(myUid, setGroups), [myUid]);

  // Resolve display names for everyone we can see (opponents + group members).
  useEffect(() => {
    const uids = new Set<string>();
    battles.forEach((b) => b.players.forEach((u) => uids.add(u)));
    groups.forEach((g) => g.members.forEach((u) => uids.add(u)));
    uids.delete(myUid);
    const missing = [...uids].filter((u) => !(u in names));
    if (missing.length === 0) return;
    fetchProfileNames(missing).then((got) => setNames((prev) => ({ ...prev, ...got })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battles, groups]);

  const nameOf = (uid: string) => (uid === myUid ? 'You' : names[uid] || 'Player');

  // ── Active battle view ──
  if (typeof view === 'object' && 'battle' in view) {
    const game = battles.find((b) => b.id === view.battle);
    if (!game) { setView('LIST'); return null; }
    return <PvpBattle game={game} myUid={myUid} names={{ ...names, [myUid]: 'You' }} onBack={() => setView('LIST')} />;
  }

  // ── Accept flow (opponent picks their detachment) ──
  if (typeof view === 'object' && 'accept' in view) {
    const game = battles.find((b) => b.id === view.accept);
    if (!game || game.status !== 'waiting') { setView('LIST'); return null; }
    const chosen = army.filter((u) => picked.includes(u.id));
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">Deploy against {nameOf(game.createdBy)}</h3>
          <button onClick={() => { setView('LIST'); setPicked([]); }} className="px-3 py-1 border rounded text-sm">← Battles</button>
        </div>
        <p className="text-xs text-stone-500">
          ⚔ War stakes: casualties are permanent. Units fight with standard stats (mods don't apply in PvP).
        </p>
        <UnitPicker units={army} picked={picked} onToggle={toggle} />
        {error && <div className="text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-sm text-stone-600">
            Deploying <span className="font-mono font-bold">{chosen.length}</span> units ·
            strength <span className="font-mono font-bold">{chosen.reduce((a, u) => a + fieldedStrength(u), 0)}</span>
          </div>
          <button
            disabled={chosen.length === 0 || busy}
            onClick={async () => {
              setBusy(true); setError(null);
              try {
                const claims = chosen.map(unitToClaim);
                await acceptWarlordChallenge({ gameId: game.id, unitIds: claims.map((c) => c.unitId), combatants: claims });
                setPicked([]);
                setView({ battle: game.id });
              } catch (e: any) {
                setError(e?.message || 'Failed to accept');
              } finally { setBusy(false); }
            }}
            className={`px-4 py-2 rounded text-white ${chosen.length && !busy ? 'bg-red-800 hover:bg-red-900' : 'bg-stone-300 cursor-not-allowed'}`}
          >
            {busy ? 'Deploying…' : 'Accept & fight ⚔'}
          </button>
        </div>
      </div>
    );
  }

  // ── Challenge wizard ──
  if (view === 'CHALLENGE') {
    const group = groups.find((g) => g.id === groupId);
    const members = (group?.members ?? []).filter((u) => u !== myUid);
    const chosen = army.filter((u) => picked.includes(u.id));
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">New challenge</h3>
          <button onClick={() => { setView('LIST'); setPicked([]); }} className="px-3 py-1 border rounded text-sm">← Battles</button>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Group</span>
            <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setOpponentUid(''); }} className="border rounded px-2 py-1 bg-white">
              <option value="">Select…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-stone-500 mb-1">Opponent</span>
            <select value={opponentUid} onChange={(e) => setOpponentUid(e.target.value)} disabled={!groupId} className="border rounded px-2 py-1 bg-white">
              <option value="">Select…</option>
              {members.map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}
            </select>
          </label>
        </div>

        <p className="text-xs text-stone-500">
          ⚔ War stakes: casualties are permanent for both sides. Units fight with standard stats (mods don't apply in PvP).
        </p>
        <UnitPicker units={army} picked={picked} onToggle={toggle} />
        {error && <div className="text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-sm text-stone-600">
            Deploying <span className="font-mono font-bold">{chosen.length}</span> units ·
            strength <span className="font-mono font-bold">{chosen.reduce((a, u) => a + fieldedStrength(u), 0)}</span>
          </div>
          <button
            disabled={!groupId || !opponentUid || chosen.length === 0 || busy}
            onClick={async () => {
              setBusy(true); setError(null);
              try {
                await createChallenge({ groupId, opponentUid, units: chosen });
                setPicked([]);
                setView('LIST');
              } catch (e: any) {
                setError(e?.message || 'Failed to create the challenge');
              } finally { setBusy(false); }
            }}
            className={`px-4 py-2 rounded text-white ${groupId && opponentUid && chosen.length && !busy ? 'bg-red-800 hover:bg-red-900' : 'bg-stone-300 cursor-not-allowed'}`}
          >
            {busy ? 'Sending…' : 'Send challenge ⚔'}
          </button>
        </div>
      </div>
    );
  }

  // ── Battle list ──
  const isMyTurn = (g: WarlordGameDoc) =>
    g.status === 'playing' && g.state?.status === 'ONGOING' &&
    g.players[g.state.side === 'PLAYER' ? 0 : 1] === myUid;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold">PvP battles</h3>
        <button onClick={() => { setPicked([]); setError(null); setView('CHALLENGE'); }} className="px-3 py-2 bg-black text-white rounded hover:bg-stone-800">
          New challenge ⚔
        </button>
      </div>

      {battles.length === 0 && (
        <p className="text-sm text-stone-600">
          No battles yet. Challenge a group member — you both deploy a detachment from your own
          army, and the server referees every move.
        </p>
      )}

      <div className="space-y-2">
        {battles.map((g) => {
          const opp = g.players[0] === myUid ? g.players[1] : g.players[0];
          const incoming = g.status === 'waiting' && g.opponentUid === myUid;
          const outgoing = g.status === 'waiting' && g.createdBy === myUid;
          return (
            <div key={g.id} className="border rounded-lg p-3 bg-white flex flex-wrap items-center gap-3">
              <span className="text-lg">{g.status === 'waiting' ? '📜' : g.status === 'playing' ? '⚔' : g.winner === myUid ? '🏆' : g.winner ? '💀' : '🤝'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">vs {nameOf(opp)}</div>
                <div className="text-xs text-stone-500">
                  {g.date} · {g.status === 'waiting' ? (incoming ? 'challenge received' : 'waiting for opponent') : g.status === 'playing' ? (isMyTurn(g) ? 'YOUR TURN' : 'their turn') : g.winner === myUid ? 'victory' : g.winner ? 'defeat' : 'draw'}
                  {g.forfeitedBy && ' (retreat)'}
                </div>
              </div>
              {incoming && (
                <button onClick={() => { setPicked([]); setError(null); setView({ accept: g.id }); }} className="px-3 py-1 bg-red-800 text-white rounded text-sm hover:bg-red-900">
                  Respond ⚔
                </button>
              )}
              {outgoing && (
                <button onClick={() => cancelChallenge(g.id).catch(() => {})} className="px-3 py-1 border rounded text-sm text-stone-600">
                  Cancel
                </button>
              )}
              {g.status !== 'waiting' && (
                <button onClick={() => setView({ battle: g.id })} className={`px-3 py-1 rounded text-sm ${isMyTurn(g) ? 'bg-green-700 text-white hover:bg-green-800' : 'border'}`}>
                  {g.status === 'playing' ? 'Open battle →' : 'View result →'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
