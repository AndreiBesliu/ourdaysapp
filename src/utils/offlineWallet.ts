// src/utils/offlineWallet.ts
//
// The copy of the Wallet's cards that the offline "Cards" page reads when there is no network.
// Pure: no Firebase, no React. The writer is offlineWalletSync.ts; the reader is src/offline/.
//
// ── Why a copy at all (Andrei, 28.09.2026) ─────────────────────────────────────────────────
//
// "codurile de bare și QR vreau sa fie disponibile offline, dar sa se faca sync la modificari".
// The app does not open offline (public/sw.js explains why its document is never cached), so the
// codes are shown by a separate, self-contained page. That page has no Firebase and no sign-in,
// so it needs the cards somewhere it can read them: this copy, in localStorage.
//
// ── What is in it, and what is deliberately not ──────────────────────────────────────────────
//
// A WHITELIST: id, name, the code and its format, and whether the card came from somebody else.
// No photo URL (a Storage download URL is a bearer token), no owner id, no category, no group id.
// The code and format travel together and untouched, so the page draws exactly what the Wallet
// draws (utils/barcodeFormat.ts decides, through AssetBarcode).
//
// ── When it may be rewritten ────────────────────────────────────────────────────────────────
//
// `nextSnapshot` is the only gate, and it is cautious in one direction: a copy that is good must
// never be replaced by an answer that is worse. So a listener that errored, an answer still
// missing a group, or an EMPTY answer that only came from the local cache never overwrite a copy.
// A complete answer confirmed by the server replaces it whole — that is how an edit, a deletion
// or an unshare made on another device reaches the phone.

import { mergeAssets } from './assetSharing';

export const OFFLINE_WALLET_KEY = 'ourdays.offlineWallet';

/**
 * A server confirmation of an unchanged copy rewrites its "checked" time at most this often (metadata
 * events can come in bursts). Only a real server delivery can do it: offlineWalletSync.ts explains
 * why there is no timer.
 */
export const CONFIRM_REFRESH_MS = 60_000;

export interface OfflineCard {
  id: string;
  name: string;
  /** barcodeValue, untouched; null when the card has no code (a document, a photo). */
  code: string | null;
  /** barcodeFormat, untouched (html5-qrcode's formatName, or 'UNKNOWN'). */
  format: string | null;
  /** Somebody else's card, shared with a group this person is in. */
  shared: boolean;
}

export interface OfflineWallet {
  v: 1;
  uid: string;
  /** When this copy was written. */
  savedAt: number;
  /** When the server last confirmed every list this copy is made of; null if it never has. */
  confirmedAt: number | null;
  /** Holds a change made on this device that the server has not accepted yet. */
  pending: boolean;
  cards: OfflineCard[];
}

type AssetDoc = { id?: string; ownerId?: string | null; name?: unknown; barcodeValue?: unknown; barcodeFormat?: unknown };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The cards, owned first and deduped (mergeAssets), through the whitelist. */
export function toOfflineCards(owned: AssetDoc[], shared: AssetDoc[][], uid: string): OfflineCard[] {
  return mergeAssets(owned, shared)
    .filter((a) => typeof a.id === 'string' && a.id)
    .map((a) => ({
      id: a.id as string,
      name: str(a.name) ?? '',
      code: str(a.barcodeValue),
      format: str(a.barcodeFormat),
      shared: a.ownerId !== uid,
    }));
}

/** One listener's latest answer, or its failure. */
export type Delivery =
  | { docs: AssetDoc[]; fromCache: boolean; pending: boolean }
  | { error: true };

export interface Deliveries {
  owned?: Delivery;
  /** The groups listener; its ids are `groupIds`. */
  groups?: Delivery;
  groupIds: string[];
  /** One per id in `groupIds`, keyed by group id. */
  shared: Record<string, Delivery | undefined>;
}

const failed = (d: Delivery | undefined): d is { error: true } => !!d && 'error' in d;

/**
 * The copy to write after a delivery, or null to leave the stored one as it is. See the header for
 * the rules; each one is a test in offlineWallet.test.ts.
 */
export function nextSnapshot(prev: OfflineWallet | null, d: Deliveries, uid: string, now: number): OfflineWallet | null {
  const all = [d.owned, d.groups, ...d.groupIds.map((g) => d.shared[g])];
  // Not every list has answered yet: a copy made now would be missing somebody's cards.
  if (all.some((x) => x === undefined)) return null;
  // Any list failed: keep what we had. (The sync reports a copy that stays stuck this way.)
  if (all.some(failed)) return null;
  const ok = all as { docs: AssetDoc[]; fromCache: boolean; pending: boolean }[];

  const fromServer = ok.every((x) => !x.fromCache);
  // Pending is about CARDS: a group renamed offline is not an unsent card change (review, 28.09).
  const pending = [d.owned, ...d.groupIds.map((g) => d.shared[g])].some((x) => (x as { pending: boolean }).pending);
  const shared = d.groupIds.map((g) => (d.shared[g] as { docs: AssetDoc[] }).docs);
  const cards = toOfflineCards((d.owned as { docs: AssetDoc[] }).docs, shared, uid);
  const same = prev && prev.uid === uid ? prev : null;

  if (!fromServer) {
    // From the local cache only. Written when it carries this device's own unsent change (so the
    // page shows the new code, marked "not yet sent"), or when there is no copy at all for this
    // account yet — never to replace a copy with an EMPTY cache answer.
    if (same && !pending) return null;
    if (same && cards.length === 0 && same.cards.length > 0) return null;
  }

  const confirmedAt = fromServer && !pending ? now : (same?.confirmedAt ?? null);
  const next: OfflineWallet = { v: 1, uid, savedAt: now, confirmedAt, pending, cards };

  if (same && sameCards(same.cards, cards) && same.pending === pending) {
    // Nothing changed but, perhaps, the confirmation time. Refreshed at most once a minute.
    if (confirmedAt === null || same.confirmedAt === null) return same.confirmedAt === confirmedAt ? null : next;
    if (confirmedAt - same.confirmedAt < CONFIRM_REFRESH_MS) return null;
  }
  return next;
}

function sameCards(a: OfflineCard[], b: OfflineCard[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.name === y.name && x.code === y.code && x.format === y.format && x.shared === y.shared;
  });
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored copy, or null when there is none or it is not one this code understands. */
export function readOfflineWallet(storage: StorageLike | null = defaultStorage()): OfflineWallet | null {
  try {
    const raw = storage?.getItem(OFFLINE_WALLET_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw);
    if (!w || w.v !== 1 || typeof w.uid !== 'string' || !Array.isArray(w.cards) || typeof w.savedAt !== 'number') return null;
    if (w.confirmedAt !== null && typeof w.confirmedAt !== 'number') return null;
    const cards: OfflineCard[] = w.cards
      .filter((c: unknown) => !!c && typeof (c as OfflineCard).id === 'string')
      .map((c: OfflineCard) => ({
        id: c.id,
        name: typeof c.name === 'string' ? c.name : '',
        code: typeof c.code === 'string' ? c.code : null,
        format: typeof c.format === 'string' ? c.format : null,
        shared: c.shared === true,
      }));
    return { v: 1, uid: w.uid, savedAt: w.savedAt, confirmedAt: w.confirmedAt, pending: w.pending === true, cards };
  } catch {
    return null;
  }
}

/** Store a copy. False when the storage refused (private mode, quota) — never throws. */
export function writeOfflineWallet(w: OfflineWallet, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(OFFLINE_WALLET_KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}

/** Remove the copy: at sign-out, on every signed-out start, and when the feature is switched off. */
export function forgetOfflineWallet(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(OFFLINE_WALLET_KEY);
  } catch {
    /* nothing to forget where nothing can be stored */
  }
}
