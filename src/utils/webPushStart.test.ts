// src/utils/webPushStart.test.ts
//
// The calendar's web push (07.11.2026), run with Firebase stood in for: nothing starts before Messaging's support is
// known, nothing at all where it is not supported (no prompt, no token, nothing reported: the APK's WebView and an
// iPhone's Safari used to file "Notification is not defined" on every mount), and the foreground handler is stopped by
// what it returns, even when that comes before the support check does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { uid: 'u1' } as { uid: string } | null,
  ready: { resolve: (_: unknown) => {}, promise: Promise.resolve<unknown>(null) },
  unsubscribe: vi.fn(),
  onMessage: vi.fn(),
  getToken: vi.fn(),
  updateDoc: vi.fn(),
  report: vi.fn(),
  remember: vi.fn(),
}));

vi.mock('../firebase', () => ({ auth: { get currentUser() { return h.user; } }, db: {} }));
vi.mock('../firebaseMessaging', () => ({ get messagingReady() { return h.ready.promise; } }));
vi.mock('firebase/messaging', () => ({ getToken: h.getToken, onMessage: h.onMessage }));
vi.mock('firebase/firestore', () => ({ doc: (...p: unknown[]) => p.join('/'), updateDoc: h.updateDoc, arrayUnion: (x: unknown) => ['union', x] }));
vi.mock('../reportError', () => ({ reportError: h.report }));
vi.mock('./pushRelease', () => ({ rememberPushToken: h.remember }));

import { startWebPush } from './webPushStart';

/** 65 bytes: 0x04 and two 32-byte coordinates, base64url, as a real key is (webPush.test.ts). */
const VALID_KEY = (() => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  for (let i = 1; i < 65; i++) bytes[i] = (i * 7) % 251;
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();

const FCM = { fcm: true };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

/** Messaging's support check, answered by the test. */
function support() {
  let resolve!: (v: unknown) => void;
  h.ready.promise = new Promise((r) => { resolve = r; });
  h.ready.resolve = resolve;
}

beforeEach(() => {
  h.user = { uid: 'u1' };
  support();
  h.onMessage.mockImplementation(() => h.unsubscribe);
  h.getToken.mockResolvedValue('token-1');
  h.updateDoc.mockResolvedValue(undefined);
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', VALID_KEY);
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { requestPermission, permission: 'granted' }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the calendar’s web push (utils/webPushStart.ts)', () => {
  it('signed out: nothing, and a stop that does nothing', async () => {
    h.user = null;
    const stop = startWebPush();
    h.ready.resolve(FCM);
    await flush();
    expect(h.onMessage).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('nothing before Messaging’s support is known', async () => {
    startWebPush();
    await flush();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it('supported: asks, registers the token on the account, remembers it, and handles foreground pushes; the stop stops them', async () => {
    const stop = startWebPush();
    h.ready.resolve(FCM);
    await flush();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(h.getToken).toHaveBeenCalledWith(FCM, { vapidKey: VALID_KEY });
    expect(h.updateDoc).toHaveBeenCalledWith(expect.anything(), { fcmTokens: ['union', 'token-1'] });
    expect(h.remember).toHaveBeenCalledWith('u1', 'token-1');
    expect(h.onMessage).toHaveBeenCalledWith(FCM, expect.any(Function));
    expect(h.report).not.toHaveBeenCalled();
    stop();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('not supported (the APK’s WebView, Safari outside an installed app): no prompt, no token, no handler, nothing reported', async () => {
    vi.stubGlobal('Notification', undefined);
    startWebPush();
    h.ready.resolve(null);
    await flush();
    expect(h.onMessage).not.toHaveBeenCalled();
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });

  it('stopped before the support check answers: nothing starts afterwards', async () => {
    const stop = startWebPush();
    stop();
    h.ready.resolve(FCM);
    await flush();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it('the key is checked before anybody is asked: a bad key is reported, and no prompt is spent on it', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'too-short');
    startWebPush();
    h.ready.resolve(FCM);
    await flush();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(expect.stringMatching(/^Web push is not configured: /), { context: 'fcm.token.web' });
  });

  it('a handler that cannot be registered is reported, not left as an unhandled rejection', async () => {
    h.onMessage.mockImplementation(() => { throw new Error('onMessage failed'); });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const stop = startWebPush();
      h.ready.resolve(FCM);
      await flush();
      expect(h.report).toHaveBeenCalledWith('onMessage failed', { context: 'fcm.start' });
      expect(unhandled).not.toHaveBeenCalled();
      expect(() => stop()).not.toThrow();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
