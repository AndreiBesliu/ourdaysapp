// src/components/games/gameTypeName.ts
//
// What a game shows of itself outside the game: its name, in the reader's language (the arcade's
// list and the calendar's "game in progress" banner), and who is playing it (the banner). The
// banner used to print `gameType` itself, title-cased — English in every language, and a crash on
// anything that was not a string (06.10.2026: until then the rules accepted any value). A value
// that is not one of the games is shown as "Arcade", never as itself.

import { t } from '../../utils/i18n';
import { SERVER_OWNED_GAME } from '../../utils/gameSession';

const NAME_KEYS: Readonly<Record<string, string>> = {
  'tic-tac-toe': 'gameTicTacToe',
  'connect-4': 'gameConnect4',
  'rummy-45': 'gameRummy45',
  'memory-match': 'gameMemoryMatch',
};

export function gameTypeName(gameType: unknown, language?: string): string {
  if (gameType === SERVER_OWNED_GAME) return 'Warlord Battle'; // Warlord's interface is English only
  const key = ownEntry(NAME_KEYS, gameType);
  return t(key ?? 'arcade', language);
}

/**
 * Who the banner shows as playing: uids, whatever the document holds. A rummy game's `playerIds`
 * that was not a list (any member could write one until 06.10.2026) crashed the calendar for
 * everybody in the group looking at that day, on the web and in the installed APK alike.
 */
export function bannerPlayerIds(game: unknown): string[] {
  const g = (game && typeof game === 'object' ? game : {}) as { gameType?: unknown; state?: any };
  const s = g.state && typeof g.state === 'object' ? g.state : {};
  const ids: unknown[] = g.gameType === 'tic-tac-toe'
    ? [s.players?.X, s.players?.O]
    : g.gameType === 'rummy-45' && Array.isArray(s.playerIds) ? s.playerIds : [];
  return ids.filter((x): x is string => typeof x === 'string' && x !== '');
}

/**
 * The entry for one game in a table keyed by game type, or null. Own keys only: a plain lookup of
 * `'constructor'` finds the function every object inherits.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, gameType: unknown): T | null {
  return typeof gameType === 'string' && Object.prototype.hasOwnProperty.call(table, gameType)
    ? table[gameType]
    : null;
}
