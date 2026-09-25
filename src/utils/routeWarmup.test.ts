// src/utils/routeWarmup.test.ts
//
// The warm-up must never throw and never leave a rejection unhandled — vitest fails the run on an
// unhandled rejection, which is exactly what the app's error reporter would file as a crash.

import { describe, it, expect } from 'vitest';
import { warmRoutes } from './routeWarmup';

describe('warming lazy screens', () => {
  it('calls every loader once and swallows every kind of failure', async () => {
    const calls: string[] = [];
    await expect(warmRoutes([
      () => { calls.push('ok'); return Promise.resolve(1); },
      () => { calls.push('offline'); return Promise.reject(new Error('Failed to fetch dynamically imported module: x')); },
      () => { calls.push('sync'); throw new Error('sync'); },
    ])).resolves.toBeUndefined();
    expect(calls).toEqual(['ok', 'offline', 'sync']);
  });
});
