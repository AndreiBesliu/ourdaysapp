// src/utils/eventMove.ts
//
// Moving an event to another calendar, and what its RSVP answers do on the way (Andrei, 05.10.2026):
//   * out of a group into personal: they stay as they are;
//   * personal into a group: only the mover's answer goes with it, the group answers for itself;
//   * from one group into another: exactly the answers of the people in both stay;
//   * and the people on the event (assigned or answered) who are in the group it leaves and not in
//     the one it joins may be invited along, if the mover says so.
// firestore.rules (`rsvpsOkOnUpdate`) refuses any other shape; this is the app writing the one it
// accepts. Pure: AddEventModal reads and writes.

export const AI_ASSIGNEE = 'ai_assistant';
const ANSWERS: readonly string[] = ['yes', 'maybe', 'no'];

export type Move = 'none' | 'out' | 'in' | 'across';

/** What kind of move `from` → `to` is (null = personal). */
export function moveOf(from: string | null | undefined, to: string | null | undefined): Move {
  const f = from || null;
  const t = to || null;
  if (f === t) return 'none';
  if (t === null) return 'out';
  if (f === null) return 'in';
  return 'across';
}

const answersOf = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isAnswer = (v: unknown): v is string => typeof v === 'string' && ANSWERS.includes(v);

/**
 * The `rsvps` to write WITH the move, or null to leave the field as it is. Your own answer goes only
 * if it is one the app writes; anybody else's goes only between groups, and only if they are in both.
 */
export function answersForMove(stored: unknown, move: Move, me: string, toMembers: readonly string[]): Record<string, string> | null {
  if (move === 'none' || move === 'out') return null;
  if (move === 'in') return onlyMyAnswer(stored, me);
  const answers = answersOf(stored);
  const out: Record<string, string> = {};
  const inBoth = new Set(toMembers);
  for (const [who, a] of Object.entries(answers)) {
    if (!inBoth.has(who)) continue;
    // Somebody else's answer is carried exactly as it is; only your own must be one the app writes.
    if (who === me ? isAnswer(a) : true) out[who] = a as string;
  }
  return out;
}

/**
 * Your own answer alone, if it is one the app writes. What a personal event carries: into a group it
 * goes with only yours, and the copy kept when leaving a group keeps only yours (on the web; the
 * installed APK still copies everybody's, which the rules allow on a personal event).
 */
export function onlyMyAnswer(stored: unknown, me: string): Record<string, string> {
  const mine = answersOf(stored)[me];
  return isAnswer(mine) ? { [me]: mine } : {};
}

/** Does the move leave somebody's answer behind? Said in the form before Save. */
export function dropsAnswers(stored: unknown, move: Move, me: string, toMembers: readonly string[]): boolean {
  const next = answersForMove(stored, move, me, toMembers);
  return !!next && Object.keys(answersOf(stored)).some((who) => !(who in next));
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/**
 * The people on the event — assigned or answered — who are in the group it leaves and not in the one
 * it joins: whom the mover may invite along. Never the mover, never the assistant. Sorted.
 */
export function inviteCandidates(
  ev: { assigneeIds?: unknown; assigneeId?: unknown; rsvps?: unknown },
  fromMembers: readonly string[], toMembers: readonly string[], me: string,
): string[] {
  const from = new Set(fromMembers);
  const to = new Set(toMembers);
  const on = new Set([...strings(ev.assigneeIds), ...strings([ev.assigneeId]), ...Object.keys(answersOf(ev.rsvps))]);
  return [...on].filter((u) => u !== me && u !== AI_ASSIGNEE && from.has(u) && !to.has(u)).sort();
}

/**
 * An invitation addressed to a uid and NO address: the mover does not know the invitee's address and
 * must not learn it, and only this shape is readable by uid (firestore.rules, `canAccessInvite`).
 */
export function uidInvite(fromId: string, fromEmail: string | null, toId: string, groupId: string, groupName: string, nowIso: string) {
  return { fromId, fromEmail, toId, toEmail: null, groupId, groupName, status: 'pending', createdAt: nowIso };
}
