// src/utils/offlineStatus.ts
//
// What the Wallet's offline line says (components/OfflineCardsStatus.tsx). Pure.

import type { OfflineWallet } from './offlineWallet';

export type OfflineStatus =
  /** No service worker here: nothing to say. */
  | { kind: 'unsupported' }
  /**
   * This account's copy and the page are both here. `when`: the last time the server confirmed the copy,
   * or null when it never has (written from this browser's cache only) — the line then must not say
   * "checked" (review, 28.09.2026).
   */
  | { kind: 'ready'; when: number | null }
  /** Online, one half still missing: it is being put in place. */
  | { kind: 'preparing' }
  /** Offline and not ready: it needs one visit with a connection. */
  | { kind: 'notReady' };

export function offlineStatus(
  copy: OfflineWallet | null,
  uid: string | null,
  pageStored: boolean | null,
  online: boolean,
): OfflineStatus {
  if (pageStored === null) return { kind: 'unsupported' };
  if (pageStored && copy && uid && copy.uid === uid) return { kind: 'ready', when: copy.confirmedAt };
  return online ? { kind: 'preparing' } : { kind: 'notReady' };
}
