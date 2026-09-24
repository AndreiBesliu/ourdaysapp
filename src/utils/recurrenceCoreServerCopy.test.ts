// src/utils/recurrenceCoreServerCopy.test.ts
// The two copies of the recurrence core must not drift.
//
// `src/utils/recurrenceCore.ts` and `functions/src/recurrenceCore.ts` are the same file twice, for
// the same reason as `eventTime`: the calendar and the server each need it and neither can import
// the other. Until 24.09.2026 they were two DIFFERENT implementations, and a series had one set of
// dates on screen and another in the reminders — see the header of recurrenceCore.ts. Line endings
// are normalised so a failure here is always a real divergence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..', '..');
const CLIENT = join(APP, 'src', 'utils', 'recurrenceCore.ts');
const SERVER = join(APP, 'functions', 'src', 'recurrenceCore.ts');

const normalise = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

describe('recurrenceCore is byte-identical on both runtimes', () => {
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
        `recurrenceCore.ts has diverged at line ${i + 1}\n` +
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
