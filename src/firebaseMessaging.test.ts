// src/firebaseMessaging.test.ts
//
// Messaging is made only where web push can work (review of 07.11.2026). `getMessaging` checks support by itself, in a
// promise nobody can catch: on a browser without push (the APK's WebView, an iPhone's Safari outside an installed app)
// that rejection, now that Messaging loads after sign-in, would file an error row on every visit. So the SDK's own check
// comes first, and those browsers get null.

import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isSupported: vi.fn<() => Promise<boolean>>(),
  getMessaging: vi.fn(),
  report: vi.fn(),
}));
vi.mock('firebase/messaging', () => ({ isSupported: h.isSupported, getMessaging: h.getMessaging }));
vi.mock('./firebase', () => ({ app: { name: '[DEFAULT]' } }));
vi.mock('./reportError', () => ({ reportError: h.report }));

/** The module afresh: its promise is made when it is first imported. Wrapped, or `await` would wait for it too. */
async function load(withWindow = true) {
  vi.resetModules();
  if (withWindow) vi.stubGlobal('window', globalThis);
  return { ready: (await import('./firebaseMessaging')).messagingReady };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('messagingReady', () => {
  it('supported: Messaging, made from the app, and only after the check said so', async () => {
    let answer!: (ok: boolean) => void;
    h.isSupported.mockReturnValue(new Promise((r) => { answer = r; }));
    h.getMessaging.mockReturnValue({ messaging: true });
    const { ready } = await load();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getMessaging).not.toHaveBeenCalled();
    answer(true);
    expect(await ready).toEqual({ messaging: true });
    expect(h.getMessaging).toHaveBeenCalledWith({ name: '[DEFAULT]' });
  });

  it('not supported: null, and getMessaging is never called (so its own check never rejects behind our back)', async () => {
    h.isSupported.mockResolvedValue(false);
    expect(await (await load()).ready).toBeNull();
    expect(h.getMessaging).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });

  it('supported, but Messaging cannot be made: reported, and null — never a rejection', async () => {
    h.isSupported.mockResolvedValue(true);
    h.getMessaging.mockImplementation(() => { throw new TypeError('no service worker container'); });
    expect(await (await load()).ready).toBeNull();
    expect(h.report).toHaveBeenCalledWith('no service worker container', expect.objectContaining({ context: 'fcm.init' }));
  });

  it('no window (a server render, a test): null, without asking anything', async () => {
    expect(await (await load(false)).ready).toBeNull();
    expect(h.isSupported).not.toHaveBeenCalled();
  });
});
