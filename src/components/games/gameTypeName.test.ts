// src/components/games/gameTypeName.test.ts
//
// What a game is called: on screen (gameTypeName) and in a push (gameTitleOf, the shared
// gameSession.ts the server runs too). 06.10.2026: both used to fall back to `gameType` itself,
// which was free text at creation.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { bannerPlayerIds, gameTypeName, ownEntry } from './gameTypeName';
import { ARCADE_GAME_TYPES, gameTitleOf, SERVER_OWNED_GAME } from '../../utils/gameSession';
import { t } from '../../utils/i18n';

const LANGS = ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE'];
const ODD: unknown[] = ['FREE PIZZA', 'tictactoe', '', 'constructor', '__proto__', 'toString', 42, null, undefined, {}, ['tic-tac-toe']];

describe('on screen', () => {
  it('every game the arcade makes has its own name, in every language', () => {
    for (const lang of LANGS) {
      for (const gt of ARCADE_GAME_TYPES) {
        const name = gameTypeName(gt, lang);
        expect(name, `${gt} ${lang}`).not.toBe(t('arcade', lang));
        expect(name, `${gt} ${lang}`).not.toMatch(/^game[A-Z]/); // a missing key renders as itself
      }
    }
    // Written out for two: the banner is now in the reader's language.
    expect(gameTypeName('tic-tac-toe', 'ro-RO')).toBe('X și 0');
    expect(gameTypeName('connect-4', 'en-US')).toBe('Connect 4');
  });

  it('a Warlord battle keeps its English name', () => {
    expect(gameTypeName(SERVER_OWNED_GAME, 'ro-RO')).toBe('Warlord Battle');
  });

  it('anything else is “Arcade”, never itself, and never a crash', () => {
    for (const gt of ODD) expect(gameTypeName(gt, 'en-US'), String(gt)).toBe('Arcade');
    expect(gameTypeName('FREE PIZZA')).toBe('Arcade');
  });

  it('a table keyed by game type gives only its own entries', () => {
    const table = { 'tic-tac-toe': 1 } as Record<string, number>;
    expect(ownEntry(table, 'tic-tac-toe')).toBe(1);
    for (const gt of ODD) expect(ownEntry(table, gt), String(gt)).toBeNull();
  });

  it('no screen prints a game’s type itself any more', () => {
    // The banner did, title-casing it: `gameType.replace(/-/g, ' ')…`. Any `.gameType.replace(`
    // in the app is the same render coming back.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== 'warlord' && f !== 'node_modules') walk(p); continue; }
        if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        if (/gameType\s*\.\s*replace\s*\(/.test(readFileSync(p, 'utf8'))) found.push(p);
      }
    };
    walk('src');
    expect(found).toEqual([]);
  });

  it('the arcade looks a game’s rules up through ownEntry, never by indexing the table', () => {
    // `gameRules['constructor']` is the Object function, and its `.rules.map` crashed the sheet.
    const hub = readFileSync('src/components/games/GamesHubModal.tsx', 'utf8');
    expect(hub).toContain('ownEntry(gameRules, showRulesFor)');
    expect(hub).not.toMatch(/gameRules\s*\[/);
  });
});

describe('who the banner shows as playing', () => {
  it('the seats of a tic-tac-toe game and the players of a rummy game, as before', () => {
    expect(bannerPlayerIds({ gameType: 'tic-tac-toe', state: { players: { X: 'a', O: null } } })).toEqual(['a']);
    expect(bannerPlayerIds({ gameType: 'tic-tac-toe', state: { players: { X: 'a', O: 'b' } } })).toEqual(['a', 'b']);
    expect(bannerPlayerIds({ gameType: 'rummy-45', state: { playerIds: ['a', 'b'] } })).toEqual(['a', 'b']);
    expect(bannerPlayerIds({ gameType: 'connect-4', state: { players: { P1: 'a' } } })).toEqual([]);
  });

  it('whatever the document holds, a list of uids and never a crash', () => {
    for (const state of [undefined, null, 'x', 5, [], {}, { playerIds: 'x' }, { playerIds: { 0: 'a' } }, { players: 'x' }]) {
      for (const gameType of ['tic-tac-toe', 'rummy-45', 42]) {
        expect(bannerPlayerIds({ gameType, state }), `${gameType} ${JSON.stringify(state)}`).toEqual([]);
      }
    }
    expect(bannerPlayerIds({ gameType: 'rummy-45', state: { playerIds: ['a', 7, null, { x: 1 }, '', 'b'] } })).toEqual(['a', 'b']);
    expect(bannerPlayerIds({ gameType: 'tic-tac-toe', state: { players: { X: { uid: 'a' }, O: 'b' } } })).toEqual(['b']);
    for (const g of [undefined, null, 'x']) expect(bannerPlayerIds(g)).toEqual([]);
  });

  it('the calendar\u2019s banner asks it, and reads no player field itself', () => {
    const home = readFileSync('src/screens/CalendarHome.tsx', 'utf8');
    expect(home).toContain('bannerPlayerIds(activeGames[0])');
    expect(home).not.toMatch(/state\?*\.playerIds/);
  });
});

describe('in a push', () => {
  it('every game has the name the server wrote before, and nothing else has one', () => {
    // What `gameType.replace(/-/g, ' ').replace(/\b\w/g, upper)` gave for each, by hand.
    expect(ARCADE_GAME_TYPES.map(gameTitleOf)).toEqual(['Tic Tac Toe', 'Connect 4', 'Rummy 45', 'Memory Match']);
    expect(gameTitleOf(SERVER_OWNED_GAME)).toBe('Warlord Battle');
    for (const gt of ODD) expect(gameTitleOf(gt), String(gt)).toBeNull();
  });
});
