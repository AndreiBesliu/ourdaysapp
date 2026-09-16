// src/utils/arcadeWrites.test.ts
//
// Every write to a game document must record WHEN it happened.
//
// A source check, because the thing it protects has no runtime signal: a missed call site does not
// throw, does not render wrong, and does not fail a test. It writes a board update with no
// timestamp, the game keeps whatever moment it last had, and twenty-four hours later the sweep
// closes a game people are in the middle of playing. The only place that is visible is in the
// diff — so the diff is what gets checked.
//
// Twenty-six call sites across five files today. The number is not asserted; the absence of a
// bypass is.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const GAMES = join(process.cwd(), 'src', 'components', 'games');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(GAMES).map((p) => ({
  path: p.slice(GAMES.length + 1).split(sep).join('/'),
  text: readFileSync(p, 'utf8'),
}));

describe('the scan is looking at the arcade', () => {
  it('found the games and the one write path', () => {
    const paths = FILES.map((f) => f.path);
    expect(paths).toContain('gameWrite.ts');
    for (const game of ['TicTacToe.tsx', 'Connect4.tsx', 'MemoryMatch.tsx', 'GamesHubModal.tsx']) {
      expect(paths).toContain(game);
    }
    expect(paths).toContain('rummy/RummyGame.tsx');
  });
});

describe('nothing writes a game document behind the helper', () => {
  it('leaves every document update to gameWrite', () => {
    // Deliberately broader than "updateDoc(doc(db, 'games'…". The first version matched that one
    // spelling, which is not the rule it claimed to enforce: a bypass written with `setDoc`, or
    // with a ref built on a previous line, would have walked straight past it. Nothing in this
    // directory has any business updating a document itself, so that is what gets checked.
    // `addDoc` and `deleteDoc` are untouched — creating and deleting are not moves.
    const offenders = FILES
      .filter((f) => f.path !== 'gameWrite.ts')
      .filter((f) => /\b(updateDoc|setDoc)\s*\(/.test(f.text))
      .map((f) => f.path);
    expect(offenders, 'these bypass writeGame, so their moves record no time').toEqual([]);
  });

  it('and the helper is the only place that stamps the moment', () => {
    // Two writers of `lastMoveAt` would mean two answers to "when was this touched", and the
    // wrong one wins whenever both are in the same payload.
    const stampers = FILES.filter((f) => f.text.includes('lastMoveAt')).map((f) => f.path).sort();
    // GamesHubModal stamps it once more at CREATION, which is a create and not an update — the
    // sweep measures from the same field either way.
    expect(stampers).toEqual(['GamesHubModal.tsx', 'gameWrite.ts']);
  });

  it('the helper writes it last, so no caller can overrule it', () => {
    // Comments stripped first: the file EXPLAINS `lastMoveAt: serverTimestamp()` in its header,
    // and the first version of this check found that sentence and concluded the code was in the
    // wrong order. A check that reads prose is measuring the wrong file.
    const code = FILES.find((f) => f.path === 'gameWrite.ts')!.text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const spread = code.indexOf('...fields');
    const stamp = code.indexOf('lastMoveAt');
    expect(spread, 'the helper no longer spreads the caller fields').toBeGreaterThan(-1);
    expect(stamp, 'the helper no longer stamps the moment').toBeGreaterThan(-1);
    expect(stamp, 'a caller could overrule the timestamp').toBeGreaterThan(spread);
  });
});
