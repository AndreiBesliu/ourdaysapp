// src/utils/liveQuery.ts
// A Firestore listener that cannot fail in silence.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// `onSnapshot(q, next)` with no third argument is the most expensive habit in this codebase. When
// the read is denied, or a composite index is missing, the listener simply never fires: state
// keeps its initial `[]` and the screen renders its ordinary "nothing yet" copy. A broken feature
// and an empty one are pixel-identical.
//
// That is not a hypothetical. It hid the expenses collection being denied for THREE MONTHS, and
// an audit on 2026-08-25 found 28 of the 30 listeners in this app still shaped that way.
//
// Worse, the SDK does not throw and does not reject: `AsyncObserver.error` writes one line to
// console.error when no handler is supplied. So the global `error` and `unhandledrejection` hooks
// in `reportError.ts` never fire either, nothing reaches `errorLogs`, and the admin Health tab
// shows a clean bill.
//
// So the error argument is not optional here. `onError` is required, and the failure is reported
// with a context string that says which screen and which collection it was.
//
// ── The document is not trusted to name itself (06.10.2026) ─────────────────────────────────
//
// The id is the document's, never a field of it: the data used to be spread AFTER `id`, so any
// document carrying a field called `id` — which a member can write on most shared collections —
// replaced its own id, and the screen then wrote, deleted or keyed by the wrong one (a map there
// crashed every list rendering it). Measured on live that day: no document in 33 collections
// carries such a field, so nothing reads differently.
//
// And a throw inside `onNext` is a failure like any other. The SDK runs the callback in a timer,
// so an exception there was uncaught: the listener kept throwing on every snapshot, the screen
// kept its last state, and nothing said why — the arcade's list of the day froze that way on one
// malformed `createdAt`. It is now reported under the listener's context and handed to `onError`.

import { describeThrown } from './describeThrown';

import {
  onSnapshot, type Query, type QuerySnapshot, type DocumentReference, type DocumentData, type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { reportError } from '../reportError';

/** Where a document snapshot's data came from. */
export interface DocMeta {
  /** Read from the local cache, not (yet) confirmed by the server — possibly stale. */
  fromCache: boolean;
  /** Includes a local write the server has not acknowledged yet. */
  hasPendingWrites: boolean;
  /** With `pendingIds`: which documents carry such a write (the Wallet's "not sent yet" mark). */
  pendingIds?: string[];
}

/**
 * Subscribe, and turn a failure into something the caller can render.
 *
 * `onError` receives the error so a screen can say "could not load" instead of "nothing yet" —
 * the distinction this whole module exists to preserve. Reporting happens here so no call site
 * can forget it.
 */
export function liveQuery<T = DocumentData>(
  q: Query<DocumentData>,
  context: string,
  onNext: (docs: (T & { id: string })[], meta: DocMeta) => void,
  onError: (err: unknown) => void,
  // The same option `liveDoc` has: told when a cached answer is confirmed by the server, which
  // otherwise raises nothing (the offline card copy stamps its freshness on that — offlineWalletSync).
  // `pendingIds` is ours, not the SDK's, and is never passed to onSnapshot.
  options?: { includeMetadataChanges?: boolean; pendingIds?: boolean },
): Unsubscribe {
  const next = (snap: QuerySnapshot<DocumentData>) => guarded(context, onError, () => onNext(
    snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })),
    {
      fromCache: snap.metadata.fromCache,
      hasPendingWrites: snap.metadata.hasPendingWrites,
      ...(options?.pendingIds
        ? { pendingIds: snap.docs.filter((d) => d.metadata.hasPendingWrites).map((d) => d.id) }
        : {}),
    },
  ));
  const error = (err: { message?: string; code?: string }) => {
    // A permission error and a missing index arrive the same way and matter the same amount:
    // both mean the screen below is about to lie about being empty.
    reportError(err?.message || 'snapshot failed', {
      context,
      stack: err?.code ? `code=${err.code}` : undefined,
    });
    onError(err);
  };
  return options?.includeMetadataChanges
    ? onSnapshot(q, { includeMetadataChanges: true }, next, error)
    : onSnapshot(q, next, error);
}

/**
 * The same contract for a single document.
 *
 * A denied document read is quieter still than a denied query: the callback never runs, so the
 * screen keeps whatever it had before — usually the defaults it was constructed with. That is how
 * a profile read failing turns into "you belong to no groups" rather than into an error.
 *
 * `onNext` also gets where the data came from. A screen that is about to CLAIM something from a
 * document — "you have not set your birthday" — needs to know whether it is reading the server's
 * answer or a cache that may be months old; with `includeMetadataChanges` it is also told when a
 * cached snapshot is confirmed, which otherwise raises no event because the data did not change.
 */
export function liveDoc<T = DocumentData>(
  ref: DocumentReference<DocumentData>,
  context: string,
  onNext: (data: (T & { id: string }) | null, meta: DocMeta) => void,
  onError: (err: unknown) => void,
  options?: { includeMetadataChanges?: boolean },
): Unsubscribe {
  const next = (snap: DocumentSnapshot<DocumentData>) => guarded(context, onError, () => onNext(
    snap.exists() ? ({ ...(snap.data() as T), id: snap.id }) : null,
    { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites },
  ));
  const error = (err: { message?: string; code?: string }) => {
    reportError(err?.message || 'document snapshot failed', {
      context,
      stack: err?.code ? `code=${err.code}` : undefined,
    });
    onError(err);
  };
  return options?.includeMetadataChanges
    ? onSnapshot(ref, { includeMetadataChanges: true }, next, error)
    : onSnapshot(ref, next, error);
}

/**
 * Runs a listener's `onNext`; a throw is reported under the listener's context and handed to
 * `onError`, so the screen can say it could not show the data instead of freezing on the last one.
 */
function guarded(context: string, onError: (err: unknown) => void, run: () => void): void {
  try {
    run();
  } catch (err) {
    const thrown = describeThrown(err);
    reportError(thrown.message, { context, stack: thrown.stack ? thrown.stack.slice(0, 4000) : 'thrown in onNext' });
    onError(err);
  }
}
