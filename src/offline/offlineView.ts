// src/offline/offlineView.ts
//
// What the offline Cards page shows, decided from the stored copy. Pure: no DOM, no storage.

import type { OfflineWallet } from '../utils/offlineWallet';

/** A copy not confirmed by the server for this long is shown in amber. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type BannerKind =
  /** No copy on this device at all. */
  | 'none'
  /** Confirmed by the server within STALE_AFTER_MS. */
  | 'fresh'
  /** Confirmed, but longer ago than that. */
  | 'stale'
  /** Written from this device's cache, never confirmed by the server. */
  | 'never';

export function bannerFor(w: OfflineWallet | null, now: number): BannerKind {
  if (!w) return 'none';
  if (w.confirmedAt === null) return 'never';
  return now - w.confirmedAt > STALE_AFTER_MS ? 'stale' : 'fresh';
}

export interface Row {
  id: string;
  name: string;
  shared: boolean;
  /** Has a code to show. A card without one (a document, a photo) cannot be opened here. */
  openable: boolean;
}

export function rowsFor(w: OfflineWallet | null, locale?: string): Row[] {
  if (!w) return [];
  return w.cards
    .map((c) => ({ id: c.id, name: c.name, shared: c.shared, openable: !!c.code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** A date and time for "checked with the server …", in the person's language. */
export function whenLabel(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}
