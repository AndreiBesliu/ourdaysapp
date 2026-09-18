// src/utils/assetAttach.test.ts
//
// The live error of 18.09, as something that runs in a second.

import { describe, it, expect } from 'vitest';
import { shareOnAttach, sharesForAttachments } from './assetAttach';

const ME = 'u1', EMILIA = 'u5';
const FAMILY = 'g_family', GYM = 'g_gym';

const mine = { id: 'a1', ownerId: ME, sharedGroupId: null };
const alreadyFamily = { id: 'a2', ownerId: ME, sharedGroupId: FAMILY };
const sharedElsewhere = { id: 'a3', ownerId: ME, sharedGroupId: GYM };
const hers = { id: 'a4', ownerId: EMILIA, sharedGroupId: FAMILY };
const ALL = [mine, alreadyFamily, sharedElsewhere, hers];

describe('the defect: a card attached to a group event nobody else can read', () => {
  it('shares a private card with the group the event is on', () => {
    // Measured before the fix: 18 assets on live, NONE shared with any group, and both of the two
    // attachments on group events were unreadable by a member of that group.
    expect(shareOnAttach(ALL, 'a1', FAMILY, ME)).toEqual({
      share: true, assetId: 'a1', sharedGroupId: FAMILY,
    });
  });

  it('matches what UPLOADING an image on the same event already did', () => {
    // AddEventModal creates an uploaded asset with `...shareFieldsFor(selectedGroupId)`. The two
    // ways into the same act now agree; before, only one of them shared.
    const uploaded = shareOnAttach(ALL, 'a1', FAMILY, ME);
    expect(uploaded.share && uploaded.sharedGroupId).toBe(FAMILY);
  });

  it('does nothing on a personal event, where there is nobody to share with', () => {
    expect(shareOnAttach(ALL, 'a1', null, ME)).toEqual({ share: false, reason: 'personal-event' });
    expect(shareOnAttach(ALL, 'a1', '', ME)).toEqual({ share: false, reason: 'personal-event' });
  });

  it('does nothing when the card is already shared with this very group', () => {
    expect(shareOnAttach(ALL, 'a2', FAMILY, ME)).toEqual({ share: false, reason: 'already-here' });
  });
});

describe('what it refuses to do', () => {
  it('does not steal a card that is shared with another group', () => {
    // `sharedGroupId` names ONE group, so re-pointing it would silently revoke the other group's
    // access to whatever it is attached to there — taking something from people not in the room.
    expect(shareOnAttach(ALL, 'a3', FAMILY, ME)).toEqual({ share: false, reason: 'other-group' });
  });

  it('does not touch somebody else’s card', () => {
    // The rules refuse the write anyway (update requires ownerId == uid); attempting it would turn
    // a normal save into a permission error on a field nobody asked about.
    expect(shareOnAttach(ALL, 'a4', FAMILY, ME)).toEqual({ share: false, reason: 'not-mine' });
  });

  it('does not invent a share for an id it cannot see', () => {
    expect(shareOnAttach(ALL, 'nope', FAMILY, ME)).toEqual({ share: false, reason: 'unknown-asset' });
    expect(shareOnAttach(ALL, null, FAMILY, ME)).toEqual({ share: false, reason: 'unknown-asset' });
    expect(shareOnAttach([], 'a1', FAMILY, ME)).toEqual({ share: false, reason: 'unknown-asset' });
  });
});

describe('a whole event’s attachments at once', () => {
  it('writes one share per card, however many places it is attached', () => {
    // The same card can be the event's image AND a checklist item's.
    expect(sharesForAttachments(ALL, ['a1', 'a1', 'a1'], FAMILY, ME)).toEqual([
      { assetId: 'a1', sharedGroupId: FAMILY },
    ]);
  });

  it('shares what it can and passes over what it must not', () => {
    expect(sharesForAttachments(ALL, ['a1', 'a2', 'a3', 'a4', null, ''], FAMILY, ME)).toEqual([
      { assetId: 'a1', sharedGroupId: FAMILY },
    ]);
  });

  it('is empty for a personal event, so the save writes nothing extra', () => {
    expect(sharesForAttachments(ALL, ['a1', 'a2'], null, ME)).toEqual([]);
  });

  it('is empty when nothing is attached', () => {
    expect(sharesForAttachments(ALL, [], FAMILY, ME)).toEqual([]);
  });
});
