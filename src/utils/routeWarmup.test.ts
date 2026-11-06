// src/utils/routeWarmup.test.ts
//
// The warm-up must never throw and never leave a rejection unhandled — vitest fails the run on an
// unhandled rejection, which is exactly what the app's error reporter would file as a crash.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserOnline, warmRoutes, whenOnline } from './routeWarmup';

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

describe('warming only while online (06.11.2026)', () => {
  function fakeWindow(onLine: boolean | undefined) {
    const listeners = new Set<() => void>();
    return {
      env: {
        onLine,
        addEventListener: ((type: string, fn: () => void) => { if (type === 'online') listeners.add(fn); }) as Window['addEventListener'],
        removeEventListener: ((type: string, fn: () => void) => { if (type === 'online') listeners.delete(fn); }) as Window['removeEventListener'],
      },
      goOnline: () => { for (const fn of [...listeners]) fn(); },
      listeners,
    };
  }

  it('online, or not said: now', () => {
    for (const onLine of [true, undefined]) {
      const w = fakeWindow(onLine);
      let runs = 0;
      whenOnline(() => { runs++; }, w.env);
      expect(runs, String(onLine)).toBe(1);
      expect(w.listeners.size).toBe(0);
    }
  });

  it('offline: not now; once the connection is back, once, and the listener goes', () => {
    const w = fakeWindow(false);
    let runs = 0;
    whenOnline(() => { runs++; }, w.env);
    expect(runs).toBe(0);
    w.goOnline();
    expect(runs).toBe(1);
    expect(w.listeners.size).toBe(0);
    w.goOnline();
    expect(runs).toBe(1);
  });

  it('stopped while waiting (signed out, or the app closed): never', () => {
    const w = fakeWindow(false);
    let runs = 0;
    const stop = whenOnline(() => { runs++; }, w.env);
    stop();
    w.goOnline();
    expect(runs).toBe(0);
    expect(w.listeners.size).toBe(0);
  });
});

describe('browserOnline: the browser, read when asked', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says what navigator says, at the moment it is asked', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(browserOnline().onLine).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect(browserOnline().onLine).toBe(true);
  });

  it('listens on the window it finds when it listens', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
    const env = browserOnline();
    const fn = () => {};
    env.addEventListener('online', fn);
    env.removeEventListener('online', fn);
    expect(add).toHaveBeenCalledWith('online', fn);
    expect(remove).toHaveBeenCalledWith('online', fn);
  });
});
