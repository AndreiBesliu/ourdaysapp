// src/utils/aiVisibility.test.ts
//
// The server's copy of "who may see this event". It had no test until 19.09, and that is exactly
// how it came to read a field the client retired a month earlier: nothing failed, because there
// was nothing that could fail.
//
// The client's version of the same invariant is tested in `eventScope.test.ts`. These are two
// implementations on purpose — the client's is wrapped in a UI condition the server does not have
// — so the cases below are written from the SERVER's side and do not import the client's at all.

import { describe, it, expect } from 'vitest';
import { maySee, isPendingInvite } from '../../functions/src/aiVisibility';
import type { EventDoc } from '../../functions/src/recurrenceServer';

const ME = 'uid-me';
const OTHER = 'uid-other';
const LATER = 'uid-joined-later';

const ev = (over: Partial<EventDoc>): EventDoc =>
  ({ id: 'e1', ownerId: OTHER, groupId: 'g', ...over }) as EventDoc;

describe('the audience is the EXCLUSION, not an allow-list', () => {
  it('shows a group event to a member who is not named anywhere on it', () => {
    // This is the regression that mattered most. `visibleTo` was frozen at write time, so
    // somebody who joined the group afterwards appeared on no list and the Period Log dropped
    // events their own calendar was plainly drawing. Measured on live: five events, every one
    // the family has, naming neither of the two members who joined later.
    expect(maySee(ev({}), LATER)).toBe(true);
  });

  it('hides one from somebody who was deliberately unticked', () => {
    expect(maySee(ev({ hiddenFrom: [ME] }), ME)).toBe(false);
    expect(maySee(ev({ hiddenFrom: [ME] }), LATER)).toBe(true);
  });

  it('IGNORES the retired field, even on a document that still carries it', () => {
    // The old field does not decay: an edit adds `hiddenFrom` and never deletes `visibleTo`, so
    // live documents carry both. Reading the dead one was wrong in both directions at once.
    //
    // Here it points the other way from the live field on purpose. Anything that still consults
    // `visibleTo` gets both of these backwards.
    expect(maySee(ev({ visibleTo: [], hiddenFrom: [] } as Partial<EventDoc>), LATER)).toBe(true);
    expect(maySee(ev({ visibleTo: [ME], hiddenFrom: [ME] } as Partial<EventDoc>), ME)).toBe(false);
  });
});

describe('the grants that outrank an exclusion', () => {
  it('always shows an event to its owner', () => {
    // A personal event carries `visibleTo: []`, which under the old rule excluded its own author.
    expect(maySee(ev({ ownerId: ME, visibleTo: [] } as Partial<EventDoc>), ME)).toBe(true);
    // ...and being hidden from yourself is not a thing the app can produce, but if a document
    // says it, ownership still wins rather than the person losing their own event.
    expect(maySee(ev({ ownerId: ME, hiddenFrom: [ME] }), ME)).toBe(true);
  });

  it('treats being assigned as a read grant, through either field', () => {
    expect(maySee(ev({ assigneeIds: [ME], hiddenFrom: [ME] }), ME)).toBe(true);
    expect(maySee(ev({ assigneeId: ME, hiddenFrom: [ME] }), ME)).toBe(true);
  });

  it('treats being invited the same way', () => {
    expect(maySee(ev({ inviteeId: ME, hiddenFrom: [ME] }), ME)).toBe(true);
  });
});

describe('fields that are the wrong shape', () => {
  it('does not hide anything on a `hiddenFrom` that is not an array', () => {
    // A string containing the uid would make `.includes` true on a substring. Refusing to read a
    // malformed field is the safe direction here: the calendar shows it, so this must too.
    expect(maySee(ev({ hiddenFrom: ME } as unknown as Partial<EventDoc>), ME)).toBe(true);
    expect(maySee(ev({ hiddenFrom: null } as unknown as Partial<EventDoc>), ME)).toBe(true);
    expect(maySee(ev({}), ME)).toBe(true);
  });

  it('does not grant anything on an `assigneeIds` that is not an array', () => {
    expect(maySee(ev({ assigneeIds: ME, hiddenFrom: [ME] } as unknown as Partial<EventDoc>), ME))
      .toBe(false);
  });
});

describe('an invitation nobody has answered yet', () => {
  it('is hidden from the invitee until they answer, as the app hides it', () => {
    expect(isPendingInvite(ev({ inviteeId: ME, inviteStatus: 'pending' }), ME)).toBe(true);
  });

  it('is not hidden once answered, nor from anybody else', () => {
    expect(isPendingInvite(ev({ inviteeId: ME, inviteStatus: 'accepted' }), ME)).toBe(false);
    expect(isPendingInvite(ev({ inviteeId: OTHER, inviteStatus: 'pending' }), ME)).toBe(false);
    expect(isPendingInvite(ev({}), ME)).toBe(false);
  });
});
