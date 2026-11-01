// src/utils/aiChecklistNote.ts
//
// What the details window does with an AI checklist that has not arrived.
//
//   failed  — the trigger stopped, and says why: the amber card, with Retry.
//   running — a delivery claimed the work (01.11.2026). While it may still be working, the skeleton
//             draws as before. Past that, nothing will ever replace the note: the trigger is not
//             retried, so a delivery that crashed or ran past its timeout leaves it for good, and the
//             skeleton would spin for the life of the event. It is shown as a failure then.
//   no note — the assistant is assigned, the checklist is empty and nothing says why. A move into a
//             group deletes the claim (the rules refuse a note carried into one), the AI may have
//             been switched on in an edit (the trigger serves only a creation), or the event predates
//             the claim. The same wait applies, counted from the event's creation.
//
// A request on an event the AI is not assigned to (a personal copy made on leaving a group spreads
// the group event's fields, assignees reset) promises nothing and shows nothing.
//
// TWO clocks, because the stored times come from another machine. The server writes the claim's
// `at`, the creating device writes `createdAt`, and this device's clock may run minutes ahead: read
// alone, it would show the card, and a paid Retry, while a delivery is still working (two charges).
// So the card also needs this window to have WATCHED the request for the server's hold, on a clock
// that only counts forward; a delivery cannot still be working after that, whatever the clocks say.
// Only a request older than any plausible skew skips the watch.

/**
 * The server's hold (`checklistHoldMs(120)` in functions/src/aiChecklistOutcome.ts, 150 s) plus a
 * minute. `aiChecklistOutcome.test.ts` keeps it, and `CHECKLIST_WATCH_MS`, in step with the server.
 */
export const CHECKLIST_DEAD_RUN_MS = 210_000;
/** How long this window must have watched the request: the server's hold, measured here. */
export const CHECKLIST_WATCH_MS = 150_000;
/** Past this age no clock is that far off: the card shows without the watch. */
export const CHECKLIST_SKEW_CEILING_MS = 3_600_000;

/** The reason a request nobody finished is shown with: the generic one, which offers Retry. */
export const DEAD_RUN_REASON = 'ai-checklist/error';

export interface ChecklistNoteInput {
  note: unknown;
  aiAssigned: boolean;
  checklistEmpty: boolean;
  createdAt: unknown;
}

export type ChecklistNoteView =
  | { kind: 'failed'; reason: unknown; at: unknown }
  | { kind: 'running' }
  | null;

function msOf(v: unknown): number | null {
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  const toMillis = (v as { toMillis?: unknown } | null | undefined)?.toMillis;
  if (typeof toMillis === 'function') {
    const ms = Number(toMillis.call(v));
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** When the unanswered request started, as stored (another machine's clock), or null if there is none. */
export function pendingSince(i: ChecklistNoteInput): number | null {
  if (!i.aiAssigned) return null;
  const n = i.note as { status?: unknown; at?: unknown } | null | undefined;
  if (n && typeof n === 'object' && n.status === 'running') return msOf(n.at);
  if (n && typeof n === 'object' && n.status === 'failed') return null;
  return i.checklistEmpty ? msOf(i.createdAt) : null;
}

export function checklistNoteView(i: ChecklistNoteInput, nowMs: number, watchedMs: number): ChecklistNoteView {
  const n = i.note as { status?: unknown; reason?: unknown; at?: unknown } | null | undefined;
  if (n && typeof n === 'object' && n.status === 'failed') return { kind: 'failed', reason: n.reason, at: n.at };
  const since = pendingSince(i);
  if (since === null) return null;
  const age = nowMs - since;
  const dead = age >= CHECKLIST_DEAD_RUN_MS && (watchedMs >= CHECKLIST_WATCH_MS || age >= CHECKLIST_SKEW_CEILING_MS);
  return dead ? { kind: 'failed', reason: DEAD_RUN_REASON, at: new Date(since).toISOString() } : { kind: 'running' };
}

// When this page first saw each pending request, on the monotonic clock. Module state, so closing and
// reopening the window does not restart the watch; keyed by the request's start, so a new claim does.
const firstSeen = new Map<string, number>();

/** How long this page has watched the request `key`, starting the watch on the first call. */
export function watchedFor(key: string, monoNowMs: number): number {
  const seen = firstSeen.get(key);
  if (seen === undefined) {
    firstSeen.set(key, monoNowMs);
    return 0;
  }
  return monoNowMs - seen;
}
