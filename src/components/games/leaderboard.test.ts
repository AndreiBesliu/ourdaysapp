// src/components/games/leaderboard.test.ts
//
// The arcade's standings (leaderboard.ts), out of GamesHubModal on 06.10.2026. For the games the
// arcade writes, exactly what the inline version gave; for what a member can write instead, no
// pollution of every object in the page and no throw.

import { describe, it, expect, afterEach } from 'vitest';
import { leaderboardFrom } from './leaderboard';
import { getSessionWinner } from '../../utils/gameSession';

/** The listener's body as it was before 06.10.2026, kept here as the reference. */
function before(games: any[]) {
  const statsMap: Record<string, { wins: number; points: number }> = {};
  games.forEach((g) => {
    const sessionWinner = getSessionWinner(g);
    if (g.abandoned && !sessionWinner) return;
    if (sessionWinner) {
      if (!statsMap[sessionWinner]) statsMap[sessionWinner] = { wins: 0, points: 0 };
      statsMap[sessionWinner].wins += 1;
    }
    if (g.gameType === 'rummy-45' && g.state && g.state.players) {
      Object.values(g.state.players).forEach((p: any) => {
        if (p && p.uid) {
          if (!statsMap[p.uid]) statsMap[p.uid] = { wins: 0, points: 0 };
          statsMap[p.uid].points += (p.totalScore || 0) + (p.score || 0);
        }
      });
    }
  });
  return Object.entries(statsMap).map(([uid, stats]) => ({ uid, ...stats })).sort((a, b) => b.wins - a.wins);
}

/** Finished games as the four games and the sweep leave them, including the older shapes on live. */
const GAMES = [
  { gameType: 'tic-tac-toe', status: 'finished', winner: 'ana', state: { players: { X: 'ana', O: 'bob' }, scores: { X: 2, O: 1 } } },
  { gameType: 'tic-tac-toe', status: 'finished', winner: null, state: { players: { X: 'ana', O: 'bob' } } },
  { gameType: 'tic-tac-toe', status: 'finished', winner: 'bob', state: { players: { X: 'ana', O: 'bob' }, scores: { X: 0, O: 3 } } },
  { gameType: 'connect-4', status: 'finished', winner: null, state: { players: { P1: 'bob', P2: 'dan' }, scores: { P1: 1, P2: 1 } } },
  { gameType: 'connect-4', status: 'finished', winner: 'dan', state: { players: { P1: 'bob', P2: 'dan' }, scores: { P1: 0, P2: 2 } } },
  { gameType: 'memory-match', status: 'finished', state: { players: { P1: 'ana', P2: 'dan' }, roundsWon: { P1: 2, P2: 0 }, scores: { P1: 0, P2: 0 } } },
  { gameType: 'memory-match', status: 'finished', state: { players: { P1: 'ana', P2: 'dan' }, scores: { P1: 4, P2: 9 } } },
  { gameType: 'tic-tac-toe', status: 'finished', abandoned: true, finalized: true, winner: null, state: { players: { X: 'eve', O: null }, scores: { X: 0, O: 0 } } },
  {
    gameType: 'rummy-45', status: 'finished', winner: 'bob',
    state: { playerIds: ['ana', 'bob'], players: { ana: { uid: 'ana', score: -12 }, bob: { uid: 'bob', score: 0 } } },
  },
  {
    gameType: 'rummy-45', status: 'finished', winner: null,
    state: { playerIds: ['ana', 'bob', 'dan'], players: {
      ana: { uid: 'ana', totalScore: -40, score: -5 }, bob: { uid: 'bob', totalScore: -10, score: 0 }, dan: { uid: 'dan', totalScore: -25, score: -3 },
    } },
  },
];

afterEach(() => {
  // Whatever a test did, nothing may be left on every object in the page.
  expect(({} as any).wins).toBeUndefined();
  expect(({} as any).points).toBeUndefined();
});

describe('the standings', () => {
  it('for the games the arcade writes, exactly what the inline version gave', () => {
    expect(leaderboardFrom(GAMES)).toEqual(before(GAMES));
    // Written out once by hand, so the reference itself is anchored: bob 3 (tic-tac-toe, both
    // rummy sessions), ana 2 (tic-tac-toe, memory on rounds), dan 2 (connect-4, memory on points).
    expect(leaderboardFrom(GAMES).map((r) => [r.uid, r.wins, r.points])).toEqual([
      ['bob', 3, -10], ['ana', 2, -57], ['dan', 2, -28],
    ]);
  });

  it('an abandoned session counts only if somebody was ahead when the clock closed it', () => {
    const rows = leaderboardFrom([
      // A rummy lobby nobody joined, as the sweep closes it: no winner, its creator on a score of 0.
      { gameType: 'rummy-45', status: 'finished', abandoned: true, finalized: true, winner: null,
        state: { playerIds: ['eve'], players: { eve: { uid: 'eve', hand: [], hasMelded: false, score: 0 } } } },
      // A session the sweep closed with somebody ahead.
      { gameType: 'tic-tac-toe', status: 'finished', abandoned: true, finalized: true, winner: 'ana',
        state: { players: { X: 'ana', O: 'bob' }, scores: { X: 2, O: 1 } } },
    ]);
    expect(rows.map((r) => [r.uid, r.wins, r.points])).toEqual([['ana', 1, 0]]);
  });

  it('a player called __proto__ is an ordinary row, and every object in the page stays clean', () => {
    const rows = leaderboardFrom([
      { gameType: 'tic-tac-toe', status: 'finished', state: { players: { X: '__proto__', O: 'bob' }, scores: { X: 1, O: 0 } } },
      { gameType: 'rummy-45', status: 'finished', state: { playerIds: ['__proto__'], players: { p: { uid: '__proto__', totalScore: 'x', score: -2 } } } },
    ]);
    expect(rows).toEqual([{ uid: '__proto__', wins: 1, points: -2 }]);
  });

  it('a map, a number or a list where a player or a score belongs never throws, and counts for nothing', () => {
    const POISON = { toString: 0 };
    const odd = [POISON, { a: 1 }, 5, [], null, 'x'];
    const games: unknown[] = [null, 'x', 5, []];
    for (const v of odd) {
      games.push(
        { gameType: 'tic-tac-toe', status: 'finished', winner: v, state: { players: { X: v, O: 'bob' }, scores: { X: 1, O: v } } },
        { gameType: 'rummy-45', status: 'finished', winner: v, state: { playerIds: [v, 'bob'], players: v } },
        { gameType: 'rummy-45', status: 'finished', state: { players: { a: v, b: { uid: v, score: 1 }, c: { uid: 'dan', totalScore: v, score: v } } } },
        { gameType: 'memory-match', status: 'finished', state: { players: { P1: v, P2: 'ana' }, roundsWon: { P1: v, P2: 1 } } },
        { gameType: 'other', status: 'finished', winner: v },
      );
    }
    let rows: ReturnType<typeof leaderboardFrom> = [];
    expect(() => { rows = leaderboardFrom(games); }).not.toThrow();
    for (const r of rows) {
      expect(typeof r.uid).toBe('string');
      expect(Number.isFinite(r.wins) && Number.isFinite(r.points)).toBe(true);
    }
  });
});
