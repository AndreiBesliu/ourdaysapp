// src/utils/offlineStatus.test.ts — the Wallet's offline line (components/OfflineCardsStatus.tsx).
import { describe, it, expect } from 'vitest';
import { offlineStatus } from './offlineStatus';
import type { OfflineWallet } from './offlineWallet';

const copy = (uid: string, confirmedAt: number | null = 500): OfflineWallet =>
  ({ v: 1, uid, savedAt: 400, confirmedAt, pending: false, cards: [] });

describe('offlineStatus', () => {
  it('no service worker: nothing to say', () => {
    expect(offlineStatus(copy('me'), 'me', null, true)).toEqual({ kind: 'unsupported' });
  });
  it("ready only with THIS account's copy and the page stored", () => {
    expect(offlineStatus(copy('me'), 'me', true, true)).toEqual({ kind: 'ready', when: 500 });
    // Never confirmed by the server: ready, but with no "checked" time (the write time is not one).
    expect(offlineStatus(copy('me', null), 'me', true, false)).toEqual({ kind: 'ready', when: null });
    expect(offlineStatus(copy('other'), 'me', true, true)).toEqual({ kind: 'preparing' });
    expect(offlineStatus(copy('me'), 'me', false, true)).toEqual({ kind: 'preparing' });
    expect(offlineStatus(null, 'me', true, true)).toEqual({ kind: 'preparing' });
  });
  it('offline and not ready: needs a visit with a connection', () => {
    expect(offlineStatus(null, 'me', false, false)).toEqual({ kind: 'notReady' });
  });
});
