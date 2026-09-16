// src/utils/eventTargeting.test.ts
//
// Moving an event to another calendar, and the people it leaves behind.

import { describe, it, expect } from 'vitest';
import { keepAssignees, audienceFor, AI_ASSISTANT } from './eventTargeting';

const ME = 'andrei', EMILIA = 'emilia', COACH = 'coach';
const FAMILY = [ME, EMILIA];
const GYM = [ME, COACH];

describe('the defect: a person who is not in the new group is dropped from the screen only', () => {
  it('drops an assignee the new group does not contain', () => {
    // Family event assigned to Emilia, retargeted to Gym. Her chip stops being drawn (the form
    // only renders members of the selected group) while the document keeps naming her — and the
    // reminder function notifies assignees without looking at the group, so she gets a push for an
    // event that is filed on a calendar she does not have.
    expect(keepAssignees(GYM, ME, [ME, EMILIA])).toEqual([ME]);
  });

  it('keeps somebody who is in both groups, because picking them was deliberate', () => {
    expect(keepAssignees(GYM, ME, [ME, COACH])).toEqual([ME, COACH]);
  });

  it('keeps the AI assistant, which is in no group at all', () => {
    expect(keepAssignees(GYM, ME, [AI_ASSISTANT, EMILIA])).toEqual([AI_ASSISTANT]);
    expect(keepAssignees(null, ME, [AI_ASSISTANT])).toEqual([AI_ASSISTANT]);
  });

  it('keeps ME even if the roster has not loaded', () => {
    expect(keepAssignees([], ME, [ME, EMILIA])).toEqual([ME]);
  });
});

describe('moving an event to the personal calendar', () => {
  it('leaves nobody but me and the assistant on it', () => {
    // Not a preference. `firestore.rules` lets a non-group event name only its own author
    // (assigneeIds.hasOnly([request.auth.uid])), so a new personal event still carrying a group
    // assignee is REFUSED — the form was offering a state the database rejects.
    expect(keepAssignees(null, ME, [ME, EMILIA, COACH])).toEqual([ME]);
    expect(keepAssignees(null, ME, [EMILIA])).toEqual([]);
  });

  it('and empties the audience, which is a group idea', () => {
    expect(audienceFor(null, ME)).toEqual([]);
  });
});

describe('the audience follows the group it is on', () => {
  it('becomes the new group, minus me', () => {
    expect(audienceFor(GYM, ME)).toEqual([COACH]);
    expect(audienceFor(FAMILY, ME)).toEqual([EMILIA]);
  });

  it('is a reset, not an intersection — an old audience can name nobody in the new group', () => {
    // The mirror of the assignee case: `visibleTo` is loaded verbatim from the stored document on
    // an edit, so an event written when the groups were different can arrive carrying a list with
    // nobody from the group it is being moved to — and then nobody in that group sees it.
    expect(audienceFor(GYM, ME)).not.toContain(EMILIA);
    expect(audienceFor(GYM, ME)).toContain(COACH);
  });

  it('never names me, because the list answers "who ELSE"', () => {
    for (const members of [FAMILY, GYM, [ME], [ME, ME]]) {
      expect(audienceFor(members, ME)).not.toContain(ME);
    }
  });
});

describe('rosters and selections that are not the shape anybody expects', () => {
  it('does not let a duplicate through either list', () => {
    expect(keepAssignees([ME, COACH, COACH], ME, [COACH, COACH])).toEqual([COACH]);
    expect(audienceFor([COACH, COACH, EMILIA], ME)).toEqual([COACH, EMILIA]);
  });

  it('ignores members and assignees that are not real ids', () => {
    expect(keepAssignees([ME, '', null as any, 7 as any], ME, [ME, '', undefined as any])).toEqual([ME]);
    expect(audienceFor(['', null as any, COACH], ME)).toEqual([COACH]);
  });

  it('an empty selection stays empty — nothing is assigned by default', () => {
    expect(keepAssignees(GYM, ME, [])).toEqual([]);
  });
});
