// vitest.config.ts
// The ordinary suite: fast, pure, and runnable anywhere.
//
// This file exists only to keep `rules-tests/` OUT of it. Those need a running Firestore
// emulator (and therefore a JDK), so a developer or a CI job without one must not see them fail —
// they run through `npm run test:rules`, which starts the emulator around them.
//
// The include pattern is Vitest's own default, written out. It was implicit before this file
// existed, so spelling it means the suite keeps collecting exactly what it always collected.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // functions/test runs callables against the emulator, under `npm run test:rules` only.
    exclude: ['**/node_modules/**', '**/dist/**', 'rules-tests/**', 'functions/test/**'],
  },
});
