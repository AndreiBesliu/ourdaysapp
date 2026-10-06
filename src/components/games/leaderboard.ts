// src/components/games/leaderboard.ts
//
// The arcade's all-time standings, from a group's finished games. Out of GamesHubModal's listener
// on 06.10.2026, because any member of the group can write any field of a game and the inline
// version trusted them all:
//   * a player called '__proto__' made `statsMap['__proto__']` Object.prototype itself, so
//     `.wins += 1` wrote NaN onto every object in the page until it was reloaded (Warlord's PvP
//     list then read "NaNW");
//   * a map where a number belonged threw, and the listener with it: the tab said "no games have
//     been completed yet" for as long as the game existed.
// Now the standings live in a map with no prototype, a player counts only as a non-empty string,
// and points only as finite numbers. For every game the arcade itself writes, nothing changes.

import { getSessionWinner } from '../../utils/gameSession';

export interface Standing { uid: string; wins: number; points: number }

export function leaderboardFrom(games: readonly unknown[]): Standing[] {
  const stats: Record<string, { wins: number; points: number }> = Object.create(null);
  const row = (uid: string) => (stats[uid] ??= { wins: 0, points: 0 });

  for (const raw of games) {
    const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    // Credit the SESSION winner (leader across all rounds), not just the last round's `winner`.
    const sessionWinner = getSessionWinner(g);
    // A session the clock closed with nobody ahead has nothing to contribute to anyone's record.
    // Without this, an unjoined lobby that timed out put its creator in the standings on a row of
    // zeros — a player who never played a hand.
    if (g.abandoned && !sessionWinner) continue;
    if (sessionWinner) row(sessionWinner).wins += 1;

    const players = g.gameType === 'rummy-45' ? g.state?.players : null;
    if (players && typeof players === 'object') {
      for (const p of Object.values(players) as any[]) {
        const uid = p?.uid;
        // Cumulative penalty across the whole session (totalScore banks prior hands; score is the
        // current hand). Penalties are negative.
        if (typeof uid === 'string' && uid) row(uid).points += num(p.totalScore) + num(p.score);
      }
    }
  }

  return Object.entries(stats)
    .map(([uid, s]) => ({ uid, ...s }))
    .sort((a, b) => b.wins - a.wins);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
