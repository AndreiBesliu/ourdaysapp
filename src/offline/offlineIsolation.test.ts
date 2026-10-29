// src/offline/offlineIsolation.test.ts
//
// The offline Cards page must open in about a second with no network, so it may not depend on
// anything that waits for one: Firebase (Auth, App Check, Firestore), or the app's store, which
// pulls the rest of the app in. Held on the imports of every file it builds from, followed
// transitively inside src/.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const ENTRY = join(SRC, 'offline', 'main.tsx');
const FORBIDDEN = /^(firebase(\/|$)|@firebase\/|zustand$)/;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext) && !base.endsWith('.css')) return base + ext;
  }
  return null;
}

function graph() {
  const seen = new Set<string>();
  const externals = new Map<string, string[]>();
  const stack = [ENTRY];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/^\s*import\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      if (/^import\s+type\b/.test(m[0].trim())) continue; // erased at build
      if (spec.startsWith('.')) {
        if (spec.endsWith('.css')) continue;
        const r = resolveLocal(f, spec);
        if (r) stack.push(r);
      } else {
        externals.set(spec, [...(externals.get(spec) || []), f.slice(SRC.length + 1)]);
      }
    }
  }
  return { files: [...seen].map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/')), externals };
}

describe('the offline Cards page', () => {
  const { files, externals } = graph();

  it('walks the real graph (entry, the page, the shared renderer)', () => {
    expect(files).toContain('offline/OfflineCards.tsx');
    expect(files).toContain('components/AssetBarcode.tsx');
    expect(files).toContain('utils/offlineWallet.ts');
  });

  it('imports nothing from Firebase and not the app store', () => {
    const bad = [...externals.keys()].filter((s) => FORBIDDEN.test(s));
    expect(bad).toEqual([]);
    expect(files).not.toContain('firebase.ts');
    expect(files).not.toContain('store.ts');
    expect(files).not.toContain('reportError.ts');
  });

  it('draws codes only through AssetBarcode, like every other screen', () => {
    expect(readFileSync(join(SRC, 'offline', 'OfflineCards.tsx'), 'utf8')).toContain("import AssetBarcode from '../components/AssetBarcode';");
  });

  // The page's CSS is Tailwind built from vite.offline.config.ts's own `content` list, not the app's.
  // A file of the graph that is not on it keeps its class names and loses their rules: on 29.10.2026
  // the number of a code that cannot be drawn moved into CodeNumber.tsx and showed at body size, with
  // no wrap, on the page meant for the till (found by review; every markup test stayed green).
  it('every file of the page that styles something is on the offline Tailwind list', () => {
    const config = readFileSync(join(SRC, '..', 'vite.offline.config.ts'), 'utf8');
    const list = config.slice(config.indexOf('content: ['), config.indexOf(']', config.indexOf('content: [')));
    const globs = [...list.matchAll(/new URL\('\.\/src\/([^']+)'/g)].map((m) => m[1]);
    expect(globs.length).toBeGreaterThan(1);
    const covered = (f: string) => globs.some((g) => g.includes('**') ? f.startsWith(g.slice(0, g.indexOf('**'))) : f === g);
    const styling = files.filter((f) => /\.(tsx|html)$/.test(f) && /className=/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(styling).toContain('components/CodeNumber.tsx');
    expect(styling.filter((f) => !covered(f))).toEqual([]);
  });
});
