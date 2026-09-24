// src/utils/checklistOps.ts
//
// A checklist change as an OPERATION on one item, applied to the checklist as it is NOW.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────
//
// Ticking an item, editing its text and reordering all wrote the WHOLE `checklistItems` array,
// built from the copy this screen happened to hold. Two people ticking two different items at the
// same moment each wrote their own copy with one tick in it, and the second write erased the
// first: the tick you saw land was gone a second later, and nobody was told.
//
// Firestore cannot address one element of an array, and re-keying the checklist into a map would
// break every reader of the array — the installed APK among them. So instead each change is an
// operation ("mark item X done"), applied inside a transaction to the document's CURRENT array. A
// transaction that raced another is retried by Firestore against the newer array, so both ticks
// land.
//
// Offline, a transaction cannot run. The screen then falls back to the old whole-array write,
// which Firestore queues until the connection returns — last writer wins, as it always did, but
// a tick made on a train is not refused. The same fallback catches a transaction that fails with
// `unavailable`: "online" by the browser's account, but unable to reach the server.
//
// ── One person's changes, in the order they were made ──────────────────────────────────────
//
// Added 24.09.2026, from the pre-deploy review of the version above. Two quick taps by the same
// person started two transactions at once, and Firestore RETRIES the one that lost the race — so
// tick-then-untick could commit untick first and tick second, and the item ended ticked. Each
// event's writes from this screen now run one after another.
//
// Known and left: while a write is in flight, the snapshot of the one before it can arrive and
// briefly show the checklist without the newer change, until its own write lands.

import { doc, runTransaction, updateDoc, type Firestore } from 'firebase/firestore';

export type ChecklistOp =
  /** Set, not toggle: two people ticking the same item must agree, not cancel each other out. */
  | { kind: 'set-completed'; id: string; value: boolean }
  | { kind: 'set-text'; id: string; text: string }
  /** Move `id` to just before `beforeId`, or to the end when that is null or no longer there. */
  | { kind: 'move'; id: string; beforeId: string | null }
  /** Add items at the end — each once: an id already present is not added again. */
  | { kind: 'append'; items: Array<{ id?: unknown; [k: string]: unknown }> };

type Item = { id?: unknown; [k: string]: unknown };

/** The array after `op`, from the array as it stands. Never throws; an unknown item is a no-op. */
export function applyChecklistOp(items: unknown, op: ChecklistOp): Item[] {
  const list: Item[] = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : [];

  if (op.kind === 'append') {
    // By id, so a retried write (Firestore retries a raced transaction) cannot add a batch twice.
    const have = new Set(list.map((x) => x.id));
    return [...list, ...op.items.filter((x) => x && typeof x === 'object' && !have.has(x.id))];
  }

  const at = list.findIndex((x) => x.id === op.id);
  // Deleted by somebody else meanwhile: there is nothing left to change, and inventing it back
  // would undo their deletion.
  if (at < 0) return list;

  switch (op.kind) {
    case 'set-completed':
      return list.map((x, i) => (i === at ? { ...x, isCompleted: op.value } : x));
    case 'set-text':
      return list.map((x, i) => (i === at ? { ...x, text: op.text } : x));
    case 'move': {
      const rest = list.filter((_, i) => i !== at);
      const before = op.beforeId === null ? -1 : rest.findIndex((x) => x.id === op.beforeId);
      const to = before < 0 ? rest.length : before;
      return [...rest.slice(0, to), list[at], ...rest.slice(to)];
    }
    default:
      return list;
  }
}

/** Per event, the end of the queue of this screen's writes. */
const queues = new Map<string, Promise<void>>();

/**
 * Run `task` after every earlier task for `key` has finished — succeeded OR failed: an earlier
 * refusal must not hold the later changes hostage.
 */
export function inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const mine = before.then(task);
  const tail = mine.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return mine;
}

/** The three ways a checklist change can reach the server; injectable so the order is testable. */
export interface ChecklistWriter {
  offline: () => boolean;
  /** The operation, applied inside a transaction to the server's current array. */
  transact: () => Promise<void>;
  /** The whole array as this screen shows it, queued by Firestore until the server can take it. */
  queue: () => Promise<void>;
}

function isUnavailable(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'unavailable';
}

export async function writeChecklistOpWith(w: ChecklistWriter, key: string): Promise<void> {
  // A queued write's promise settles only when the server acknowledges it: offline, that is when
  // the connection returns. The ORDER only needs it issued — Firestore applies queued writes in
  // the order they were made — so the queue moves on once it is issued, and the caller alone waits
  // for the acknowledgement (and hears a refusal).
  const queued: { ack?: Promise<void> } = {};
  await inOrder(key, async () => {
    if (w.offline()) { queued.ack = w.queue(); return; }
    try {
      await w.transact();
    } catch (e) {
      if (!isUnavailable(e)) throw e;
      queued.ack = w.queue();
    }
  });
  if (queued.ack) await queued.ack;
}

/**
 * Apply `op` to event `eventId`'s checklist as it is on the server.
 *
 * `localNext` is what this screen shows after the change; it is written only in the fallback,
 * where the server's array cannot be read.
 */
export function writeChecklistOp(
  db: Firestore, eventId: string, op: ChecklistOp, localNext: unknown[],
): Promise<void> {
  const ref = doc(db, 'events', eventId);
  return writeChecklistOpWith({
    offline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
    transact: () => runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('checklist-event-gone');
      tx.update(ref, { checklistItems: applyChecklistOp(snap.data().checklistItems, op) });
    }),
    queue: () => updateDoc(ref, { checklistItems: localNext }),
  }, eventId);
}
