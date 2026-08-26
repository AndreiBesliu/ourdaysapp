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

import { onSnapshot, type Query, type DocumentReference, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { reportError } from '../reportError';

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
  onNext: (docs: (T & { id: string })[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    q,
    (snap) => onNext(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))),
    (err) => {
      // A permission error and a missing index arrive the same way and matter the same amount:
      // both mean the screen below is about to lie about being empty.
      reportError(err?.message || 'snapshot failed', {
        context,
        stack: (err as { code?: string })?.code ? `code=${(err as { code?: string }).code}` : undefined,
      });
      onError(err);
    },
  );
}

/**
 * The same contract for a single document.
 *
 * A denied document read is quieter still than a denied query: the callback never runs, so the
 * screen keeps whatever it had before — usually the defaults it was constructed with. That is how
 * a profile read failing turns into "you belong to no groups" rather than into an error.
 */
export function liveDoc<T = DocumentData>(
  ref: DocumentReference<DocumentData>,
  context: string,
  onNext: (data: (T & { id: string }) | null) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    ref,
    (snap) => onNext(snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null),
    (err) => {
      reportError(err?.message || 'document snapshot failed', {
        context,
        stack: (err as { code?: string })?.code ? `code=${(err as { code?: string }).code}` : undefined,
      });
      onError(err);
    },
  );
}
