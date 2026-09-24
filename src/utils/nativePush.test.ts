// src/utils/nativePush.test.ts
//
// The order of native push registration. See nativePush.ts: `register()` fires the event, so
// whatever listens at that moment gets the token.
//
// The fake fires 'registration' INSIDE register(), before it returns — the worst timing the real
// plugin allows, and the one where the old order lost the token.

import { describe, it, expect } from 'vitest';
import { registerNativePush, type PushPlugin } from './nativePush';

function fakePlugin(granted = true) {
  const listeners = new Map<string, Array<(p: unknown) => void>>();
  const stale: string[] = [];
  // A listener left by an EARLIER sign-in on this phone, still holding that account.
  listeners.set('registration', [(p) => stale.push((p as { value: string }).value)]);
  let registered = 0;
  const plugin: PushPlugin = {
    requestPermissions: async () => ({ receive: granted ? 'granted' : 'denied' }),
    removeAllListeners: async () => { listeners.clear(); },
    addListener: async (event: string, fn: (p: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn as (p: unknown) => void]);
    },
    register: async () => {
      registered++;
      for (const fn of listeners.get('registration') ?? []) fn({ value: 'tok-new' });
    },
  };
  return { plugin, stale, registered: () => registered };
}

describe('native push registration', () => {
  it("hands the token to THIS sign-in, and not to the previous account's listener", async () => {
    const { plugin, stale } = fakePlugin();
    const got: string[] = [];
    expect(await registerNativePush(plugin, (t) => { got.push(t); })).toBe(true);
    expect(got).toEqual(['tok-new']);
    expect(stale).toEqual([]);
  });

  it('exactly once, however many sign-ins this phone has seen', async () => {
    const { plugin } = fakePlugin();
    const got: string[] = [];
    await registerNativePush(plugin, (t) => { got.push(`first ${t}`); });
    await registerNativePush(plugin, (t) => { got.push(`second ${t}`); });
    expect(got).toEqual(['first tok-new', 'second tok-new']);
  });

  it('does not register without permission', async () => {
    const { plugin, registered } = fakePlugin(false);
    expect(await registerNativePush(plugin, () => {})).toBe(false);
    expect(registered()).toBe(0);
  });
});
