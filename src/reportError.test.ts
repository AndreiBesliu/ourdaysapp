// src/reportError.test.ts
//
// What the two global handlers send when something unhandled happens. `String(reason)` turned
// every thrown object into "[object Object]", and a window error with no message was logged as the
// word "window.onerror" — both now say what was thrown (utils/describeThrown.ts). The browser's own
// message still wins where it has one, because the groups already logged are keyed on it.
//
// No DOM here: `window` is a stand-in that records the listeners, and the callable is a spy.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const sent: Array<{ message: string; stack: string | null; url: string | null; context: string | null }> = [];
vi.mock('./firebase', () => ({ app: {}, auth: { currentUser: { uid: 'uid-test' } } }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => (payload: (typeof sent)[number]) => { sent.push(payload); return Promise.resolve(); },
}));

const handlers: Record<string, (e: unknown) => void> = {};

beforeAll(async () => {
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, h: (e: unknown) => void) => { handlers[type] = h; },
    location: { pathname: '/wallet' },
  };
  const { installGlobalErrorHandlers } = await import('./reportError');
  installGlobalErrorHandlers();
});

beforeEach(() => { sent.length = 0; });

describe('unhandledrejection', () => {
  it('an object reason is described, not "[object Object]"', () => {
    handlers.unhandledrejection({ reason: { code: 'permission-denied', where: 'assets' } });
    expect(sent).toHaveLength(1);
    expect(sent[0].message).not.toBe('[object Object]');
    expect(sent[0].message).toContain('permission-denied');
    expect(sent[0]).toMatchObject({ context: 'unhandledrejection', url: '/wallet' });
  });

  it('an Error reason is reported as before: its message and its stack', () => {
    const e = new Error('Missing or insufficient permissions.');
    handlers.unhandledrejection({ reason: e });
    expect(sent[0]).toMatchObject({ message: 'Missing or insufficient permissions.', stack: e.stack });
  });

  it('a string reason keeps its old form — the string itself', () => {
    handlers.unhandledrejection({ reason: 'network down' });
    expect(sent[0].message).toBe('network down');
  });
});

describe('window error', () => {
  it("the browser's message wins where there is one", () => {
    handlers.error({ message: 'Uncaught TypeError: t is not a function', error: new TypeError('t is not a function') });
    expect(sent[0].message).toBe('Uncaught TypeError: t is not a function');
    expect(sent[0].context).toBe('window.onerror');
  });

  it('with no message, the thrown value speaks — not the word "window.onerror"', () => {
    handlers.error({ message: '', error: 'Script error in the scanner' });
    expect(sent[0].message).toBe('Script error in the scanner');
  });
});
