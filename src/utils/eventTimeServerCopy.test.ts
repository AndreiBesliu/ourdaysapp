// src/utils/eventTimeServerCopy.test.ts
// The two copies of the time module must not drift.
//
// `src/utils/eventTime.ts` and `functions/src/eventTime.ts` are the same file twice. They have to
// be: the app cannot import from the functions build at runtime and the functions build cannot
// import from `src/`, and BOTH have to answer "when does this event actually start" identically —
// the client to draw the clock, the schedule to fire the reminder.
//
// Exactly the situation `warlordServerCopy.test.ts` already guards for the combat engine, and the
// same trap applies: this checkout is Windows (CRLF) while the copy is written LF, so a raw
// comparison reports a difference on every single line and teaches you to ignore it. Line endings
// are normalised so a failure here is always a real divergence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', '..');
const CLIENT = join(APP, 'src', 'utils', 'eventTime.ts');
const SERVER = join(APP, 'functions', 'src', 'eventTime.ts');

const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

describe('eventTime is byte-identical on both runtimes', () => {
  it('both files exist and are not empty', () => {
    // A failure to read would otherwise compare two empty strings and pass.
    expect(readFileSync(CLIENT, 'utf8').length).toBeGreaterThan(2000);
    expect(readFileSync(SERVER, 'utf8').length).toBeGreaterThan(2000);
  });

  it('they are the same file, ignoring only line endings', () => {
    const a = normalise(readFileSync(CLIENT, 'utf8'));
    const b = normalise(readFileSync(SERVER, 'utf8'));
    if (a !== b) {
      // Name the first differing line: "the files differ" is not an actionable failure.
      const la = a.split('\n');
      const lb = b.split('\n');
      const i = la.findIndex((line, n) => line !== lb[n]);
      throw new Error(
        `eventTime.ts has diverged at line ${i + 1}\n` +
        `  src/utils:      ${JSON.stringify(la[i])}\n` +
        `  functions/src:  ${JSON.stringify(lb[i])}\n` +
        'Copy the client file over the server one; the client is the source.',
      );
    }
    expect(a).toBe(b);
  });

  it('the server copy pulls in nothing a Cloud Function lacks', () => {
    // It is pure on purpose. An import of React, or of anything under `src/`, would compile in the
    // app and fail only at deploy time.
    const b = readFileSync(SERVER, 'utf8');
    expect(b).not.toMatch(/^import /m);
    for (const browserOnly of ['window.', 'document.', 'localStorage', 'navigator.']) {
      expect(b, `${browserOnly} cannot run in a Cloud Function`).not.toContain(browserOnly);
    }
  });
});
