// src/utils/eventScope.ts
//
// Which calendar tab does an event belong on, and who on that calendar sees it?
//
// ── Part one: the tab ────────────────────────────────────────────────────────────────
//
// Andrei, 16.09.2026: "am niste evenimente din grupul de familie in grupul de gym". He was right,
// and it was not one stray row — measured against live data, the Gym tab was showing him twelve
// events of which NINE belonged to another calendar: four from B&D, three from Family, one from
// his personal calendar. The Family tab: nine foreign out of thirteen. B&D: seven out of twelve.
//
// The cause is that the calendar is fed by THREE listeners merged into one list:
//
//   main      where('groupId','==',activeGroup)          — correctly scoped to the tab
//   assigned  where('assigneeIds','array-contains',uid)  — scoped to the PERSON, not the tab
//   invited   where('inviteeId','==',uid)                — scoped to the PERSON, not the tab
//
// The last two exist for a real reason: somebody can put a task on YOUR calendar without it being
// a group event at all (five such events exist on live, all filed by one person against another's
// personal calendar). But nothing narrowed their results to the tab being looked at, so every
// event anybody had ever assigned to you appeared under every group you are in.
//
// The rule, in one sentence: an event belongs on the calendar it was FILED on — its group's tab,
// or Personal when it has no group. Nothing re-homes an event onto a different calendar; the note
// at the foot of this file says what the version that tried to do so broke.
//
// ── Part two: the audience, and why it had to be turned inside out ───────────────────
//
// Andrei, 18.09.2026, on being shown that two of B&D's four members saw an EMPTY calendar there.
//
// The old field was `visibleTo`: a list of who MAY see the event, written once when the event was
// created and never revised. An allow-list cannot tell "deliberately left out" from "was not here
// yet", so it ages into a lie the moment somebody joins the group. Measured on live before the
// change, and every number here is a count, not an impression:
//
//   * FIVE events — every single one B&D has — named neither of the two members who joined after
//     they were written. Those two people opened a real group and saw nothing at all.
//   * one Family event named two people who are not in Family, which is what gives the field's
//     true origin away: it was seeded from everybody the AUTHOR shared any group with, not from
//     the group the event was on.
//   * NOT ONE of the twelve group events had an audience narrower than that snapshot. The feature
//     the field exists for had never once been used.
//
// So what is stored is now the OPPOSITE: `hiddenFrom`, the people deliberately left out. The group
// roster is read at display time and cannot go stale; the only thing recorded is the exception,
// and an exception that names nobody is the empty list it looks like. `visibleTo` is no longer
// read anywhere — justified by that third measurement, not by hope.
//
// Worth knowing what this is NOT: `visibleTo` never appeared in firestore.rules or in any Cloud
// Function, and neither does `hiddenFrom`. Any member of a group can READ every one of its events;
// this is the calendar declining to draw one. It is a courtesy, not a privacy boundary, and a
// screen that treats it as the latter would be making a promise the database does not keep.
//
// ── Why this is a module and not three lines in the listener ─────────────────────────
//
// It was three lines in the listener. Two of the three buckets simply forgot to apply them, which
// is what a rule spread across three callbacks invites. One function, asked by all three, cannot be
// forgotten by two of them — and unlike a callback it can be RUN.

export interface ScopedEvent {
  groupId?: unknown;
  ownerId?: unknown;
  assigneeIds?: unknown;
  assigneeId?: unknown;
  inviteeId?: unknown;
  inviteStatus?: unknown;
  /** Who was deliberately left out. Absent or empty means the whole group. */
  hiddenFrom?: unknown;
}

export interface Viewer {
  uid: string;
  /** The tab on screen: a group id, or `'personal'`. */
  tab: string;
}

export const PERSONAL = 'personal';

/** The group an event was filed against, or `''` for a personal one. */
function groupOf(ev: ScopedEvent): string {
  return typeof ev.groupId === 'string' && ev.groupId ? ev.groupId : '';
}

/** Whether this person is NAMED on the event, rather than merely able to read it. */
function isNamed(ev: ScopedEvent, uid: string): boolean {
  if (ev.ownerId === uid) return true;
  if (Array.isArray(ev.assigneeIds) && ev.assigneeIds.includes(uid)) return true;
  if (ev.assigneeId === uid) return true;
  if (ev.inviteeId === uid) return true;
  return false;
}

/**
 * The tab an event belongs on: the calendar it was filed against.
 *
 * It does not depend on the viewer, deliberately. An event filed against a group you are not in
 * returns that group's id — a tab that is not on your screen — so it shows nowhere, which is what
 * "not in that group" means.
 */
export function homeTabFor(ev: ScopedEvent): string {
  return groupOf(ev) || PERSONAL;
}

/**
 * Whether this person may see the event at all.
 *
 * A group event is the group's until somebody says otherwise, and `hiddenFrom` is that somebody
 * saying otherwise. Nothing here consults the roster: "everyone except these people" stays true as
 * the roster changes, which is the whole reason the field was turned around.
 *
 * Being NAMED on the event overrides the exclusion, and that is not a loophole — it is the only
 * reading that survives how the fields are written. Adding an assignee does not touch the
 * exclusion list, and `functions/src/remindersCore.ts` builds a reminder's recipients from the
 * owner and the assignees without consulting either field. Without this line, somebody could be
 * sent a push notification for a task that appears on no screen in the app — which is exactly what
 * an adversarial reviewer demonstrated against an earlier version of this module.
 */
export function maySee(ev: ScopedEvent, uid: string): boolean {
  if (isNamed(ev, uid)) return true;
  if (!groupOf(ev)) return true;
  return !(Array.isArray(ev.hiddenFrom) && ev.hiddenFrom.includes(uid));
}

/** Whether the event should appear on the tab the viewer is looking at. */
export function showsOnTab(ev: ScopedEvent, viewer: Viewer): boolean {
  // A pending invitation belongs in the invitations strip, not on the grid.
  if (ev.inviteeId === viewer.uid && ev.inviteStatus === 'pending') return false;
  if (!maySee(ev, viewer.uid)) return false;
  return homeTabFor(ev) === viewer.tab;
}

/** The same decision over a whole list. */
export function eventsForTab<T extends ScopedEvent>(events: readonly T[], viewer: Viewer): T[] {
  return events.filter((ev) => showsOnTab(ev, viewer));
}

/** The pending invitations strip: those, and only those, regardless of which tab is open. */
export function pendingInvitesFor<T extends ScopedEvent>(events: readonly T[], uid: string): T[] {
  return events.filter((ev) => ev.inviteeId === uid && ev.inviteStatus === 'pending');
}

// ── The version that re-homed events, and why it is not here ─────────────────────────
//
// The first cut of this module sent an event filed against a group you are NOT in to the Personal
// tab, so that a task assigned to you before you left a group could not vanish. Four reviewers went
// at it and two killed it, with the same collision:
//
//   LeaveGroupModal already answers that question, and answers it better. Leaving a group lists the
//   events you are involved in, asks which to KEEP, and writes a personal COPY of each. The
//   originals keep their `groupId`. Re-homing them would have put the copy and the original side by
//   side on the Personal tab — and resurrected every event you had just chosen NOT to keep.
//
// Being removed by an admin (GroupSettingsModal) makes no copies, so those events do leave your
// calendar. That is the deliberate trade: the events of a group you are no longer in are not yours
// to carry, and inventing a second answer beside the one the leave flow already gives would break
// the common path to patch the rare one.
