// src/utils/calendarSources.ts
//
// Two small decisions the calendar screen made wrongly, moved here so a test can run them.

/**
 * The calendar tab to show, given the groups the person is in NOW.
 *
 * A group that was deleted, or that the person was removed from, stayed selected: the tab kept its
 * id, the group vanished from the list, and the screen showed an empty calendar under a group that
 * no longer existed for them. Falling back to the personal calendar is what "that tab is gone"
 * means.
 */
export function reconciledActiveGroup(active: string, groups: ReadonlyArray<{ id?: unknown }>): string {
  if (active === 'personal') return active;
  return groups.some((g) => g.id === active) ? active : 'personal';
}

/**
 * One "could not load" flag fed by several listeners, where each listener speaks only for itself.
 *
 * The calendar's three event listeners shared a single boolean, and a SUCCESS from one cleared a
 * failure from another: the "your events" query loading fine wiped out the warning that the events
 * assigned to you, or the ones you were invited to, had not loaded. The same defect was already
 * fixed in ExpensesTab; this is the calendar's copy of it.
 */
export function sourceFlags<K extends string>(keys: readonly K[]) {
  const failed = new Map<K, boolean>(keys.map((k) => [k, false]));
  const any = () => [...failed.values()].some(Boolean);
  return {
    /** This source loaded. Returns whether ANY source is still failing. */
    ok(k: K): boolean { failed.set(k, false); return any(); },
    /** This source failed. Returns true. */
    fail(k: K): boolean { failed.set(k, true); return any(); },
    any,
  };
}
