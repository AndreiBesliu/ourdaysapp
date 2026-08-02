// Warlord PvP client plumbing — OurDaysApp-ONLY module (not part of the synced
// game code). Reads the pure combat engine from src/warlord/logic/combat/* and
// talks to Firestore/callables. The server (functions/src/warlordCombat/) is the
// authority; this file only creates inert challenge docs and reads.

import {
  doc, onSnapshot, query, collection, where, getDoc, getDocs, setDoc, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Unit } from '@warlord/logic/types';
import type { BattleState } from '@warlord/logic/combat/types';
import { type DeployCombatantClaim, sanitizeDeploy } from '@warlord/logic/combat/pvp';
import { fieldedStrength } from '@warlord/logic/combat/army';
import { createWarlordChallenge, forfeitWarlordBattle } from '../serverActions';
import { saveWarlordDomain } from '../warlordCloud';

export const WARLORD_GAME_TYPE = 'warlord-battle';
// Keep in sync with WARLORD_TURN_TIMEOUT_HOURS in functions/src/index.ts — the server
// is the authority; this only decides when to OFFER the claim button.
export const WARLORD_TURN_TIMEOUT_HOURS = 24;

export interface WarlordGameDoc {
  id: string;
  groupId: string;
  date: string;
  gameType: typeof WARLORD_GAME_TYPE;
  status: 'waiting' | 'playing' | 'finished';
  createdBy: string;
  winner: string | null;
  players: [string, string];
  opponentUid: string;
  stake: 'war';
  seed: number | null;
  state: BattleState | null;
  deploy?: Record<string, { unitIds: string[]; combatants: unknown[] }>; // absent while 'waiting'
  forfeitedBy?: string;
  timedOutBy?: string;
  lastMoveAt?: { toMillis?: () => number } | null; // Firestore Timestamp (turn-timeout clock)
}

// ── Local army access (reads the per-uid save the game itself writes) ──

export function readLocalArmy(uid: string): Unit[] {
  try {
    const raw = localStorage.getItem(`warlord_save_${uid}`);
    const blob = raw ? JSON.parse(raw) : null;
    return Array.isArray(blob?.units) ? (blob.units as Unit[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalArmy(uid: string, units: Unit[]): boolean {
  try {
    const key = `warlord_save_${uid}`;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const blob = JSON.parse(raw);
    blob.units = units;
    localStorage.setItem(key, JSON.stringify(blob)); // local cache
    void saveWarlordDomain(uid, blob); // durable: casualties must survive across devices
    return true;
  } catch {
    return false;
  }
}

// ── Casualty write-back idempotency (kept OUTSIDE the game save blob so the
//    game's own persist cycle can never erase the marker) ──

const appliedKey = (uid: string) => `warlord_pvp_applied_${uid}`;

export function hasAppliedBattle(uid: string, gameId: string): boolean {
  try {
    const arr = JSON.parse(localStorage.getItem(appliedKey(uid)) ?? '[]');
    return Array.isArray(arr) && arr.includes(gameId);
  } catch {
    return false;
  }
}

export function markBattleApplied(uid: string, gameId: string): void {
  try {
    const arr = JSON.parse(localStorage.getItem(appliedKey(uid)) ?? '[]');
    const next = Array.isArray(arr) ? arr : [];
    if (!next.includes(gameId)) next.push(gameId);
    localStorage.setItem(appliedKey(uid), JSON.stringify(next));
  } catch {
    // best effort — worst case the UI re-offers the apply, guarded again here
  }
}

// ── Deploy payload construction (client side of sanitizeDeploy's contract) ──

export function unitToClaim(u: Unit): DeployCombatantClaim {
  // No loadoutWeapon — PvP is vanilla stats; the server resolves the weapon from type.
  return {
    unitId: u.id,
    type: u.type,
    hp: fieldedStrength(u),
    morale: Math.max(0, Math.min(100, Math.round(u.morale ?? 100))),
    buckets: u.buckets.map((b) => ({ r: b.r, count: b.count, avgXP: Math.floor(b.avgXP) })),
  };
}

// ── Challenge lifecycle ──

// Creates a challenge via the server callable (the challenger's army is validated and
// stashed Admin-side, hidden from the opponent until they commit). A client-side
// sanitize gives instant feedback before the round-trip. Returns the new gameId.
export async function createChallenge(params: {
  groupId?: string | null; // optional: tags the battle to a group; NOT a permission gate
  opponentUid: string;
  units: Unit[];
}): Promise<string> {
  const claims = params.units.map(unitToClaim);
  const check = sanitizeDeploy({ unitIds: claims.map((c) => c.unitId), combatants: claims }, 'PLAYER');
  if (!check.ok) throw new Error(check.error);
  const { gameId } = await createWarlordChallenge({
    ...(params.groupId ? { groupId: params.groupId } : {}),
    opponentUid: params.opponentUid,
    unitIds: claims.map((c) => c.unitId),
    combatants: claims,
  });
  return gameId;
}

// Creator cancels a waiting challenge (or opponent declines). Routed through the
// forfeit callable so the private staging doc gets cleaned up too.
export async function cancelChallenge(gameId: string): Promise<void> {
  await forfeitWarlordBattle(gameId);
}

// ── Live queries ──

// All my Warlord battles (any group). Single array-contains clause — no composite
// index needed; only warlord docs carry a top-level `players` array.
export function subscribeMyBattles(uid: string, cb: (games: WarlordGameDoc[]) => void): () => void {
  const q = query(collection(db, 'games'), where('players', 'array-contains', uid));
  return onSnapshot(q, (snap) => {
    const games = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as WarlordGameDoc))
      .filter((g) => g.gameType === WARLORD_GAME_TYPE)
      .sort((a, b) => {
        const rank = (s: string) => (s === 'playing' ? 0 : s === 'waiting' ? 1 : 2);
        return rank(a.status) - rank(b.status);
      });
    cb(games);
  });
}

export function subscribeBattle(gameId: string, cb: (game: WarlordGameDoc | null) => void): () => void {
  return onSnapshot(doc(db, 'games', gameId), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as WarlordGameDoc) : null);
  });
}

// ── Groups + member names (same recipe CalendarHome uses; profiles are readable
//    by any signed-in user) ──

export interface GroupInfo {
  id: string;
  name: string;
  members: string[];
}

export function subscribeMyGroups(uid: string, cb: (groups: GroupInfo[]) => void): () => void {
  const q = query(collection(db, 'groups'), where('members', 'array-contains', uid));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, name: data.name || 'Group', members: data.members || [] };
    }));
  });
}

export async function fetchProfileNames(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(uids.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'profiles', uid));
      out[uid] = (snap.exists() && (snap.data().name as string)) || 'Player';
    } catch {
      out[uid] = 'Player';
    }
  }));
  return out;
}

// ── The world roster (warlordPlayers) ──
// Warlord is ONE shared world: any app user can find and challenge any other. This
// registry is the discovery surface — game data only (no app PII). Friends/groups
// remain shortcuts for "people you know", not a permission boundary.

export interface WarlordPlayer {
  uid: string;
  name: string;
  photoURL?: string | null;
  power: number; // self-reported army strength (display only; battles use the server-sanitized deploy)
  wins?: number; // server-written
  losses?: number; // server-written
}

// Announce/refresh my roster entry. Called whenever the PvP panel opens so the
// directory reflects a live name and army power. wins/losses are server-only
// (rules reject client writes to them), so they are never sent here.
export async function upsertWarlordPlayer(uid: string, name: string, photoURL: string | null, power: number): Promise<void> {
  try {
    await setDoc(doc(db, 'warlordPlayers', uid), {
      name,
      nameLower: name.toLowerCase(),
      photoURL: photoURL ?? null,
      power,
      lastActive: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('Warlord roster upsert failed:', e);
  }
}

function toPlayer(id: string, d: any): WarlordPlayer {
  return { uid: id, name: d?.name || 'Player', photoURL: d?.photoURL ?? null, power: d?.power ?? 0, wins: d?.wins ?? 0, losses: d?.losses ?? 0 };
}

// Most recently active players — the default "who's out there" list.
export async function fetchRecentPlayers(excludeUid: string, max = 24): Promise<WarlordPlayer[]> {
  try {
    const snap = await getDocs(query(collection(db, 'warlordPlayers'), orderBy('lastActive', 'desc'), limit(max)));
    return snap.docs.map((d) => toPlayer(d.id, d.data())).filter((p) => p.uid !== excludeUid);
  } catch (e) {
    console.error('Warlord roster fetch failed:', e);
    return [];
  }
}

// Name prefix search (single-field range → no composite index needed).
export async function searchPlayers(term: string, excludeUid: string, max = 20): Promise<WarlordPlayer[]> {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'warlordPlayers'),
      orderBy('nameLower'),
      where('nameLower', '>=', q),
      where('nameLower', '<', q + ''),
      limit(max),
    ));
    return snap.docs.map((d) => toPlayer(d.id, d.data())).filter((p) => p.uid !== excludeUid);
  } catch (e) {
    console.error('Warlord roster search failed:', e);
    return [];
  }
}

// The uids I know from the app (friends + fellow group members) — used to badge
// roster entries as "known" and to offer a quick-pick list.
export async function fetchKnownUids(uid: string): Promise<Set<string>> {
  const known = new Set<string>();
  try {
    const me = await getDoc(doc(db, 'users', uid));
    for (const f of (me.data()?.friends ?? [])) if (f?.uid) known.add(f.uid);
  } catch { /* friends are optional */ }
  try {
    const groups = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', uid)));
    groups.docs.forEach((g) => (g.data().members || []).forEach((m: string) => known.add(m)));
  } catch { /* groups are optional */ }
  known.delete(uid);
  return known;
}
