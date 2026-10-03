// src/utils/offlineWalletSync.ts
//
// Keeps the offline card copy (utils/offlineWallet.ts) in step with the server, from ANY screen,
// whenever the app is open. Andrei, 28.09.2026: "…dar sa se faca sync la modificari".
//
// It listens to exactly what the Wallet listens to — the cards this person owns, their groups, and
// one listener per group for the cards shared with it — with the same query shapes, so while the
// Wallet is open the SDK shares the targets and nothing is read twice. Every answer goes through
// `nextSnapshot`, which decides whether the stored copy may change.
//
// A plain function started from an effect, NOT a rendered component: a bug here must not reach the
// app-wide ErrorBoundary and blank the calendar. Everything it runs is inside try/catch.
//
// ── What the review of 28.09 changed ────────────────────────────────────────────────────────
//
//   * A listener that fails is RE-OPENED (5 s, 30 s, 2 min; a group's also on the next groups
//     answer). One refusal used to freeze the copy for the whole session — creating a group on this
//     phone could do it, the group's cards being listened for before the group existed on the server.
//   * Nothing is written unless the account this sync was started for is still the one signed in:
//     at sign-out the SDK re-emits the old account's documents, and one landing between "forget the
//     copy" and "stop the sync" wrote the copy back. `stopOfflineWalletSync()` also stops it first.
//   * A card deleted on this device while offline counts as an unsent change (the SDK does not count
//     a removed document as a pending write), so the offline page says "not sent yet".
//
// No timer refreshes the "checked with the server" time. There was one (every minute, while the last
// delivery of every list said fromCache:false), and the probe on the real SDK caught it lying: with
// the server gone, the SDK raised no new event for 80 s, the last delivery still said "from the
// server", and the timer stamped the copy as checked 80 s AFTER the connection was lost (28.09.2026).
// So the time is written only when a server-confirmed delivery actually arrives — at every online
// start and every change. It may show an older time than the truth; never a newer one.
//
// It also judges the Wallet's unconfirmed card changes (utils/walletLedger.ts, 03.10.2026) on the same
// server-confirmed, drained owned-cards answer — from any screen, so a change that landed after a
// restart is cleared within seconds of reconnecting, not on some later visit to the Wallet when the
// card may have changed again for other reasons.

import { collection, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { liveQuery, type DocMeta } from './liveQuery';
import { reportError } from '../reportError';
import { shareListenerGroupIds, type GroupLike } from './assetSharing';
import {
  nextSnapshot, readOfflineWallet, writeOfflineWallet, type Deliveries, type Delivery,
} from './offlineWallet';
import { reconcile, updateLedger } from './walletLedger';

/** What a listener is for. */
export type ListenSpec = { kind: 'owned' } | { kind: 'groups' } | { kind: 'shared'; groupId: string };

export type Listen = (
  spec: ListenSpec,
  onNext: (docs: Array<Record<string, unknown> & { id: string }>, meta: DocMeta) => void,
  onError: () => void,
) => () => void;

export interface SyncDeps {
  listen: Listen;
  read: typeof readOfflineWallet;
  write: typeof writeOfflineWallet;
  report: (message: string, context: string) => void;
  now: () => number;
  /** Whether the offline page is stored by the service worker; null when that cannot be known. */
  pageStored: () => Promise<boolean | null>;
  /** Whether `uid` is still the account signed in. Nothing is written for anyone else. */
  isCurrent: (uid: string) => boolean;
  /** Judge the Wallet's unconfirmed changes against a server-confirmed, drained owned-cards answer. */
  judge: (uid: string, docs: Array<Record<string, unknown> & { id: string }>) => void;
}

/** A copy that stays unwritable this long while online is reported, once. */
export const STUCK_AFTER_MS = 10 * 60_000;
/** When a failed listener is re-opened; after the last, it waits for the next app start. */
export const RETRY_MS = [5_000, 30_000, 120_000] as const;

// The Wallet's own three query shapes (Wallet.tsx), so the SDK shares their targets.
const firestoreListen = (uid: string): Listen => (spec, onNext, onError) => {
  const q = spec.kind === 'owned'
    ? query(collection(db, 'assets'), where('ownerId', '==', uid))
    : spec.kind === 'groups'
      ? query(collection(db, 'groups'), where('members', 'array-contains', uid))
      : query(collection(db, 'assets'), where('sharedGroupId', '==', spec.groupId));
  const context = spec.kind === 'shared' ? `OfflineWallet.shared.${spec.groupId}` : `OfflineWallet.${spec.kind}`;
  return liveQuery<Record<string, unknown>>(q, context, onNext, onError, { includeMetadataChanges: true });
};

const defaultDeps = (uid: string): SyncDeps => ({
  listen: firestoreListen(uid),
  read: readOfflineWallet,
  write: writeOfflineWallet,
  report: (message, context) => reportError(message, { context }),
  now: () => Date.now(),
  pageStored: async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller || typeof caches === 'undefined') return null;
      return !!(await caches.match('/offline/cards.html'));
    } catch {
      return null;
    }
  },
  isCurrent: (u) => auth.currentUser?.uid === u,
  judge: (u, docs) => { updateLedger(u, (l) => reconcile(l, docs, Date.now())); },
});

// The one running sync, so sign-out can stop it synchronously BEFORE the copy is forgotten.
let running: (() => void) | null = null;

/** Stop the running sync, if any. Call before forgetting the copy. */
export function stopOfflineWalletSync(): void {
  const stop = running;
  running = null;
  try { stop?.(); } catch { /* already stopped */ }
}

/** Start keeping the copy for `uid` (stopping any other). Returns stop(). */
export function startOfflineWalletSync(uid: string, overrides: Partial<SyncDeps> = {}): () => void {
  stopOfflineWalletSync();
  const deps = { ...defaultDeps(uid), ...overrides };
  const d: Deliveries = { groupIds: [], shared: {} };
  const live = new Map<string, () => void>();
  const attempts = new Map<string, number>();
  const lastIds = new Map<string, Set<string>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const reported = new Set<string>();
  let stopped = false;

  const reportOnce = (key: string, message: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    try { deps.report(message, key); } catch { /* the reporter must not take the sync down */ }
  };

  const settle = () => {
    if (stopped) return;
    try {
      if (!deps.isCurrent(uid)) return;
      const next = nextSnapshot(deps.read(), d, uid, deps.now());
      if (next && !deps.write(next)) {
        reportOnce('OfflineWallet.writeFailed', 'The offline card copy could not be stored (storage refused or full)');
      }
    } catch (err) {
      reportOnce('OfflineWallet.settle', err instanceof Error ? err.message : String(err));
    }
  };

  // One listener's answer. A document that LEFT a cache-only answer was removed on this device and not
  // yet sent — the SDK does not count that as a pending write, so it is counted here.
  const delivery = (key: string, docs: Array<Record<string, unknown> & { id: string }>, meta: DocMeta): Delivery => {
    const ids = new Set(docs.map((x) => x.id));
    const before = lastIds.get(key);
    lastIds.set(key, ids);
    const removedHere = meta.fromCache && !!before && [...before].some((id) => !ids.has(id));
    return { docs, fromCache: meta.fromCache, pending: meta.hasPendingWrites || removedHere };
  };

  const keyOf = (spec: ListenSpec) => (spec.kind === 'shared' ? `shared:${spec.groupId}` : spec.kind);
  const wanted = (spec: ListenSpec) => spec.kind !== 'shared' || d.groupIds.includes(spec.groupId);

  const store = (spec: ListenSpec, value: Delivery | undefined) => {
    if (spec.kind === 'owned') d.owned = value;
    else if (spec.kind === 'groups') d.groups = value;
    else if (value === undefined) delete d.shared[spec.groupId];
    else d.shared[spec.groupId] = value;
  };

  function open(spec: ListenSpec) {
    const key = keyOf(spec);
    if (stopped || live.has(key) || !wanted(spec)) return;
    try {
      live.set(key, deps.listen(
        spec,
        (docs, meta) => {
          attempts.set(key, 0);
          const value = delivery(key, docs, meta);
          if (spec.kind === 'groups') {
            try { setGroups(docs as GroupLike[]); } catch (err) {
              reportOnce('OfflineWallet.groups', err instanceof Error ? err.message : String(err));
            }
          }
          store(spec, value);
          settle();
          if (spec.kind === 'owned' && !meta.fromCache && !meta.hasPendingWrites && deps.isCurrent(uid)) {
            try { deps.judge(uid, docs); } catch (err) {
              reportOnce('OfflineWallet.judge', err instanceof Error ? err.message : String(err));
            }
          }
        },
        () => {
          // Keep the failure (so no partial copy is written) and re-open later.
          store(spec, { error: true });
          const un = live.get(key);
          live.delete(key);
          try { un?.(); } catch { /* already closed by the SDK */ }
          const n = attempts.get(key) ?? 0;
          if (n >= RETRY_MS.length || stopped) return;
          attempts.set(key, n + 1);
          const t = setTimeout(() => { timers.delete(t); open(spec); }, RETRY_MS[n]);
          timers.add(t);
        },
      ));
    } catch (err) {
      reportOnce('OfflineWallet.start', err instanceof Error ? err.message : String(err));
    }
  }

  function setGroups(groups: GroupLike[]) {
    const ids = shareListenerGroupIds(groups);
    for (const [key, un] of live) {
      if (!key.startsWith('shared:')) continue;
      const gid = key.slice('shared:'.length);
      if (!ids.includes(gid)) {
        try { un(); } catch { /* already closed */ }
        live.delete(key);
        lastIds.delete(key);
        delete d.shared[gid];
      }
    }
    for (const gid of Object.keys(d.shared)) if (!ids.includes(gid)) delete d.shared[gid];
    d.groupIds = ids;
    // A group whose listener failed is re-opened here too: its next answer may well succeed (a group
    // just created on this phone exists on the server by now).
    for (const gid of ids) open({ kind: 'shared', groupId: gid });
  }

  open({ kind: 'owned' });
  open({ kind: 'groups' });

  // Said once, ten minutes in, and only while online: a list still failing (so the copy cannot be
  // refreshed), no copy at all for this account, and a phone whose service worker is running without
  // the offline page stored.
  const watchdog = setTimeout(async () => {
    if (stopped) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) return;
    const errored = [d.owned, d.groups, ...d.groupIds.map((g) => d.shared[g])].some((x) => !!x && 'error' in x);
    if (errored || readCopyUid(deps) !== uid) {
      reportOnce('OfflineWallet.copyStuck', errored
        ? 'The offline card copy cannot be refreshed: a list failed to load'
        : 'No offline card copy for this account after 10 minutes online');
    }
    try {
      if ((await deps.pageStored()) === false) {
        reportOnce('OfflineCards.notReady', 'The service worker runs but the offline cards page is not stored');
      }
    } catch { /* unknowable is not a fault */ }
  }, STUCK_AFTER_MS);

  const stop = () => {
    stopped = true;
    clearTimeout(watchdog);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const un of live.values()) {
      try { un(); } catch { /* already gone */ }
    }
    live.clear();
    if (running === stop) running = null;
  };
  running = stop;
  return stop;
}

function readCopyUid(deps: SyncDeps): string | null {
  try { return deps.read()?.uid ?? null; } catch { return null; }
}
