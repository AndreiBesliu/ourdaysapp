// src/utils/eventShapeServerCopy.test.ts
// The two copies of the event-shape module must not drift (08.10.2026).
//
// `src/utils/eventShape.ts` and `functions/src/eventShape.ts` are the same file twice, for the same
// reason as gameSession.ts: the app cannot import from the functions build and the functions build
// cannot import from `src/`. One side normalises what the screens show and limits the form; the other
// guards `createEventOverride`, which writes on the Admin SDK where the rules never look. If they
// disagreed, the form would send what the server refuses, or the server would write what the
// screens cannot show. Line endings are normalised, so a failure here is a real divergence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', '..');
const CLIENT = join(APP, 'src', 'utils', 'eventShape.ts');
const SERVER = join(APP, 'functions', 'src', 'eventShape.ts');

const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

describe('eventShape is byte-identical on both runtimes', () => {
  it('both files exist and are not empty', () => {
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
        `eventShape.ts has diverged at line ${i + 1}\n` +
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
