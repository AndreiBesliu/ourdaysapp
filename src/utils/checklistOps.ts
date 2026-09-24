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
// a tick made on a train is not refused.

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

/**
 * Apply `op` to event `eventId`'s checklist as it is on the server.
 *
 * `localNext` is what this screen shows after the change; it is written only in the offline
 * fallback, where the server's array cannot be read.
 */
export async function writeChecklistOp(
  db: Firestore, eventId: string, op: ChecklistOp, localNext: unknown[],
): Promise<void> {
  const ref = doc(db, 'events', eventId);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) {
    await updateDoc(ref, { checklistItems: localNext });
    return;
  }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('checklist-event-gone');
    tx.update(ref, { checklistItems: applyChecklistOp(snap.data().checklistItems, op) });
  });
}
