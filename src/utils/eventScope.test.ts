// src/utils/eventScope.test.ts
//
// The screenshots, as something that runs in a second.
//
// The fixtures are the live documents' actual shape, read with the read-only key on 16.09.2026:
// 24 events, 12 filed against a group, `visibleTo` present as an ARRAY on the group events and on
// the personal ones (empty on the latter — the trap that decides how the audience has to be asked).

import { describe, it, expect } from 'vitest';
import { homeTabFor, maySee, showsOnTab, eventsForTab, pendingInvitesFor, PERSONAL } from './eventScope';

const ME = 'andrei', EMILIA = 'emilia', COACH = 'coach', MARIA = 'maria';
const GYM = 'g_gym', FAMILY = 'g_family', BD = 'g_bd';

const viewing = (tab: string, uid: string = ME) => ({ uid, tab });

// The two events in the screenshots: filed by Emilia on the Family calendar, assigned to Andrei.
const familyShopping = { groupId: FAMILY, ownerId: EMILIA, assigneeIds: [ME], visibleTo: [ME] };
const bdList = { groupId: BD, ownerId: EMILIA, assigneeIds: [ME], visibleTo: [ME] };
const gymSession = { groupId: GYM, ownerId: COACH, assigneeIds: [ME], visibleTo: [ME] };
// Filed by Emilia against Andrei's PERSONAL calendar — no group at all. Five of these on live, and
// they carry an EMPTY visibleTo.
const personalTask = { ownerId: EMILIA, assigneeIds: [ME], visibleTo: [] as string[] };
const myOwnEvent = { ownerId: ME, assigneeIds: [] as string[], visibleTo: [] as string[] };

describe('the defect Andrei reported: family events in the gym group', () => {
  it('does not show a Family event on the Gym tab', () => {
    // It was: the assigned listener returned it and nothing asked which calendar it was filed on.
    expect(showsOnTab(familyShopping, viewing(GYM))).toBe(false);
    expect(showsOnTab(familyShopping, viewing(BD))).toBe(false);
    expect(showsOnTab(familyShopping, viewing(PERSONAL))).toBe(false);
  });

  it('shows it on Family, where it was filed', () => {
    expect(showsOnTab(familyShopping, viewing(FAMILY))).toBe(true);
  });

  it('every tab shows its own events and nobody else’s', () => {
    const all = [familyShopping, bdList, gymSession, personalTask, myOwnEvent];
    expect(eventsForTab(all, viewing(GYM))).toEqual([gymSession]);
    expect(eventsForTab(all, viewing(FAMILY))).toEqual([familyShopping]);
    expect(eventsForTab(all, viewing(BD))).toEqual([bdList]);
    expect(eventsForTab(all, viewing(PERSONAL))).toEqual([personalTask, myOwnEvent]);
  });

  it('is the whole point: a tab is not a relabelled copy of the same grid', () => {
    // The measured live numbers before the fix — Gym 12 events of which 9 foreign, Family 13 of
    // which 9, B&D 12 of which 7 — came from every tab being fed the same unscoped list.
    const all = [familyShopping, bdList, gymSession, personalTask, myOwnEvent];
    expect([GYM, FAMILY, BD, PERSONAL].map((t) => eventsForTab(all, viewing(t)).length)).toEqual([1, 1, 1, 2]);
  });
});

describe('what the two unscoped listeners were actually FOR', () => {
  it('keeps a task somebody filed against my personal calendar', () => {
    // This is why the assigned listener exists at all. Five such events on live; if the fix had
    // simply deleted the listener they would have disappeared from the only tab that shows them.
    expect(showsOnTab(personalTask, viewing(PERSONAL))).toBe(true);
    expect(homeTabFor(personalTask)).toBe(PERSONAL);
  });

  it('and does not let an EMPTY visibleTo on such a task hide it', () => {
    // The trap. Every personal event on live carries `visibleTo: []`, and the old post-filter read
    // an empty array as "nobody may see this" — harmless only because it ran on group tabs, where
    // these events did not belong anyway. Applying it verbatim on the personal tab would have
    // hidden all five while appearing to fix a bug.
    expect(personalTask.visibleTo).toEqual([]);
    expect(personalTask.ownerId).not.toBe(ME);
    expect(showsOnTab(personalTask, viewing(PERSONAL))).toBe(true);
  });
});

describe('the audience, and the person the audience forgot', () => {
  it('hides a group event from a member it does not name', () => {
    const others = { groupId: FAMILY, ownerId: EMILIA, assigneeIds: [EMILIA], visibleTo: [EMILIA, COACH] };
    expect(maySee(others, ME)).toBe(false);
    expect(showsOnTab(others, viewing(FAMILY))).toBe(false);
  });

  it('shows it to somebody ASSIGNED it, even when the audience predates them', () => {
    // Found by an adversarial reviewer against the first version of this module, which hid it and
    // filed it nowhere. `visibleTo` is snapshotted when the event is created and never revised, so
    // assigning it to a member who joined later produces exactly this document — and the reminder
    // function notifies assignees without looking at `visibleTo`, so the alternative is a push
    // notification for a task that appears on no screen in the app.
    const assignedLater = { groupId: FAMILY, ownerId: EMILIA, assigneeIds: [MARIA], visibleTo: [ME, COACH] };
    expect(maySee(assignedLater, MARIA)).toBe(true);
    expect(showsOnTab(assignedLater, viewing(FAMILY, MARIA))).toBe(true);
    // ...on the group's own tab, and only there.
    expect(showsOnTab(assignedLater, viewing(PERSONAL, MARIA))).toBe(false);
  });

  it('shows my own group event even when I left myself out of visibleTo', () => {
    expect(showsOnTab({ groupId: FAMILY, ownerId: ME, visibleTo: [EMILIA] }, viewing(FAMILY))).toBe(true);
  });

  it('is a GROUP audience: it narrows nothing on a personal calendar', () => {
    // A personal event carries `visibleTo: []` on live. The audience list is a thing groups have;
    // read on a personal event it would mean "nobody", which is never what it was written to say.
    expect(maySee({ ownerId: COACH, visibleTo: [] } as any, ME)).toBe(true);
    expect(maySee({ ownerId: COACH, visibleTo: [EMILIA] } as any, ME)).toBe(true);
  });

  it('does not treat a missing audience as an empty one', () => {
    // A group event with no `visibleTo` at all is visible to the group; only a real list narrows it.
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA }, ME)).toBe(true);
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA, visibleTo: [] }, ME)).toBe(false);
  });
});

describe('an event filed against a group I am not in', () => {
  const strandedTask = { groupId: 'g_left', ownerId: EMILIA, assigneeIds: [ME], visibleTo: [ME] };

  it('shows on no tab of mine, because that calendar is not on my screen', () => {
    // Deliberate, and it replaced a version that re-homed such events onto Personal. LeaveGroupModal
    // already asks which events to KEEP when you leave and writes personal COPIES of those; the
    // originals keep their groupId, so re-homing put the copy and the original side by side AND
    // brought back every event the person had just chosen not to keep.
    expect(homeTabFor(strandedTask)).toBe('g_left');
    expect(showsOnTab(strandedTask, viewing(PERSONAL))).toBe(false);
    expect(showsOnTab(strandedTask, viewing(FAMILY))).toBe(false);
  });

  it('so leaving a group leaves exactly the copies the leave flow made, and nothing doubled', () => {
    // What LeaveGroupModal writes: groupId null, owner and sole assignee the person leaving.
    const keptCopy = { ownerId: ME, assigneeIds: [ME], groupId: null };
    const original = { groupId: 'g_left', ownerId: EMILIA, assigneeIds: [ME], visibleTo: [ME] };
    expect(eventsForTab([keptCopy, original], viewing(PERSONAL))).toEqual([keptCopy]);
  });
});

describe('invitations', () => {
  const pending = { ownerId: EMILIA, inviteeId: ME, inviteStatus: 'pending' };
  const accepted = { ownerId: EMILIA, inviteeId: ME, inviteStatus: 'accepted' };

  it('a pending invitation belongs in the strip, not on the grid', () => {
    expect(showsOnTab(pending, viewing(PERSONAL))).toBe(false);
    expect(pendingInvitesFor([pending, accepted, personalTask], ME)).toEqual([pending]);
  });

  it('an accepted one appears on the calendar', () => {
    expect(showsOnTab(accepted, viewing(PERSONAL))).toBe(true);
  });

  it('somebody else’s pending invitation is not mine to list', () => {
    expect(pendingInvitesFor([{ ownerId: ME, inviteeId: EMILIA, inviteStatus: 'pending' }], ME)).toEqual([]);
  });
});

describe('documents that are not the shape anybody expects', () => {
  it('treats a missing, null or non-string groupId as personal', () => {
    for (const groupId of [undefined, null, '', 0, false, {}, []]) {
      expect(homeTabFor({ ownerId: ME, groupId } as any), String(groupId)).toBe(PERSONAL);
    }
  });

  it('survives a non-array assigneeIds or visibleTo', () => {
    // A `visibleTo` that is not an array is not an audience, so it narrows nothing...
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA, visibleTo: 'andrei' } as any, ME)).toBe(true);
    // ...and a bent `assigneeIds` does not make somebody named.
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA, assigneeIds: 'andrei', visibleTo: [EMILIA] } as any, ME)).toBe(false);
  });

  it('never invents a tab: every answer is a group id or personal', () => {
    for (const ev of [{}, { groupId: FAMILY }, { groupId: 7 }, { ownerId: ME }] as any[]) {
      const tab = homeTabFor(ev);
      expect(typeof tab).toBe('string');
      expect(tab.length).toBeGreaterThan(0);
    }
  });
});
