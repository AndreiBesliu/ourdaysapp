// Warlord PvP lobby — OurDaysApp-only. Lists my battles, creates challenges
// (pick group → opponent → deploy units from the local army), accepts incoming
// challenges (pick units → server callable builds the authoritative battle).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Unit } from '../warlord/logic/types';
import { fieldedStrength, prettyName } from '../warlord/logic/combat/army';
import { PVP_MAX_COMBATANTS } from '../warlord/logic/combat/pvp';
import GameIcon from '../warlord/components/common/GameIcon';
import { getIconForGameItem } from '../warlord/logic/iconHelpers';
import { acceptWarlordChallenge } from '../serverActions';
import {
  type WarlordGameDoc, type WarlordPlayer,
  subscribeMyBattles, fetchProfileNames,
  createChallenge, cancelChallenge, readLocalArmy, unitToClaim,
  upsertWarlordPlayer, fetchRecentPlayers, searchPlayers, fetchKnownUids,
} from './pvpApi';
import { armyStrength } from '../warlord/logic/combat/army';
import { auth } from '../firebase';
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
        No units available — build your army in the Domain tab, or wait for your current
        battles to finish (units already committed to a battle can't be deployed again).
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
  const [names, setNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<'LIST' | 'CHALLENGE' | { accept: string } | { battle: string }>('LIST');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wizard state
  const [opponent, setOpponent] = useState<WarlordPlayer | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // world roster
  const [roster, setRoster] = useState<WarlordPlayer[]>([]);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<WarlordPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);

  const fullArmy = useMemo(() => readLocalArmy(myUid), [myUid, view]);
  // Units already staked in a live/pending battle must NOT be offered again: the same
  // soldiers would fight twice and each write-back would subtract casualties from the
  // same underlying unit, destroying troops that never died.
  const committedUnitIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of battles) {
      if (b.status === 'finished') continue;
      for (const id of b.deploy?.[myUid]?.unitIds ?? []) s.add(id);
    }
    return s;
  }, [battles, myUid]);
  const army = useMemo(() => fullArmy.filter((u) => !committedUnitIds.has(u.id)), [fullArmy, committedUnitIds]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  useEffect(() => subscribeMyBattles(myUid, setBattles), [myUid]);

  // Announce myself in the world roster and load it. The name comes from the app's
  // canonical `profiles` doc (auth.displayName is null for email/password signups,
  // which would make those players unfindable by the name everyone else sees).
  useEffect(() => {
    let alive = true;
    (async () => {
      const me = auth.currentUser;
      const fromProfile = (await fetchProfileNames([myUid]))[myUid];
      const myName = (fromProfile && fromProfile !== 'Player' ? fromProfile : null)
        || me?.displayName || me?.email?.split('@')[0] || 'Player';
      await upsertWarlordPlayer(myUid, myName, me?.photoURL ?? null, armyStrength(readLocalArmy(myUid)));
      const [r, k] = await Promise.all([fetchRecentPlayers(myUid), fetchKnownUids(myUid)]);
      if (!alive) return;
      setRoster(r);
      setKnown(k);
    })();
    return () => { alive = false; };
    // Re-runs when the wizard is opened so the roster is fresh (view is in the deps).
  }, [myUid, view]);

  // Debounced name search. `seq` drops out-of-order responses so a slow earlier query
  // can't overwrite newer results.
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = term.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const mine = ++searchSeq.current;
    const id = setTimeout(() => {
      searchPlayers(q, myUid).then((r) => {
        if (searchSeq.current !== mine) return; // a newer search already answered
        setResults(r);
        setSearching(false);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [term, myUid]);

  // Resolve display names for battle opponents.
  useEffect(() => {
    const uids = new Set<string>();
    battles.forEach((b) => b.players.forEach((u) => uids.add(u)));
    uids.delete(myUid);
    const missing = [...uids].filter((u) => !(u in names));
    if (missing.length === 0) return;
    fetchProfileNames(missing).then((got) => setNames((prev) => ({ ...prev, ...got })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battles]);

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

  // ── Challenge wizard: pick ANY player in the world, then your detachment ──
  if (view === 'CHALLENGE') {
    const chosen = army.filter((u) => picked.includes(u.id));
    const shown = results ?? roster;
    // People you know from the app float to the top — discovery shortcut, not a gate.
    const sorted = [...shown].sort((a, b) => Number(known.has(b.uid)) - Number(known.has(a.uid)));

    const PlayerRow = ({ p }: { p: WarlordPlayer }) => {
      const on = opponent?.uid === p.uid;
      return (
        <button
          onClick={() => setOpponent(on ? null : p)}
          className={`flex items-center gap-3 border rounded-lg p-2 text-left w-full transition-all ${on ? 'ring-2 ring-yellow-400 bg-yellow-50' : 'bg-white hover:bg-stone-50'}`}
        >
          {p.photoURL
            ? <img src={p.photoURL} alt="" className="w-8 h-8 rounded-full object-cover" />
            : <span className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-sm">{p.name.slice(0, 1).toUpperCase()}</span>}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">
              {p.name}
              {known.has(p.uid) && <span className="ml-2 text-[10px] px-1 rounded bg-blue-100 text-blue-800 border border-blue-300">known</span>}
            </div>
            <div className="text-xs text-stone-500 font-mono">power {p.power} · {p.wins ?? 0}W/{p.losses ?? 0}L</div>
          </div>
          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-black text-white' : 'bg-white'}`}>{on ? '✓' : ''}</span>
        </button>
      );
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">New challenge</h3>
          <button onClick={() => { setView('LIST'); setPicked([]); setOpponent(null); }} className="px-3 py-1 border rounded text-sm">← Battles</button>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-stone-500">Opponent — anyone in the world</span>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search players by name…"
              className="ml-auto border rounded px-2 py-1 text-sm w-56"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-auto">
            {sorted.map((p) => <PlayerRow key={p.uid} p={p} />)}
          </div>
          {searching && <div className="text-xs text-stone-500 mt-1">Searching…</div>}
          {!searching && sorted.length === 0 && (
            <p className="text-sm text-stone-600">
              {results ? 'No player by that name yet.' : 'No other players have entered the world yet — they appear here once they open the PvP tab.'}
            </p>
          )}
        </div>

        <p className="text-xs text-stone-500">
          ⚔ War stakes: casualties are permanent for both sides. Units fight with standard stats (mods don't apply in PvP).
        </p>
        <UnitPicker units={army} picked={picked} onToggle={toggle} />
        {error && <div className="text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-sm text-stone-600">
            {opponent ? <>vs <span className="font-semibold">{opponent.name}</span> · </> : <span className="text-stone-400">pick an opponent · </span>}
            <span className="font-mono font-bold">{chosen.length}</span> units ·
            strength <span className="font-mono font-bold">{chosen.reduce((a, u) => a + fieldedStrength(u), 0)}</span>
          </div>
          <button
            disabled={!opponent || chosen.length === 0 || busy}
            onClick={async () => {
              if (!opponent) return;
              setBusy(true); setError(null);
              try {
                await createChallenge({ opponentUid: opponent.uid, units: chosen });
                setPicked([]);
                setOpponent(null);
                setView('LIST');
              } catch (e: any) {
                setError(e?.message || 'Failed to create the challenge');
              } finally { setBusy(false); }
            }}
            className={`px-4 py-2 rounded text-white ${opponent && chosen.length && !busy ? 'bg-red-800 hover:bg-red-900' : 'bg-stone-300 cursor-not-allowed'}`}
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
                <>
                  <button onClick={() => { setPicked([]); setError(null); setView({ accept: g.id }); }} className="px-3 py-1 bg-red-800 text-white rounded text-sm hover:bg-red-900">
                    Respond ⚔
                  </button>
                  {/* Anyone in the world can challenge you — you must be able to say no. */}
                  <button
                    onClick={() => { if (confirm('Decline this challenge?')) cancelChallenge(g.id).catch(() => {}); }}
                    className="px-3 py-1 border rounded text-sm text-stone-600"
                  >
                    Decline
                  </button>
                </>
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
