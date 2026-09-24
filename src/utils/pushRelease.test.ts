// src/utils/pushRelease.test.ts
//
// Sign-out was a bare `signOut`, so a shared device kept receiving the leaver's pushes and, after
// the next sign-in, delivered two accounts' notifications to whoever held it. See pushRelease.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  releasePushThenSignOut, rememberPushToken, rememberedPushToken, forgetPushToken,
  type ReleaseSteps,
} from './pushRelease';

function fakeSteps(over: Partial<ReleaseSteps> = {}) {
  const calls: string[] = [];
  const reported: string[] = [];
  const steps: ReleaseSteps = {
    uid: 'uid-a',
    remembered: { uid: 'uid-a', token: 'tok-1' },
    removeFromAccount: async (uid, token) => { calls.push(`remove ${uid} ${token}`); },
    invalidateOnDevice: async () => { calls.push('invalidate'); },
    signOut: async () => { calls.push('signOut'); },
    report: (_e, ctx) => { reported.push(ctx); },
    ...over,
  };
  return { steps, calls, reported };
}

describe('the order', () => {
  it('removes the token, invalidates it, THEN signs out', async () => {
    // After signOut the account write is refused — users/{uid} is owner-only and there is no
    // owner any more. So the removal has to come first or it cannot happen at all.
    const { steps, calls } = fakeSteps();
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['remove uid-a tok-1', 'invalidate', 'signOut']);
  });
});

describe('failures never keep somebody signed in', () => {
  it('still invalidates and signs out when the account write fails', async () => {
    const { steps, calls, reported } = fakeSteps({
      removeFromAccount: async () => { throw new Error('offline'); },
    });
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['invalidate', 'signOut']);
    expect(reported).toEqual(['push.release.account']);
  });

  it('still signs out when the device step fails too', async () => {
    const { steps, calls, reported } = fakeSteps({
      removeFromAccount: async () => { throw new Error('offline'); },
      invalidateOnDevice: async () => { throw new Error('no sw'); },
    });
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['signOut']);
    expect(reported).toEqual(['push.release.account', 'push.release.device']);
  });
});

describe('offline, where a write neither succeeds nor fails', () => {
  it('still signs out when the account write never settles', async () => {
    // What `updateDoc` actually does offline: queue, and leave its promise pending until the
    // connection returns. The first version awaited it and never signed anybody out.
    const never = () => new Promise<void>(() => {});
    const { steps, calls, reported } = fakeSteps({ removeFromAccount: never, invalidateOnDevice: never, stepTimeoutMs: 20 });
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['signOut']);
    expect(reported).toEqual(['push.release.account', 'push.release.device']);
  });
});

describe('whose token it is', () => {
  it('invalidates on the device even when nothing was remembered', async () => {
    // A token registered before this existed was never remembered. Invalidating it is what stops
    // delivery; the server prunes a refused token from every account that still lists it.
    const { steps, calls } = fakeSteps({ remembered: null });
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['invalidate', 'signOut']);
  });

  it('does not touch a token this device remembered for SOMEBODY ELSE', async () => {
    const { steps, calls } = fakeSteps({ remembered: { uid: 'uid-b', token: 'tok-b' } });
    await releasePushThenSignOut(steps);
    expect(calls).toEqual(['invalidate', 'signOut']);
  });
});

describe('remembering', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } as Storage;
  });

  it('keeps which token was registered for whom, and forgets it', () => {
    rememberPushToken('uid-a', 'tok-1');
    expect(rememberedPushToken()).toEqual({ uid: 'uid-a', token: 'tok-1' });
    forgetPushToken();
    expect(rememberedPushToken()).toBeNull();
  });

  it('forgets as part of signing out, so the next person does not inherit it', async () => {
    rememberPushToken('uid-a', 'tok-1');
    const { steps } = fakeSteps();
    await releasePushThenSignOut(steps);
    expect(rememberedPushToken()).toBeNull();
  });

  it('refuses nonsense rather than remembering it', () => {
    rememberPushToken('', 'tok');
    expect(rememberedPushToken()).toBeNull();
    localStorage.setItem('ourDays_pushToken', '{"uid":7}');
    expect(rememberedPushToken()).toBeNull();
    localStorage.setItem('ourDays_pushToken', 'not json');
    expect(rememberedPushToken()).toBeNull();
  });
});
