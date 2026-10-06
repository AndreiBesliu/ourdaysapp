// src/components/games/arcadeGuards.test.ts
//
// How GamesHubModal stands between a malformed game and the rest of the app (06.10.2026). The
// pieces are tested on their own (ErrorBoundary, leaderboard, gameSession, liveQuery); this checks
// that the arcade actually uses them. There is no DOM in this suite: the boundary was proved in a
// real browser on the emulators — four broken games, one of each kind, each stayed in its panel.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const hub = readFileSync('src/components/games/GamesHubModal.tsx', 'utf8');

describe('the arcade', () => {
  it('opens every game inside one boundary of its own, keyed by the game, with a way back', () => {
    const open = hub.indexOf('<ErrorBoundary key={playingGameId} context="GamesHubModal.game"');
    const close = hub.indexOf('</ErrorBoundary>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const inside = hub.slice(open, close);
    for (const game of ['<TicTacToe ', '<Connect4 ', '<RummyGame ', '<MemoryMatch ']) {
      expect(inside, game).toContain(game);
      // …and nowhere else.
      expect(hub.split(game).length - 1, game).toBe(1);
    }
    const fallback = inside.slice(0, inside.indexOf('}>'));
    expect(fallback).toContain("t('gameCouldNotShow', language)");
    expect(fallback).toContain('onClick={() => setPlayingGameId(null)}');
  });

  it('sorts the day’s games with activityMs, and builds the standings with leaderboardFrom', () => {
    expect(hub).toContain('(activityMs(b.createdAt) ?? 0) - (activityMs(a.createdAt) ?? 0)');
    expect(hub).not.toMatch(/createdAt\??\.toMillis/);
    expect(hub).toContain('setLeaderboard(leaderboardFrom(games))');
    expect(hub).not.toMatch(/statsMap/);
  });

  it('looks people up by their own key only', () => {
    expect(hub).not.toMatch(/userMap\s*\[/);
  });
});
