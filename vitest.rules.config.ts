// vitest.rules.config.ts
// The security-rules suite. Runs ONLY under `npm run test:rules`, which starts a Firestore
// emulator around it — these tests talk to a real rules engine, which is the entire point.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // functions/test: callables, run through their real handlers on the same emulator. They live
    // there so `firebase-admin` resolves to functions' own copy — the one the handler uses.
    include: ['rules-tests/**/*.test.ts', 'functions/test/**/*.test.ts'],
    // One emulator, one shared test environment: parallel files would fight over the same
    // project's documents and produce failures that depend on scheduling.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
