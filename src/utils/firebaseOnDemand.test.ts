// src/utils/firebaseOnDemand.test.ts
//
// Firebase Storage and Messaging left the chunk every person loads at boot on 07.11.2026 (~44 kB, BACKLOG "Bundle-ul").
// The real build is judged by scripts/check-split.mjs (each SDK's host as a marker, and the push code as a dynamic
// entry); what is pinned here is the source that keeps them out: who may import them, and how the calendar reaches push.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAZY_SCREENS } from '../../scripts/bundleSplit.mjs';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** Every source file under src/, tests aside, with forward slashes. */
function sources(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(p) && !/\.test\.|\.d\.ts$/.test(p) ? [p.replace(/\\/g, '/')] : [];
  });
}

/**
 * A specifier as the bundler resolves it, for comparing: without a `.ts`/`.tsx`/`.js` ending (this repo allows
 * `allowImportingTsExtensions`; src/main.tsx writes './App.tsx'), and `@firebase/x` as `firebase/x`, the package
 * `firebase/x` re-exports (review of 07.11.2026: the first form of this test missed both).
 */
const resolvedAs = (spec: string) => spec.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/^@firebase\//, 'firebase/');

/** What a file imports statically (`import type` and type-only re-exports aside: they leave no code), resolved. */
function staticImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) out.push(resolvedAs(m[1]));
  return out;
}

/** What a file imports dynamically, `import('…')`, resolved. */
function dynamicImports(src: string): string[] {
  return [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => resolvedAs(m[1]));
}

/** The files whose static imports end in one of `targets` (a module path's last segment, or a package). */
function importersOf(targets: RegExp): string[] {
  return sources().filter((f) => staticImports(read(f)).some((spec) => targets.test(spec))).sort();
}

describe('Firebase Storage and Messaging are not loaded at boot (07.11.2026)', () => {
  it('src/firebase.ts, which boot imports, imports and exports neither', () => {
    const firebase = read('src/firebase.ts');
    expect(staticImports(firebase)).not.toContain('firebase/storage');
    expect(staticImports(firebase)).not.toContain('firebase/messaging');
    expect(firebase).not.toMatch(/export const (storage|messaging)\b/);
  });

  it('only these import the Storage SDK, or the instance made from it', () => {
    expect(importersOf(/^firebase\/storage$/)).toEqual(['src/firebaseStorage.ts', 'src/screens/Wallet.tsx', 'src/utils/uploadFile.ts']);
    expect(importersOf(/\/firebaseStorage$/)).toEqual(['src/screens/Wallet.tsx', 'src/utils/uploadFile.ts']);
  });

  it('only these import the Messaging SDK, or the instance made from it', () => {
    expect(importersOf(/^firebase\/messaging$/)).toEqual(['src/firebaseMessaging.ts', 'src/screens/Settings.tsx', 'src/utils/webPushStart.ts']);
    expect(importersOf(/\/firebaseMessaging$/)).toEqual(['src/screens/Settings.tsx', 'src/utils/webPushStart.ts']);
  });

  it('and each of those is itself reached only on demand: every importer of the upload helper is a part loaded lazily', () => {
    const importers = importersOf(/\/uploadFile$/);
    expect(importers.length).toBeGreaterThanOrEqual(4);
    for (const f of importers) expect(LAZY_SCREENS, f).toContain(f);
    for (const f of ['src/screens/Wallet.tsx', 'src/screens/Settings.tsx', 'src/utils/webPushStart.ts']) expect(LAZY_SCREENS, f).toContain(f);
  });

  it('the push code is reached only through its loader, never imported statically', () => {
    expect(importersOf(/\/webPushStart$/)).toEqual([]);
    expect(read('src/utils/lazyParts.ts')).toContain("export const loadWebPushStart = () => import('./webPushStart');");
  });

  it('nothing else asks for them dynamically, and only the calendar calls the push loader (not the login page, not boot)', () => {
    const asking = (target: RegExp) => sources().filter((f) => dynamicImports(read(f)).some((spec) => target.test(spec))).sort();
    expect(asking(/\/webPushStart$/)).toEqual(['src/utils/lazyParts.ts']);
    expect(asking(/\/(?:firebaseStorage|firebaseMessaging)$|^firebase\/(?:storage|messaging)$/)).toEqual([]);
    expect(sources().filter((f) => /\bloadWebPushStart\b/.test(read(f))).sort())
      .toEqual(['src/screens/CalendarHome.tsx', 'src/utils/lazyParts.ts']);
  });

  it('the scanner sees the forms it must (a `.ts` ending, `@firebase/`, several names, a bare side-effect import)', () => {
    expect(staticImports([
      "import { messaging } from '../firebaseMessaging.ts';",
      "import { ref } from '@firebase/storage';",
      "import a, { b } from './uploadFile.js';",
      "import 'firebase/messaging';",
      "export { storage } from './firebaseStorage';",
      "import type { Messaging } from 'firebase/messaging';",
    ].join('\n'))).toEqual(['../firebaseMessaging', 'firebase/storage', './uploadFile', 'firebase/messaging', './firebaseStorage']);
  });
});

describe('the calendar starts push through the on-demand loader', () => {
  const HOME = read('src/screens/CalendarHome.tsx');

  it('one starter per page, made from the loader and the reporter', () => {
    expect(HOME).toContain('const startWebPushWhenOnline = webPushOnDemand(loadWebPushStart, reportError);');
  });

  it('started on mount when signed in, with the browser’s connection; what it returns is the cleanup', () => {
    expect(HOME).toMatch(/useEffect\(\(\) => \{\n\s+if \(!auth\.currentUser\) return;\n\s+return startWebPushWhenOnline\(browserOnline\(\)\);\n\s+\}, \[\]\);/);
    expect(HOME).not.toMatch(/Notification\.requestPermission|getToken\(|onMessage\(/);
  });

  it('sign-out deletes the web token only where Messaging could be made (src/firebaseMessaging.ts, review of 07.11.2026)', () => {
    const settings = read('src/screens/Settings.tsx');
    expect(settings).toMatch(/const messaging = await messagingReady;\n\s+if \(messaging\) await deleteToken\(messaging\);/);
    expect(settings).not.toMatch(/\bgetMessaging\(/);
  });

  it('the moved code still checks the key before it asks for permission', () => {
    // The code, not the header (which names the call it no longer makes where push cannot work). Run in webPushStart.test.ts.
    const push = read('src/utils/webPushStart.ts').split('function startWith(')[1] ?? '';
    const key = push.indexOf('vapidKeyProblem(import.meta.env.VITE_FIREBASE_VAPID_KEY)');
    const ask = push.indexOf('Notification.requestPermission()');
    expect(key).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(key);
    // And still remembers the token for sign-out, and shows foreground pushes through the FCM worker's scope.
    expect(push).toContain('rememberPushToken(auth.currentUser!.uid, token);');
    expect(push).toContain("sw.getRegistration('/firebase-cloud-messaging-push-scope')");
  });
});
