// vitest.rules.config.ts
// The security-rules suite. Runs ONLY under `npm run test:rules`, which starts a Firestore
// emulator around it — these tests talk to a real rules engine, which is the entire point.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['rules-tests/**/*.test.ts'],
    // One emulator, one shared test environment: parallel files would fight over the same
    // project's documents and produce failures that depend on scheduling.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
