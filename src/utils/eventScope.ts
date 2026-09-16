// src/utils/eventScope.ts
//
// Which calendar tab does an event belong on?
//
// ── The defect this was pulled out of ────────────────────────────────────────────────
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
// event anybody had ever assigned to you appeared under every group you are in. Switching tabs
// changed the header and the member avatars and left most of the grid identical — which is exactly
// what the screenshots showed.
//
// ── The rule, in one sentence ────────────────────────────────────────────────────────
//
// An event belongs on the calendar it was FILED on: its group's tab, or Personal when it has no
// group. Nothing re-homes an event onto a different calendar — see the note at the foot of this
// file for the version that tried to, and what it broke.
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
  visibleTo?: unknown;
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
 * `visibleTo` is a per-event audience inside a group, snapshotted from the member list when the
 * event is written. Being NAMED on the event overrides it, and that is not a loophole — it is the
 * only reading that survives the way the two fields are actually written:
 *
 *   AddEventModal seeds `visibleTo` from the members present when the event is created and never
 *   revises it. Adding an assignee later (EventDetailsModal, or a second pass through the form)
 *   changes `assigneeIds` and writes `visibleTo` back exactly as it was. So "assigned to somebody
 *   the audience does not name" is a shape this app produces by itself, not a corrupt document.
 *
 * The server already treats assignment as the stronger statement: `functions/src/remindersCore.ts`
 * builds a reminder's recipients from the owner and the assignees, with no reference to
 * `visibleTo`. Without this override that person is sent a push notification for a task that
 * appears on no screen in the app — which is exactly what an adversarial reviewer demonstrated
 * against the first version of this module.
 *
 * Somebody deliberately left out of the audience is not NAMED on the event, so nothing here shows
 * them anything they were meant not to see.
 */
export function maySee(ev: ScopedEvent, uid: string): boolean {
  if (isNamed(ev, uid)) return true;
  if (!groupOf(ev)) return true;
  return !Array.isArray(ev.visibleTo) || ev.visibleTo.includes(uid);
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
