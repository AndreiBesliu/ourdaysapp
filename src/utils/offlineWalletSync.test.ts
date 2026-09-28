// src/utils/offlineWalletSync.test.ts
//
// The writer of the offline card copy (utils/offlineWalletSync.ts), with its listeners injected:
// which lists it opens, how it follows the groups, that everything passes through nextSnapshot, that
// nothing it does can throw into the app, and the once-per-session reports.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'me' } } }));
vi.mock('../reportError', () => ({ reportError: vi.fn() }));
vi.mock('./liveQuery', () => ({ liveQuery: vi.fn(() => () => {}) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (c: { path: string }, ...w: unknown[]) => ({ ...c, where: w }),
}));

import { liveQuery } from './liveQuery';
import { startOfflineWalletSync, stopOfflineWalletSync, STUCK_AFTER_MS, RETRY_MS, type ListenSpec, type SyncDeps } from './offlineWalletSync';
import type { OfflineWallet } from './offlineWallet';

type Cb = { spec: ListenSpec; next: (docs: never[], meta: { fromCache: boolean; hasPendingWrites: boolean }) => void; error: () => void; open: boolean };

function harness(initial: OfflineWallet | null = null) {
  const listeners: Cb[] = [];
  let stored = initial;
  const writes: OfflineWallet[] = [];
  const reports: Array<[string, string]> = [];
  let now = 1_000_000;
  const who = { current: 'me' };
  const deps: Partial<SyncDeps> = {
    isCurrent: (u) => u === who.current,
    listen: (spec, next, error) => {
      const cb: Cb = { spec, next: next as Cb['next'], error, open: true };
      listeners.push(cb);
      return () => { cb.open = false; };
    },
    read: () => stored,
    write: (w) => { stored = w; writes.push(w); return true; },
    report: (m, c) => { reports.push([c, m]); },
    now: () => now,
    pageStored: async () => true,
  };
  const find = (pred: (s: ListenSpec) => boolean) => listeners.filter((l) => l.open && pred(l.spec));
  return {
    deps, listeners, writes, reports, who,
    get stored() { return stored; },
    advance(ms: number) { now += ms; vi.advanceTimersByTime(ms); },
    owned: () => find((s) => s.kind === 'owned')[0],
    groups: () => find((s) => s.kind === 'groups')[0],
    shared: (g: string) => find((s) => s.kind === 'shared' && s.groupId === g)[0],
  };
}

const server = { fromCache: false, hasPendingWrites: false };
const asset = (id: string, over: Record<string, unknown> = {}) => ({ id, ownerId: 'me', name: id, barcodeValue: '123', barcodeFormat: 'CODE_128', ...over });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the lists it listens to', () => {
  it('owned and groups at once, then one per group — with the Wallet\'s shapes (metadata included by the default listener)', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    expect(h.listeners.map((l) => l.spec.kind)).toEqual(['owned', 'groups']);
    h.groups().next([{ id: 'g1' }, { id: 'g2' }, { id: 'personal' }] as never[], server);
    expect(h.listeners.filter((l) => l.spec.kind === 'shared').map((l) => (l.spec as { groupId: string }).groupId)).toEqual(['g1', 'g2']);
  });

  it('follows the groups: a group left is closed, a new one opened, nothing opened twice', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.groups().next([{ id: 'g1' }, { id: 'g2' }] as never[], server);
    const g1 = h.shared('g1');
    h.groups().next([{ id: 'g1' }, { id: 'g3' }] as never[], server);
    expect(h.shared('g1')).toBe(g1);
    expect(h.shared('g2')).toBeUndefined();
    expect(h.shared('g3')).toBeDefined();
    expect(h.listeners.filter((l) => l.spec.kind === 'shared')).toHaveLength(3);
  });
});

describe('the default listener', () => {
  it("uses the Wallet's exact query shapes, with metadata changes, so the SDK shares the targets", () => {
    vi.mocked(liveQuery).mockClear();
    const h = harness();
    const { listen: _unused, ...rest } = h.deps;
    void _unused;
    startOfflineWalletSync('me', rest);
    const calls = vi.mocked(liveQuery).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      { path: 'assets', where: [{ field: 'ownerId', op: '==', value: 'me' }] },
      { path: 'groups', where: [{ field: 'members', op: 'array-contains', value: 'me' }] },
    ]);
    expect(calls.map((c) => c[1])).toEqual(['OfflineWallet.owned', 'OfflineWallet.groups']);
    for (const c of calls) expect(c[4]).toEqual({ includeMetadataChanges: true });
    // and a group's list is the Wallet's shared-assets shape
    const groupsNext = calls[1][2] as (docs: unknown[], meta: unknown) => void;
    groupsNext([{ id: 'g1' }], server);
    expect(vi.mocked(liveQuery).mock.calls[2][0]).toEqual({ path: 'assets', where: [{ field: 'sharedGroupId', op: '==', value: 'g1' }] });
  });
});

describe('what it writes', () => {
  it('nothing until every list has answered; then the copy, confirmed', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([{ id: 'g1' }] as never[], server);
    expect(h.writes).toHaveLength(0);
    h.shared('g1').next([asset('s', { ownerId: 'u2' })] as never[], server);
    expect(h.writes).toHaveLength(1);
    expect(h.stored!.cards.map((c) => [c.id, c.shared])).toEqual([['a', false], ['s', true]]);
    expect(h.stored!.confirmedAt).not.toBeNull();
  });

  it('a failed list writes nothing', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().error();
    h.groups().next([] as never[], server);
    expect(h.writes).toHaveLength(0);
  });

  it('a throwing store is caught and reported once, never thrown into the app', () => {
    const h = harness();
    h.deps.write = () => { throw new Error('boom'); };
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    expect(() => h.groups().next([] as never[], server)).not.toThrow();
    h.owned().next([asset('b')] as never[], server);
    expect(h.reports.filter(([c]) => c === 'OfflineWallet.settle')).toHaveLength(1);
  });

  it('no timer stamps "checked": only a server delivery does (the real SDK stayed silent 80 s after the server went)', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([] as never[], server);
    const first = h.stored!.confirmedAt!;
    const writes = h.writes.length;
    h.advance(5 * 60_000);
    expect(h.writes.length).toBe(writes);
    expect(h.stored!.confirmedAt).toBe(first);
    // A real confirmation later does stamp it.
    h.owned().next([asset('a')] as never[], server);
    expect(h.stored!.confirmedAt).toBe(first + 5 * 60_000);
  });
});

describe('the once-per-session reports', () => {
  it('copyStuck, once, ten minutes in, when a list failed', async () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().error();
    h.advance(STUCK_AFTER_MS);
    await vi.runOnlyPendingTimersAsync();
    expect(h.reports.filter(([c]) => c === 'OfflineWallet.copyStuck')).toHaveLength(1);
  });

  it('nothing to report when the copy for this account exists and every list is fine', async () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([] as never[], server);
    h.advance(STUCK_AFTER_MS);
    await vi.runOnlyPendingTimersAsync();
    expect(h.reports).toEqual([]);
  });

  it('notReady when the service worker runs but the page is not stored', async () => {
    const h = harness();
    h.deps.pageStored = async () => false;
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([] as never[], server);
    h.advance(STUCK_AFTER_MS);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    expect(h.reports.map(([c]) => c)).toEqual(['OfflineCards.notReady']);
  });
});

describe('stop', () => {
  it('closes every listener and stops the timers', () => {
    const h = harness();
    const stop = startOfflineWalletSync('me', h.deps);
    h.groups().next([{ id: 'g1' }] as never[], server);
    stop();
    expect(h.listeners.every((l) => !l.open)).toBe(true);
    const writes = h.writes.length;
    h.advance(STUCK_AFTER_MS * 2);
    expect(h.writes.length).toBe(writes);
  });
});

describe('review 28.09: a failed list is re-opened', () => {
  it('after 5 s, then 30 s, then 2 min — and a later answer writes the copy', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.groups().next([] as never[], server);
    h.owned().error();
    expect(h.owned()).toBeUndefined();
    h.advance(RETRY_MS[0]);
    expect(h.owned()).toBeDefined();
    h.owned().next([asset('a')] as never[], server);
    expect(h.stored!.cards.map((c) => c.id)).toEqual(['a']);
  });

  it('a list that fails AFTER answering blocks the copy: the others must not stamp "checked" over its old answer', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([] as never[], server);
    const first = h.stored!.confirmedAt;
    const writes = h.writes.length;
    h.advance(2 * 60_000);
    h.owned().error();
    h.groups().next([] as never[], server);
    expect(h.writes.length).toBe(writes);
    expect(h.stored!.confirmedAt).toBe(first);
  });

  it('stop also cancels a pending re-open (nothing left scheduled)', () => {
    const h = harness();
    const stop = startOfflineWalletSync('me', h.deps);
    h.owned().error();
    expect(vi.getTimerCount()).toBeGreaterThan(1); // the watchdog and the re-open
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('at most three times, so a truly refused list cannot loop', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    for (const wait of RETRY_MS) { h.owned().error(); h.advance(wait); }
    h.owned().error();
    h.advance(10 * 60_000);
    expect(h.listeners.filter((l) => l.spec.kind === 'owned')).toHaveLength(1 + RETRY_MS.length);
  });

  it("a group's list refused once (created on this phone) is re-opened on the next groups answer", () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([{ id: 'new' }] as never[], { fromCache: false, hasPendingWrites: true });
    h.shared('new').error();
    expect(h.writes).toHaveLength(0);
    h.groups().next([{ id: 'new' }] as never[], server);
    expect(h.shared('new')).toBeDefined();
    h.shared('new').next([] as never[], server);
    expect(h.writes).toHaveLength(1);
  });
});

describe('review 28.09: the account and sign-out', () => {
  it('nothing is written once another account (or nobody) is signed in', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.who.current = '';
    h.owned().next([asset('a')] as never[], server);
    h.groups().next([] as never[], server);
    expect(h.writes).toHaveLength(0);
  });

  it('stopOfflineWalletSync stops the running sync; starting another stops the first', () => {
    const h1 = harness();
    startOfflineWalletSync('me', h1.deps);
    const h2 = harness();
    startOfflineWalletSync('me', h2.deps);
    expect(h1.listeners.every((l) => !l.open)).toBe(true);
    stopOfflineWalletSync();
    expect(h2.listeners.every((l) => !l.open)).toBe(true);
  });
});

describe('review 28.09: a card deleted on this device while offline', () => {
  it('is an unsent change: the copy loses it and says "not sent yet"', () => {
    const h = harness();
    startOfflineWalletSync('me', h.deps);
    h.owned().next([asset('a'), asset('b')] as never[], server);
    h.groups().next([] as never[], server);
    h.owned().next([asset('a')] as never[], { fromCache: true, hasPendingWrites: false });
    expect(h.stored!.cards.map((c) => c.id)).toEqual(['a']);
    expect(h.stored!.pending).toBe(true);
  });
});
