// src/utils/eventScope.test.ts
//
// The screenshots, as something that runs in a second — and the audience, turned inside out.
//
// The fixtures are the live documents' actual shape, read with the read-only key on 16 and
// 18.09.2026: 24 events, 12 filed against a group, and an audience list that on five of them named
// neither of the two people who had joined B&D since.

import { describe, it, expect } from 'vitest';
import { homeTabFor, maySee, showsOnTab, eventsForTab, pendingInvitesFor, PERSONAL } from './eventScope';

const ME = 'andrei', EMILIA = 'emilia', COACH = 'coach', MARIA = 'maria';
const GYM = 'g_gym', FAMILY = 'g_family', BD = 'g_bd';

const viewing = (tab: string, uid: string = ME) => ({ uid, tab });

// The two events in the screenshots: filed by Emilia on the Family calendar, assigned to Andrei.
const familyShopping = { groupId: FAMILY, ownerId: EMILIA, assigneeIds: [ME] };
const bdList = { groupId: BD, ownerId: EMILIA, assigneeIds: [ME] };
const gymSession = { groupId: GYM, ownerId: COACH, assigneeIds: [ME] };
// Filed by Emilia against Andrei's PERSONAL calendar — no group at all. Five of these on live.
const personalTask = { ownerId: EMILIA, assigneeIds: [ME] };
const myOwnEvent = { ownerId: ME, assigneeIds: [] as string[] };

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
});

describe('the audience: a group event is the group’s until somebody says otherwise', () => {
  it('shows a group event to a member nobody excluded', () => {
    expect(maySee(familyShopping, MARIA)).toBe(true);
  });

  it('does not need the roster, which is exactly why it cannot go stale', () => {
    // THE defect of 18.09. The old field listed who MAY see the event, written once at creation,
    // so joining the group later put you outside a list nobody meant to draw around you: five
    // events, every one B&D had, and two members opening a real group to an empty calendar.
    // Nothing here consults membership, so "everyone except these people" stays true as people
    // arrive.
    const joinedLater = { groupId: BD, ownerId: EMILIA, hiddenFrom: [] as string[] };
    expect(maySee(joinedLater, MARIA)).toBe(true);
    expect(maySee(joinedLater, COACH)).toBe(true);
  });

  it('hides it from somebody deliberately left out', () => {
    const notForMe = { groupId: FAMILY, ownerId: EMILIA, hiddenFrom: [ME] };
    expect(maySee(notForMe, ME)).toBe(false);
    expect(showsOnTab(notForMe, viewing(FAMILY))).toBe(false);
    // ...and only from them.
    expect(maySee(notForMe, MARIA)).toBe(true);
  });

  it('ignores the old visibleTo entirely', () => {
    // Measured before dropping it: not one of the twelve group events on live carried an audience
    // narrower than "everybody the author could see when they wrote it", and one named two people
    // who were not even in the group it was on. So there was nothing deliberate to preserve.
    const legacy = { groupId: BD, ownerId: EMILIA, visibleTo: [EMILIA] } as any;
    expect(maySee(legacy, ME)).toBe(true);
    expect(maySee(legacy, MARIA)).toBe(true);
  });

  it('shows it to somebody ASSIGNED it, even when they are on the exclusion list', () => {
    // Found by an adversarial reviewer against an earlier version, which hid it and filed it
    // nowhere. The reminder function notifies assignees without consulting either field, so the
    // alternative is a push notification for a task that appears on no screen in the app.
    const both = { groupId: FAMILY, ownerId: EMILIA, assigneeIds: [MARIA], hiddenFrom: [MARIA] };
    expect(maySee(both, MARIA)).toBe(true);
    expect(showsOnTab(both, viewing(FAMILY, MARIA))).toBe(true);
  });

  it('shows my own event to me however the list reads', () => {
    expect(maySee({ groupId: FAMILY, ownerId: ME, hiddenFrom: [ME] }, ME)).toBe(true);
  });

  it('is a GROUP idea: an exclusion on a personal event narrows nothing', () => {
    expect(maySee({ ownerId: COACH, hiddenFrom: [ME] } as any, ME)).toBe(true);
  });
});

describe('an event filed against a group I am not in', () => {
  const strandedTask = { groupId: 'g_left', ownerId: EMILIA, assigneeIds: [ME] };

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
    const keptCopy = { ownerId: ME, assigneeIds: [ME], groupId: null };
    const original = { groupId: 'g_left', ownerId: EMILIA, assigneeIds: [ME] };
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

  it('survives a non-array hiddenFrom or assigneeIds', () => {
    // A `hiddenFrom` that is not an array excludes nobody...
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA, hiddenFrom: 'andrei' } as any, ME)).toBe(true);
    // ...and a bent `assigneeIds` does not make somebody named.
    expect(maySee({ groupId: FAMILY, ownerId: EMILIA, assigneeIds: 'andrei', hiddenFrom: [ME] } as any, ME)).toBe(false);
  });

  it('never invents a tab: every answer is a group id or personal', () => {
    for (const ev of [{}, { groupId: FAMILY }, { groupId: 7 }, { ownerId: ME }] as any[]) {
      const tab = homeTabFor(ev);
      expect(typeof tab).toBe('string');
      expect(tab.length).toBeGreaterThan(0);
    }
  });
});
