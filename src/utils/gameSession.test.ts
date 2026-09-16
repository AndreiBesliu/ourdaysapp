// src/utils/gameSession.test.ts
//
// When a game counts as abandoned, and who won it when it is closed.
//
// Andrei, 16.09.2026: "buton de end game, sesiune abandonata dupa 24 de ore de inactivitate" —
// both, not either. The button already existed; what did not exist was any way to MEASURE
// inactivity, because not one of the fifteen writes in the arcade recorded when it happened.

import { describe, it, expect } from 'vitest';
import {
  IDLE_MS,
  SERVER_OWNED_GAME,
  getSessionWinner,
  nextRoundsWon,
  activityMs,
  lastActivityMs,
  STAMPED_FROM_MS,
  expiryRefusal,
  shouldExpire,
  closedSessionFields,
} from './gameSession';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const agesAgo = NOW - 3 * IDLE_MS;
const justNow = NOW - 60_000;

/** A game as Firestore hands it back, with a Timestamp-shaped `lastMoveAt`. */
const game = (over: Record<string, unknown> = {}) => ({
  gameType: 'tic-tac-toe',
  status: 'playing',
  lastMoveAt: { toMillis: () => agesAgo },
  state: { players: { X: 'ana', O: 'bob' }, scores: { X: 0, O: 0 } },
  ...over,
});

describe('reading a timestamp off a document that three SDKs have touched', () => {
  it('accepts the shape each of them produces', () => {
    expect(activityMs({ toMillis: () => 1234 })).toBe(1234);          // client and Admin Timestamp
    expect(activityMs({ seconds: 10, nanoseconds: 0 })).toBe(10_000); // decoded JSON
    expect(activityMs({ _seconds: 10 })).toBe(10_000);                // the Admin SDK's own JSON
    expect(activityMs(1234)).toBe(1234);                              // a fixture
    expect(activityMs('2026-09-16T12:00:00.000Z')).toBe(NOW);         // an ISO string
  });

  it('says "cannot tell" rather than 1970 for anything else', () => {
    // A zero here would read as January 1970 and expire a live game instantly, which is the worst
    // possible failure for this feature: it would close games people are in the middle of.
    for (const bad of [null, undefined, {}, 'not a date', NaN, { seconds: 'ten' }]) {
      expect(activityMs(bad)).toBeNull();
    }
  });
});

describe('what counts as the last thing that happened', () => {
  it('prefers the last move', () => {
    expect(lastActivityMs({ lastMoveAt: 500, createdAt: 100 })).toBe(500);
  });

  it('gives a game made before stamping a full window from the floor, not from its creation', () => {
    // The defect a reviewer found and the live data confirmed: `createdAt` cannot tell "nobody has
    // touched it since it was made" from "played every evening, none of it recorded". All eighteen
    // games in the database were made months ago and not one carries a timestamp — judging them by
    // creation would have closed whatever was in active play on the day this shipped.
    expect(lastActivityMs({ createdAt: 100 })).toBe(STAMPED_FROM_MS);
    expect(lastActivityMs({ createdAt: 100 })).not.toBe(100);
  });

  it('is null when there is nothing to measure at all', () => {
    expect(lastActivityMs({})).toBeNull();
    expect(lastActivityMs(null)).toBeNull();
  });

  it('will not call a game idle before the day it was booked for is over', () => {
    // The arcade is opened from a date in the calendar, so a game made on Wednesday FOR Saturday
    // is ordinary. Measured from its own creation it would be closed on Thursday, before the
    // evening it exists for.
    const saturday = '2026-09-19';
    const made = { lastMoveAt: Date.parse('2026-09-16T10:00:00.000Z'), date: saturday };
    expect(lastActivityMs(made)).toBe(Date.parse(`${saturday}T23:59:59.999Z`));
    expect(expiryRefusal(made, Date.parse('2026-09-17T12:00:00.000Z'))).toBe('still-fresh');
  });

  it('but a past date never EXTENDS a game beyond its real last move', () => {
    const fresh = { lastMoveAt: NOW - 1000, date: '2020-01-01' };
    expect(lastActivityMs(fresh)).toBe(NOW - 1000);
  });
});

describe('the twenty-four hour rule', () => {
  it('closes a game untouched for longer than a day', () => {
    expect(shouldExpire(game(), NOW)).toBe(true);
    expect(expiryRefusal(game(), NOW)).toBeNull();
  });

  it('leaves one that was touched a minute ago', () => {
    expect(expiryRefusal(game({ lastMoveAt: justNow }), NOW)).toBe('still-fresh');
  });

  it('is exact at the boundary: one millisecond under a day is fresh, a full day is not', () => {
    expect(expiryRefusal(game({ lastMoveAt: NOW - IDLE_MS + 1 }), NOW)).toBe('still-fresh');
    expect(expiryRefusal(game({ lastMoveAt: NOW - IDLE_MS }), NOW)).toBeNull();
  });

  it('never touches a Warlord battle', () => {
    // Same collection, but server-owned with its own forfeit flow. Closing one from here would
    // write a result nobody computed.
    expect(expiryRefusal(game({ gameType: SERVER_OWNED_GAME }), NOW)).toBe('server-owned');
  });

  it('CLOSES a session parked between rounds, which is how they are really abandoned', () => {
    // The defect that made the whole feature miss its main case. `status: 'finished'` in this
    // schema means the ROUND is over: TicTacToe.tsx sets it whenever somebody wins one, and
    // "Next Round" sets it back to 'playing'. Reading it as "already closed" meant the sweep
    // never saw a game where one person won a round and nobody came back — and one of the
    // eighteen games on live was sitting in exactly that state.
    expect(expiryRefusal(game({ status: 'finished' }), NOW)).toBeNull();
  });

  it('leaves alone a session a person formally ended', () => {
    // `finalized` is the flag that means the SESSION is over, and it is the only one that does.
    expect(expiryRefusal(game({ finalized: true }), NOW)).toBe('already-closed');
    expect(expiryRefusal(game({ status: 'finished', finalized: true }), NOW)).toBe('already-closed');
  });

  it('refuses to act on a timestamp from the future rather than calling it fresh', () => {
    // A wrong clock should be visible in the run line as its own reason, not disguised as the
    // one skip that looks completely normal.
    expect(expiryRefusal(game({ lastMoveAt: NOW + 5 * 3_600_000 }), NOW)).toBe('future-timestamp');
    // An hour of drift is still just drift.
    expect(expiryRefusal(game({ lastMoveAt: NOW + 60_000 }), NOW)).toBe('still-fresh');
  });

  it('refuses to guess when there is no timestamp at all', () => {
    expect(expiryRefusal({ gameType: 'tic-tac-toe', status: 'playing' }, NOW)).toBe('no-timestamp');
  });

  it('closes a waiting game nobody ever joined', () => {
    expect(shouldExpire(game({ status: 'waiting' }), NOW)).toBe(true);
  });
});

describe('who gets credited when a session is closed', () => {
  it('nobody, when no round was ever won', () => {
    // The commonest abandoned game: two people started, nobody finished a round. Closing it must
    // not invent a winner.
    const fields = closedSessionFields(game(), true);
    expect(fields.winner).toBeNull();
    expect(fields).toMatchObject({ status: 'finished', finalized: true, abandoned: true });
  });

  it('the session leader, not the last round winner', () => {
    const g = game({
      winner: 'bob', // bob took the most recent round...
      state: { players: { X: 'ana', O: 'bob' }, scores: { X: 3, O: 1 } }, // ...ana took the session
    });
    expect(getSessionWinner(g)).toBe('ana');
    expect(closedSessionFields(g, true).winner).toBe('ana');
  });

  it('marks the abandoned flag only when the clock closed it, never when a person did', () => {
    expect(closedSessionFields(game(), false)).not.toHaveProperty('abandoned');
    expect(closedSessionFields(game(), true)).toHaveProperty('abandoned', true);
  });

  it('leaves endedAt to the caller, because the two runtimes spell it differently', () => {
    // The client needs the web SDK's serverTimestamp(), the sweep the Admin SDK's. This module is
    // allowed neither, which is exactly why it can be the same file on both sides.
    expect(closedSessionFields(game(), true)).not.toHaveProperty('endedAt');
  });
});

describe('counting a round to whoever won it', () => {
  const state = (over: Record<string, unknown> = {}) => ({
    players: { P1: 'ana', P2: 'bob' }, ...over,
  });

  it('starts a tally on a game that has none', () => {
    expect(nextRoundsWon(state(), 'ana')).toEqual({ P1: 1, P2: 0 });
  });

  it('adds to one that does', () => {
    expect(nextRoundsWon(state({ roundsWon: { P1: 2, P2: 1 } }), 'bob')).toEqual({ P1: 2, P2: 2 });
  });

  it('counts nothing for a draw', () => {
    expect(nextRoundsWon(state({ roundsWon: { P1: 1, P2: 0 } }), null)).toBeNull();
  });

  it('counts nothing for a uid that is neither player', () => {
    // The bug the extraction exposed: written inline as `winner === players.P1 ? 'P1' : 'P2'`,
    // ANY unrecognised winner was credited to P2.
    expect(nextRoundsWon(state({ roundsWon: { P1: 0, P2: 0 } }), 'carol')).toBeNull();
  });

  it('survives a half-written document', () => {
    expect(nextRoundsWon(null, 'ana')).toBeNull();
    expect(nextRoundsWon({}, 'ana')).toBeNull();
  });

  it('leaves the other player alone', () => {
    const after = nextRoundsWon(state({ roundsWon: { P1: 3, P2: 5 } }), 'ana')!;
    expect(after.P2).toBe(5);
  });
});

describe('the session winner, per game', () => {
  const winnerOf = (gameType: string, state: Record<string, unknown>, winner: string | null = null) =>
    getSessionWinner({ gameType, state, winner });

  it('reads round scores for tic-tac-toe', () => {
    expect(winnerOf('tic-tac-toe', { players: { X: 'ana', O: 'bob' }, scores: { X: 2, O: 1 } })).toBe('ana');
    expect(winnerOf('tic-tac-toe', { players: { X: 'ana', O: 'bob' }, scores: { X: 1, O: 1 } })).toBeNull();
  });

  it('reads round wins off the score for connect-4, which never resets them', () => {
    expect(winnerOf('connect-4', { players: { P1: 'ana', P2: 'bob' }, scores: { P1: 0, P2: 4 } })).toBe('bob');
  });

  describe('memory-match counts ROUNDS, because its points reset every round', () => {
    const P = { P1: 'ana', P2: 'bob' };

    it('credits the player who won more rounds, whatever the current round says', () => {
      // The case Andrei asked to fix: ana takes two rounds, somebody presses Next Round (points
      // back to 0-0), bob matches one pair, and they stop. Reading the points credited bob.
      expect(winnerOf('memory-match', {
        players: P, roundsWon: { P1: 2, P2: 0 }, scores: { P1: 0, P2: 1 },
      })).toBe('ana');
    });

    it('calls an even number of rounds a draw, however the last one went', () => {
      expect(winnerOf('memory-match', {
        players: P, roundsWon: { P1: 1, P2: 1 }, scores: { P1: 12, P2: 3 },
      })).toBeNull();
    });

    it('falls back to the points while no round has been counted yet', () => {
      // Two reasons, not one: documents written before 16.09.2026 have no counter at all, AND a
      // session already in progress only starts counting from the next round it finishes.
      // Reporting "nobody" for a game with rounds behind it would be worse than the imprecise
      // answer it gave yesterday.
      expect(winnerOf('memory-match', { players: P, scores: { P1: 0, P2: 4 } })).toBe('bob');
      expect(winnerOf('memory-match', {
        players: P, roundsWon: { P1: 0, P2: 0 }, scores: { P1: 0, P2: 4 },
      })).toBe('bob');
    });

    it('stops falling back the moment one round is recorded', () => {
      expect(winnerOf('memory-match', {
        players: P, roundsWon: { P1: 1, P2: 0 }, scores: { P1: 0, P2: 99 },
      })).toBe('ana');
    });
  });

  it('picks the least-penalised player at rummy, penalties being negative', () => {
    expect(winnerOf('rummy-45', {
      playerIds: ['ana', 'bob'],
      players: { ana: { totalScore: -30, score: -5 }, bob: { totalScore: -10, score: -2 } },
    })).toBe('bob');
  });

  it('falls back to the recorded winner for a single rummy hand', () => {
    expect(winnerOf('rummy-45', { playerIds: ['ana', 'bob'], players: { ana: {}, bob: {} } }, 'ana')).toBe('ana');
  });

  it('survives a half-written document without throwing', () => {
    // These run over whatever is in the database, including documents from older versions.
    for (const g of [null, {}, { gameType: 'tic-tac-toe' }, { gameType: 'rummy-45', state: {} }]) {
      expect(() => getSessionWinner(g)).not.toThrow();
    }
  });
});
