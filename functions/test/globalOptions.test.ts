// functions/test/globalOptions.test.ts
//
// Every function this codebase deploys carries the instance ceiling. Read off `__endpoint` — the
// description the Firebase CLI deploys from — not off the source text.
//
// The previous check was a regex that found `setGlobalOptions({ maxInstances: 10 })` in index.ts.
// It was green while 10 of the 51 functions deployed WITHOUT a ceiling: the call ran after the
// modules that define them had already been loaded, and v6 reads the global options when a
// function is defined. On those ten, `maxInstances` is not missing but a reset marker — which is
// why this compares with `toBe`, not with "is present".
//
// It loads the COMPILED `lib/index.js` with Node's own `require`, as the CLI does. Importing the
// TypeScript source through vitest does not work for this: its transform hoists every import above
// the re-exports, so the options run first whatever the source order — measured, with the call
// moved back below the re-exports, the source-level version stayed green. CI rebuilds `lib/` and
// fails when it differs from the committed one, so the file read here is the one that deploys.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const LIB = resolve(process.cwd(), 'functions/lib');

describe('the instance ceiling', () => {
  it('is on every function the deploy would read', () => {
    // index.js FIRST. Loading globalOptions.js to read the constant would itself set the options
    // before index.js runs — the first version of this test did, and stayed green on the defect.
    const mod = require(resolve(LIB, 'index.js')) as Record<string, unknown>;
    const { MAX_INSTANCES } = require(resolve(LIB, 'globalOptions.js')) as { MAX_INSTANCES: number };
    const fns = Object.entries(mod).filter(
      ([, v]) => typeof v === 'function' && (v as { __endpoint?: unknown }).__endpoint,
    ) as [string, { __endpoint: { maxInstances?: unknown } }][];
    // A floor, so a load that silently yielded nothing cannot pass. 51 on 24.09.2026.
    expect(fns.length).toBeGreaterThanOrEqual(51);
    const uncapped = fns.filter(([, f]) => f.__endpoint.maxInstances !== MAX_INSTANCES).map(([k]) => k);
    expect(uncapped).toEqual([]);
  });
});
