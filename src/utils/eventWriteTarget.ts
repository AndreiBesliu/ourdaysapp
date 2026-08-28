// src/utils/eventWriteTarget.ts
// Which document does a change to THIS event actually belong in?
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// A recurring series is one stored document. The occurrences you see on the calendar are minted in
// memory by `expandRecurringEvents`, each with a synthetic key `${parentId}_${yyyy-MM-dd}` and the
// flags `isRecurringInstance` / `parentEventId`.
//
// EventDetailsModal wrote every change straight to `event.id`. For a plain event that is right.
// For an occurrence it addresses a document that has never existed: the write is refused, no local
// snapshot changes, and the only handler was `console.error`. Ticking a repeating task off did
// nothing at all, silently, for the entire class of repeating events.
//
// The obvious repair is the second bug in disguise. Sending the write to `parentEventId` instead
// would apply THIS Tuesday's completed checkbox, assignee and checklist to every Tuesday in the
// series — the same defect pointed the other way, and a destructive one.
//
// What actually belongs here is what AddEventModal already does when you edit one occurrence: turn
// that occurrence into a real document (an override), add its date to the parent's exception list,
// and write there from then on. This module only DECIDES that; the caller performs it.

export interface RecurringLike {
  id: string;
  isRecurringInstance?: boolean;
  parentEventId?: string;
  recurrenceDate?: string;
  [key: string]: unknown;
}

export type WritePlan =
  | { kind: 'direct'; id: string }
  | { kind: 'override'; parentId: string; overrideDate: string; data: Record<string, unknown> };

/**
 * Fields that must NOT be copied onto a materialised override.
 *
 * `id` is the synthetic key. `recurrenceRule` would make the override a series of its own.
 * `recurrenceExceptions` belongs to the parent. `ownerId`/`groupId`/`overrideOfParent` are set
 * server-side and are not the client's to state — see createEventOverride.
 */
const NOT_COPIED = new Set([
  'id',
  'isRecurringInstance',
  'parentEventId',
  'recurrenceDate',
  'recurrenceRule',
  'recurrenceExceptions',
  'overrideOfParent',
  'ownerId',
  'groupId',
]);

/**
 * Decide where a write to `event` goes.
 *
 * Returns `direct` for anything already stored. Returns `override` for an occurrence, carrying the
 * fields that should seed the new document — the occurrence's own date rather than the series
 * start, because the override IS that day.
 *
 * An event flagged as an instance but missing `parentEventId` or `recurrenceDate` falls back to
 * `direct`: it is malformed, and inventing an override from it would be worse than failing the way
 * it already fails.
 */
export function planEventWrite(event: RecurringLike): WritePlan {
  const parentId = typeof event.parentEventId === 'string' ? event.parentEventId : '';
  const overrideDate = typeof event.recurrenceDate === 'string' ? event.recurrenceDate : '';
  if (!event.isRecurringInstance || !parentId || !overrideDate) {
    return { kind: 'direct', id: event.id };
  }
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (NOT_COPIED.has(k)) continue;
    // Firestore refuses `undefined` outright and kills the whole write, so it never goes in.
    if (v === undefined) continue;
    data[k] = v;
  }
  data.date = overrideDate;
  return { kind: 'override', parentId, overrideDate, data };
}
