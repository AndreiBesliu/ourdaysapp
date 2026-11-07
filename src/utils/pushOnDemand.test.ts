// src/utils/pushOnDemand.test.ts
//
// The calendar's web push, loaded on demand (07.11.2026): when its code is asked for, when it is started, what stops
// it, and what is reported when it cannot load. The code it loads is utils/webPushStart.ts (the old effect, moved).

import { describe, expect, it, vi } from 'vitest';
import { webPushOnDemand, type WebPushModule } from './pushOnDemand';
import type { OnlineEnv } from './routeWarmup';

/** A browser whose `online` event the test fires. */
function env(onLine: boolean | undefined) {
  const listeners = new Set<() => void>();
  const e: OnlineEnv & { fire(): void; listening(): number } = {
    onLine,
    addEventListener: ((type: string, fn: () => void) => { if (type === 'online') listeners.add(fn); }) as OnlineEnv['addEventListener'],
    removeEventListener: ((type: string, fn: () => void) => { if (type === 'online') listeners.delete(fn); }) as OnlineEnv['removeEventListener'],
    fire: () => { for (const fn of [...listeners]) fn(); },
    listening: () => listeners.size,
  };
  return e;
}

/** A module whose start the test watches: what it was asked, and whether its stop was called. */
function pushModule() {
  const stop = vi.fn();
  const startWebPush = vi.fn(() => stop);
  return { module: { startWebPush } as WebPushModule, startWebPush, stop };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the calendar’s web push, on demand', () => {
  it('online: asked for at once, started when it arrives, stopped when the calendar goes', async () => {
    const { module, startWebPush, stop } = pushModule();
    const load = vi.fn(() => Promise.resolve(module));
    const start = webPushOnDemand(load, vi.fn());
    const leave = start(env(true));
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(startWebPush).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    leave();
    expect(stop).toHaveBeenCalledTimes(1);
    leave();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('an unknown connection (no `navigator.onLine`) counts as online, as the warm-up does', async () => {
    const load = vi.fn(() => Promise.resolve(pushModule().module));
    webPushOnDemand(load, vi.fn())(env(undefined));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('offline: nothing fetched (Chromium would keep the failure); fetched and started when the browser is back online', async () => {
    const { module, startWebPush } = pushModule();
    const load = vi.fn(() => Promise.resolve(module));
    const browser = env(false);
    webPushOnDemand(load, vi.fn())(browser);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(browser.listening()).toBe(1);
    browser.fire();
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(startWebPush).toHaveBeenCalledTimes(1);
    expect(browser.listening()).toBe(0);
  });

  it('offline, and the calendar goes before the connection comes back: never fetched', async () => {
    const load = vi.fn(() => Promise.resolve(pushModule().module));
    const browser = env(false);
    const leave = webPushOnDemand(load, vi.fn())(browser);
    leave();
    expect(browser.listening()).toBe(0);
    browser.fire();
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it('the calendar goes while the code is on its way: it is not started when it arrives', async () => {
    const { module, startWebPush } = pushModule();
    let arrive!: (m: WebPushModule) => void;
    const load = vi.fn(() => new Promise<WebPushModule>((r) => { arrive = r; }));
    const leave = webPushOnDemand(load, vi.fn())(env(true));
    leave();
    arrive(module);
    await flush();
    expect(startWebPush).not.toHaveBeenCalled();
  });

  it('each mount starts it again, and each unmount stops its own (the old effect did the same on every mount)', async () => {
    const a = pushModule();
    const b = pushModule();
    const load = vi.fn().mockResolvedValueOnce(a.module).mockResolvedValueOnce(b.module);
    const start = webPushOnDemand(load, vi.fn());
    const leaveA = start(env(true));
    await flush();
    leaveA();
    const leaveB = start(env(true));
    await flush();
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.startWebPush).toHaveBeenCalledTimes(1);
    expect(b.stop).not.toHaveBeenCalled();
    leaveB();
    expect(b.stop).toHaveBeenCalledTimes(1);
  });

  it('a chunk that cannot load: reported once per page, as a stale chunk, however often the calendar mounts', async () => {
    const failure = new TypeError('Failed to fetch dynamically imported module: https://x/assets/webPushStart-OLD.js');
    const load = vi.fn(() => Promise.reject(failure));
    const report = vi.fn();
    const start = webPushOnDemand(load, report);
    start(env(true));
    await flush();
    start(env(true));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure.message, expect.objectContaining({ context: 'StaleChunk' }));
  });

  it('a load that fails after the calendar has gone is still reported (review of 07.11.2026)', async () => {
    let fail!: (e: unknown) => void;
    const report = vi.fn();
    const leave = webPushOnDemand(() => new Promise<WebPushModule>((_, r) => { fail = r; }), report)(env(true));
    leave();
    fail(new TypeError('Failed to fetch dynamically imported module: https://x/assets/webPushStart-OLD.js'));
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ context: 'StaleChunk' }));
  });

  it('any other load failure is reported as the push code’s, once', async () => {
    const report = vi.fn();
    const start = webPushOnDemand(() => Promise.reject(new Error('boom')), report);
    start(env(true));
    start(env(true));
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('boom', expect.objectContaining({ context: 'fcm.load' }));
  });

  it('a page is one reporter: another page (another instance) reports its own failure', async () => {
    const report = vi.fn();
    const failing = () => Promise.reject(new Error('boom'));
    webPushOnDemand(failing, report)(env(true));
    webPushOnDemand(failing, report)(env(true));
    await flush();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('a start that throws is reported, not left as an unhandled rejection; leaving after it is safe', async () => {
    const report = vi.fn();
    const startWebPush = vi.fn(() => { throw new Error('onMessage failed'); });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const leave = webPushOnDemand(() => Promise.resolve({ startWebPush }), report)(env(true));
      await flush();
      await flush();
      expect(report).toHaveBeenCalledWith('onMessage failed', expect.objectContaining({ context: 'fcm.start' }));
      expect(() => leave()).not.toThrow();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
