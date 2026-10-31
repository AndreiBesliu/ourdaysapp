// src/utils/functionsRegion.test.ts — where the web app calls the functions (31.10.2026).
//
// The functions run in europe-central2, next to the database; the callables also keep a copy in us-central1 for
// the installed APK. Where each one deploys is held on the compiled endpoints, in functions/test/regions.test.ts.
// This half is the client: every getFunctions call in the app names FUNCTIONS_REGION. `getFunctions(app)` means
// us-central1 — it works while the US copies exist, and breaks for every web user the day they are deleted.
//
// Every source file under src/, not a list: the first version read four named files, and a fifth module would
// have passed it (review of 31.10.2026).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('the web app', () => {
  it('calls the functions in europe-central2, through one constant', () => {
    expect(readFileSync('src/firebase.ts', 'utf8')).toContain("export const FUNCTIONS_REGION = 'europe-central2';");
  });

  it('every getFunctions call in src/ names FUNCTIONS_REGION', () => {
    const callers = sources('src')
      .map((f) => ({ f, src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => src.includes('getFunctions('));
    // The four that call functions on 31.10.2026: ai, notifications, reportError, serverActions.
    expect(callers.length).toBeGreaterThanOrEqual(4);
    const wrong = callers.flatMap(({ f, src }) => {
      const all = src.match(/getFunctions\(/g)?.length ?? 0;
      const right = src.match(/getFunctions\(app, FUNCTIONS_REGION\)/g)?.length ?? 0;
      return all === right ? [] : [`${f}: ${all - right} of ${all}`];
    });
    expect(wrong).toEqual([]);
  });
});
