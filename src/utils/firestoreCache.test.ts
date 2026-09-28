// src/utils/firestoreCache.test.ts
//
// How Firestore is opened (src/firebase.ts): one instance, a persistent cache SHARED by every tab.
// Chosen by Andrei from the backlog, 28.09.2026. The behaviour was measured against the emulator with
// two real tabs and this very file, and could not be here (no browser, no IndexedDB in this suite):
//   * enableIndexedDbPersistence: the second tab logged "Falling back to memory cache", and a document
//     only the first tab had written was NOT in its cache (getDocFromCache → unavailable);
//   * the multi-tab manager: no warning, and the second tab found that document in its cache.
// What this suite holds is the configuration that produced the second result.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/firebase.ts'), 'utf8');

describe('src/firebase.ts', () => {
  it('opens Firestore with a persistent cache shared by every tab', () => {
    expect(src).toMatch(/export const db = initializeFirestore\(app, \{\s*localCache: persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\),\s*\}\);/);
  });

  it('no longer asks for the single-tab persistence, nor opens a default instance first', () => {
    expect(src).not.toMatch(/enableIndexedDbPersistence\(/);
    expect(src).not.toMatch(/enableMultiTabIndexedDbPersistence\(/);
    expect(src).not.toMatch(/getFirestore\(/);
  });
});

describe('the rest of the app', () => {
  // A second instance opened elsewhere with other settings would either throw ("already been
  // started") or quietly not share the cache. Everything imports `db` from src/firebase.ts.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(resolve(process.cwd(), 'src'));

  it('opens no other Firestore instance', () => {
    const offenders = files
      .filter((f) => !f.replace(/\\/g, '/').endsWith('/src/firebase.ts'))
      .filter((f) => /\b(getFirestore|initializeFirestore|enableIndexedDbPersistence|enableMultiTabIndexedDbPersistence)\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(100); // the walk really covered src/
  });
});
