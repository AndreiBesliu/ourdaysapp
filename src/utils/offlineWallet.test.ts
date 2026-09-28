// src/utils/offlineWallet.test.ts
//
// The offline card copy (utils/offlineWallet.ts): what goes into it, and when it may change.
// Andrei, 28.09.2026: "codurile de bare și QR vreau sa fie disponibile offline, dar sa se faca sync
// la modificari". Every write rule here is also a mutation target.

import { describe, it, expect } from 'vitest';
import {
  toOfflineCards, nextSnapshot, readOfflineWallet, writeOfflineWallet, forgetOfflineWallet,
  OFFLINE_WALLET_KEY, CONFIRM_REFRESH_MS, type OfflineWallet, type Deliveries,
} from './offlineWallet';
import { renderFor } from './barcodeFormat';

const ME = 'me';
const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, ownerId: ME, name: `Card ${id}`, barcodeValue: '5901234123457', barcodeFormat: 'EAN_13',
  imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=secret',
  categories: ['Shops'], sharedGroupId: 'g1', transferredFrom: 'u9', ...extra,
});
const server = (docs: unknown[]) => ({ docs: docs as never[], fromCache: false, pending: false });
const cache = (docs: unknown[], pending = false) => ({ docs: docs as never[], fromCache: true, pending });
const deliveries = (over: Partial<Deliveries> = {}): Deliveries => ({
  owned: server([card('a')]), groups: server([]), groupIds: [], shared: {}, ...over,
});
const T0 = 1_000_000;

describe('toOfflineCards: a whitelist', () => {
  const out = toOfflineCards([card('a')], [[card('b', { ownerId: 'u2' })]], ME);

  it('carries exactly id, name, code, format and shared', () => {
    for (const c of out) expect(Object.keys(c).sort()).toEqual(['code', 'format', 'id', 'name', 'shared']);
  });

  it('never carries a Storage URL, a token, a category, an owner or a transfer origin', () => {
    const json = JSON.stringify(out);
    for (const s of ['firebasestorage', 'token=', 'Shops', 'u9', 'u2', 'g1']) expect(json).not.toContain(s);
  });

  it('marks somebody else\'s card as shared, and dedupes owned-first', () => {
    const both = toOfflineCards([card('a')], [[card('a', { ownerId: 'u2', name: 'their copy' }), card('b', { ownerId: 'u2' })]], ME);
    expect(both.map((c) => [c.id, c.name, c.shared])).toEqual([['a', 'Card a', false], ['b', 'Card b', true]]);
  });

  it('keeps a card with no code, as code:null', () => {
    const [c] = toOfflineCards([card('p', { barcodeValue: undefined, barcodeFormat: undefined })], [], ME);
    expect(c).toMatchObject({ id: 'p', code: null, format: null });
  });

  it('the page draws exactly what the Wallet draws: code and format pass through untouched', () => {
    const cases: Array<[unknown, unknown]> = [
      ['EAN_13', '5901234123457'], ['UPC_A', '036000291452'], ['UPC_E', '01234565'], ['CODE_39', 'ABC123'],
      ['QR_CODE', 'https://example.test/x'], ['PDF_417', 'anything'], ['UNKNOWN', '12345'], [undefined, 'X-1'],
      ['EAN_13', 'not-a-number'],
    ];
    for (const [format, value] of cases) {
      const [c] = toOfflineCards([card('z', { barcodeFormat: format, barcodeValue: value })], [], ME);
      expect(renderFor(c.format, c.code), `${String(format)} ${String(value)}`).toEqual(renderFor(format, value));
    }
  });
});

describe('nextSnapshot: when the copy may change', () => {
  const prev = (over: Partial<OfflineWallet> = {}): OfflineWallet => ({
    v: 1, uid: ME, savedAt: T0 - 5000, confirmedAt: T0 - 5000, pending: false,
    cards: toOfflineCards([card('a'), card('b')], [], ME), ...over,
  });

  it('waits until the owned list, the groups and EVERY group\'s list have answered', () => {
    expect(nextSnapshot(null, deliveries({ owned: undefined }), ME, T0)).toBeNull();
    expect(nextSnapshot(null, deliveries({ groups: undefined }), ME, T0)).toBeNull();
    expect(nextSnapshot(null, deliveries({ groupIds: ['g1'], shared: {} }), ME, T0)).toBeNull();
    expect(nextSnapshot(null, deliveries({ groupIds: ['g1'], shared: { g1: server([]) } }), ME, T0)).not.toBeNull();
  });

  it('a failed list keeps the copy that was there', () => {
    expect(nextSnapshot(prev(), deliveries({ owned: { error: true } }), ME, T0)).toBeNull();
    expect(nextSnapshot(prev(), deliveries({ groupIds: ['g1'], shared: { g1: { error: true } } }), ME, T0)).toBeNull();
  });

  it('a server answer replaces the WHOLE copy: an edit, a deletion, an unshare all arrive', () => {
    const next = nextSnapshot(prev(), deliveries({ owned: server([card('a', { barcodeValue: '4006381333931' })]) }), ME, T0);
    expect(next!.cards.map((c) => [c.id, c.code])).toEqual([['a', '4006381333931']]);
    expect(next!.confirmedAt).toBe(T0);
  });

  it('a group left: its cards are gone from the next copy', () => {
    const before = prev({ cards: toOfflineCards([card('a')], [[card('s', { ownerId: 'u2' })]], ME) });
    const next = nextSnapshot(before, deliveries({ groupIds: [], shared: {} }), ME, T0);
    expect(next!.cards.map((c) => c.id)).toEqual(['a']);
  });

  it('confirmedAt only when every list came from the server with nothing pending', () => {
    const d = deliveries({ groups: cache([]) });
    const next = nextSnapshot(null, d, ME, T0);
    expect(next!.confirmedAt).toBeNull();
    const pendingServer = nextSnapshot(null, deliveries({ owned: { ...server([card('a')]), pending: true } }), ME, T0);
    expect(pendingServer!.confirmedAt).toBeNull();
  });

  it('a cache-only answer is written only with this device\'s pending change, or when there is no copy', () => {
    expect(nextSnapshot(prev(), deliveries({ owned: cache([card('a', { barcodeValue: '1' })]) }), ME, T0)).toBeNull();
    const withPending = nextSnapshot(prev(), deliveries({ owned: cache([card('a', { barcodeValue: '1' })], true) }), ME, T0);
    expect(withPending!.cards[0].code).toBe('1');
    expect(withPending!.pending).toBe(true);
    expect(withPending!.confirmedAt).toBe(prev().confirmedAt);
    expect(nextSnapshot(null, deliveries({ owned: cache([card('a')]) }), ME, T0)).not.toBeNull();
  });

  it('an EMPTY cache answer never erases a copy; an empty SERVER answer does', () => {
    expect(nextSnapshot(prev(), deliveries({ owned: cache([], true) }), ME, T0)).toBeNull();
    const erased = nextSnapshot(prev(), deliveries({ owned: server([]) }), ME, T0);
    expect(erased!.cards).toEqual([]);
  });

  it('a pending write on a GROUP (renamed offline) is not an unsent card change', () => {
    const d = deliveries({ owned: cache([card('a'), card('b')]), groups: { docs: [], fromCache: true, pending: true } });
    expect(nextSnapshot(prev(), d, ME, T0)).toBeNull();
  });

  it('another account replaces the copy', () => {
    const next = nextSnapshot(prev({ uid: 'someone-else' }), deliveries({ owned: cache([card('a')]) }), ME, T0);
    expect(next!.uid).toBe(ME);
  });

  it('nothing changed: no write, except a confirmation refreshed at most once a minute', () => {
    const same = prev({ cards: toOfflineCards([card('a')], [], ME), confirmedAt: T0 - 10 });
    expect(nextSnapshot(same, deliveries(), ME, T0)).toBeNull();
    const later = nextSnapshot(same, deliveries(), ME, T0 - 10 + CONFIRM_REFRESH_MS);
    expect(later!.confirmedAt).toBe(T0 - 10 + CONFIRM_REFRESH_MS);
    const firstConfirmation = nextSnapshot(prev({ cards: toOfflineCards([card('a')], [], ME), confirmedAt: null }), deliveries(), ME, T0);
    expect(firstConfirmation!.confirmedAt).toBe(T0);
  });
});

describe('storage', () => {
  const fake = (seed: Record<string, string> = {}) => {
    const m = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      m,
    };
  };
  const w: OfflineWallet = { v: 1, uid: ME, savedAt: T0, confirmedAt: T0, pending: false, cards: toOfflineCards([card('a')], [], ME) };

  it('round-trips', () => {
    const s = fake();
    expect(writeOfflineWallet(w, s)).toBe(true);
    expect(readOfflineWallet(s)).toEqual(w);
  });

  it('a refusing storage (quota, private mode) returns false and never throws', () => {
    const s = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: () => {} };
    expect(writeOfflineWallet(w, s)).toBe(false);
    expect(writeOfflineWallet(w, null)).toBe(false);
  });

  it('malformed JSON, another version or missing fields read as no copy', () => {
    for (const raw of ['{', JSON.stringify({ ...w, v: 2 }), JSON.stringify({ v: 1 }), JSON.stringify({ ...w, confirmedAt: 'x' })]) {
      expect(readOfflineWallet(fake({ [OFFLINE_WALLET_KEY]: raw })), raw).toBeNull();
    }
  });

  it('forget removes it', () => {
    const s = fake({ [OFFLINE_WALLET_KEY]: JSON.stringify(w) });
    forgetOfflineWallet(s);
    expect(s.m.has(OFFLINE_WALLET_KEY)).toBe(false);
  });
});
