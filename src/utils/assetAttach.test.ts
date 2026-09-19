// src/utils/assetAttach.test.ts
//
// The live error of 18.09, as something that runs in a second.

import { describe, it, expect } from 'vitest';
import { shareOnAttach, sharesForAttachments, unsharedAttachedCards } from './assetAttach';

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

describe('the same refusal on an event that is already saved', () => {
  // Sharing happens when somebody presses Save. Everything attached BEFORE 18.09 is still
  // private and will not re-save itself: measured on live on 19.09, all 18 assets private, two
  // attachments on group events, one of them hiding a scannable code from the other member.
  const event = (over: Record<string, unknown> = {}) => ({
    groupId: FAMILY, assetId: null, checklistItems: [], ...over,
  });

  it('names the private card sitting on a group event', () => {
    expect(unsharedAttachedCards(event({ assetId: 'a1' }), ALL, ME)).toEqual([
      { assetId: 'a1', sharedGroupId: FAMILY },
    ]);
  });

  it('looks at the checklist as well as the event image', () => {
    const ev = event({ assetId: null, checklistItems: [{ text: 'Lapte', assetId: 'a1' }] });
    expect(unsharedAttachedCards(ev, ALL, ME)).toEqual([{ assetId: 'a1', sharedGroupId: FAMILY }]);
  });

  it('asks once for a card attached in two places', () => {
    const ev = event({ assetId: 'a1', checklistItems: [{ assetId: 'a1' }, { assetId: 'a1' }] });
    expect(unsharedAttachedCards(ev, ALL, ME)).toEqual([{ assetId: 'a1', sharedGroupId: FAMILY }]);
  });

  it('counts a ticked item too, because ticking a box is not unattaching', () => {
    // The barcode is hidden while the item is done; the card is still on the event, and the
    // save path shares it. Two answers to one question is how they drift apart.
    const ev = event({ checklistItems: [{ assetId: 'a1', isCompleted: true }] });
    expect(unsharedAttachedCards(ev, ALL, ME)).toEqual([{ assetId: 'a1', sharedGroupId: FAMILY }]);
  });

  it('is silent once the card is shared with this group', () => {
    expect(unsharedAttachedCards(event({ assetId: 'a2' }), ALL, ME)).toEqual([]);
  });

  it('is silent about a card that is not mine \u2014 I could not write it anyway', () => {
    expect(unsharedAttachedCards(event({ assetId: 'a4' }), ALL, ME)).toEqual([]);
  });

  it('is silent about a card shared with another group', () => {
    expect(unsharedAttachedCards(event({ assetId: 'a3' }), ALL, ME)).toEqual([]);
  });

  it('is silent on a personal event', () => {
    expect(unsharedAttachedCards(event({ groupId: null, assetId: 'a1' }), ALL, ME)).toEqual([]);
  });

  it('is silent about a card that did not load, so it never names one I cannot read', () => {
    // The list is built from the documents that came back. A refused read leaves nothing to
    // name, which is right: a card I cannot read is not a card I can share.
    expect(unsharedAttachedCards(event({ assetId: 'a1' }), [], ME)).toEqual([]);
  });

  it('survives an event with nothing on it', () => {
    expect(unsharedAttachedCards(null, ALL, ME)).toEqual([]);
    expect(unsharedAttachedCards(undefined, ALL, ME)).toEqual([]);
    expect(unsharedAttachedCards({}, ALL, ME)).toEqual([]);
    expect(unsharedAttachedCards({ groupId: FAMILY, checklistItems: 'not a list' }, ALL, ME)).toEqual([]);
    expect(unsharedAttachedCards({ groupId: FAMILY, checklistItems: [null, {}] }, ALL, ME)).toEqual([]);
  });
});
