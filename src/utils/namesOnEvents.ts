// src/utils/namesOnEvents.ts
//
// Somebody who left a group stays named on its events that are over (Andrei, 05.10.2026: history
// stays; functions/src/leaverCore.ts). The calendar's name map holds only the people in your groups
// NOW, so that history read "Member" instead of the name. These are the extra names, for showing
// only: the map of people an event can be ASSIGNED to stays the members' map (AddEventModal lists
// all of it), and the picker in EventDetailsModal filters by the group's members anyway.

/** Not a person: the AI may be named on an event, and has no profile. */
const NOT_A_PERSON = 'ai_assistant';

/**
 * Everybody named on these events (owner, assignees, answers) whom `known` has no entry for,
 * sorted and once each. Malformed fields are read as naming nobody.
 */
export function namedOutside(events: readonly Record<string, unknown>[], known: Readonly<Record<string, unknown>>): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v && v !== NOT_A_PERSON && !(v in known)) out.add(v);
  };
  for (const ev of events) {
    add(ev.ownerId);
    add(ev.assigneeId);
    if (Array.isArray(ev.assigneeIds)) ev.assigneeIds.forEach(add);
    if (ev.rsvps && typeof ev.rsvps === 'object' && !Array.isArray(ev.rsvps)) Object.keys(ev.rsvps).forEach(add);
  }
  return [...out].sort();
}

/** The map events are SHOWN with: the members' map, plus the names found outside it. A member wins. */
export function withNamesOnEvents<T>(members: Readonly<Record<string, T>>, outside: Readonly<Record<string, T>>): Record<string, T> {
  return { ...outside, ...members };
}
