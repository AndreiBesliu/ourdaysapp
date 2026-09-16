// src/utils/eventTargeting.ts
//
// What changing an event's TARGET CALENDAR does to the people on it.
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// The target-calendar select did exactly one thing: `setSelectedGroupId(e.target.value)`. Two
// lists that are meaningful only inside a particular group were left alone:
//
//   assigneeIds — who is to do it;
//   visibleTo   — who inside the group may see it.
//
// The form MEANWHILE renders both filtered to the group now selected. So a person who is not in
// the new group vanishes from the screen and stays in the document. Three things follow, and the
// third is the one that makes this worth fixing rather than tidying:
//
//   1. You think you removed them. You did not — their chip is simply not drawn any more.
//   2. They cannot see the event. It is filed on a group they are not in, so it has no tab of
//      theirs (src/utils/eventScope.ts) — while `functions/src/remindersCore.ts` still sends them
//      a reminder, because recipients are the owner plus the assignees, group or no group.
//   3. Retarget a NEW event to Personal with somebody else still assigned and the write is REFUSED
//      outright: `firestore.rules` allows a non-group event to name only its own author
//      (`assigneeIds.hasOnly([request.auth.uid])`). The form offers a state the database rejects.
//
// `visibleTo` has the mirror problem. It is seeded from everybody you share any group with, and on
// an edit it is loaded verbatim from the stored document — so retargeting an old event into a
// newer group can carry an audience that names nobody in it, and then nobody in that group sees
// the event at all.
//
// ── The rule ─────────────────────────────────────────────────────────────────────────
//
// Changing the target calendar re-derives both lists from the group you have just chosen. What can
// survive the move survives it; what cannot is dropped rather than saved invisibly. It is the same
// answer Andrei chose for the expenses participant picker on the same day — switching the group
// resets the ticks to the new group's members — and it is here as two functions rather than two
// lines in an event handler so that it can be RUN.

/** Not a member of anything; a valid assignee everywhere. */
export const AI_ASSISTANT = 'ai_assistant';

const real = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * The assignees to keep after a move to `groupMembers` (`null` means the personal calendar).
 *
 * An intersection, not a reset: somebody in both groups was picked deliberately and there is no
 * reason to unpick them. You and the assistant always survive — you because an event on your own
 * calendar may name you, the assistant because it belongs to no group's member list.
 */
export function keepAssignees(
  groupMembers: readonly string[] | null,
  uid: string,
  assignees: readonly unknown[],
): string[] {
  const keepable = new Set<string>([uid, AI_ASSISTANT, ...(groupMembers || []).filter(real)]);
  return [...new Set(assignees.filter(real).filter((id) => keepable.has(id)))];
}

/**
 * The audience for an event on `groupMembers` — everybody in the group but you.
 *
 * You are left out because the list answers "who ELSE may see this"; the form's checkboxes are
 * drawn the same way, and the event's own owner is never filtered by it.
 *
 * A reset rather than an intersection, unlike the assignees: an audience carried over from another
 * group is not a narrower choice, it is a list of the wrong people — and one that can easily name
 * nobody in the group the event is now on, which hides it from everyone.
 */
export function audienceFor(groupMembers: readonly string[] | null, uid: string): string[] {
  if (!groupMembers) return [];
  return [...new Set(groupMembers.filter(real).filter((id) => id !== uid))];
}
