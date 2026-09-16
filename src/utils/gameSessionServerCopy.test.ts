// src/utils/gameSessionServerCopy.test.ts
// The two copies of the session module must not drift.
//
// `src/utils/gameSession.ts` and `functions/src/gameSession.ts` are the same file twice, for the
// same reason `eventTime` is: the app cannot import from the functions build and the functions
// build cannot import from `src/`, yet both have to answer "who won this session" identically.
// One side is a person pressing End; the other is the nightly sweep closing a forgotten game. If
// they disagreed, the same board would be banked to the leaderboard two different ways depending
// on who got there first.
//
// Same CRLF trap as the other copy guard: this checkout is Windows while the copy is written LF,
// so a raw comparison reports every line as different and teaches you to ignore the test. Line
// endings are normalised, so a failure here is always a real divergence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', '..');
const CLIENT = join(APP, 'src', 'utils', 'gameSession.ts');
const SERVER = join(APP, 'functions', 'src', 'gameSession.ts');

const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

describe('gameSession is byte-identical on both runtimes', () => {
  it('both files exist and are not empty', () => {
    // A failure to read would otherwise compare two empty strings and pass.
    expect(readFileSync(CLIENT, 'utf8').length).toBeGreaterThan(2000);
    expect(readFileSync(SERVER, 'utf8').length).toBeGreaterThan(2000);
  });

  it('they are the same file, ignoring only line endings', () => {
    const a = normalise(readFileSync(CLIENT, 'utf8'));
    const b = normalise(readFileSync(SERVER, 'utf8'));
    if (a !== b) {
      const la = a.split('\n');
      const lb = b.split('\n');
      const i = la.findIndex((line, n) => line !== lb[n]);
      throw new Error(
        `gameSession.ts has diverged at line ${i + 1}\n` +
        `  src/utils:      ${JSON.stringify(la[i])}\n` +
        `  functions/src:  ${JSON.stringify(lb[i])}\n` +
        'Copy the client file over the server one; the client is the source.',
      );
    }
    expect(a).toBe(b);
  });

  it('the server copy pulls in nothing a Cloud Function lacks', () => {
    const b = readFileSync(SERVER, 'utf8');
    expect(b).not.toMatch(/^import /m);
    for (const browserOnly of ['window.', 'document.', 'localStorage', 'navigator.']) {
      expect(b, `${browserOnly} cannot run in a Cloud Function`).not.toContain(browserOnly);
    }
  });
});
