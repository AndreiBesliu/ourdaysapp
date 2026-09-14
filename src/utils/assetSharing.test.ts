// src/utils/assetSharing.test.ts
//
// The wallet told people their loyalty cards were shared with their family for months. They were
// not: the read rule was `ownerId == request.auth.uid` and no listener ever asked for anything
// else, so the green "Shared" badge was decoration over a document only its owner could read.
//
// These tests pin the two things that made that possible: a share state derived from a field
// nobody could act on, and a boolean where the answer is a group.

import { describe, it, expect } from 'vitest';
import {
  canEdit, groupNameOf, mergeAssets, shareFieldsFor, shareKindOf, shareListenerGroupIds,
  shareTargetOf,
} from './assetSharing';

const ME = 'uid-me';
const THEM = 'uid-them';

describe('shareTargetOf', () => {
  it('reads a real group id', () => {
    expect(shareTargetOf({ sharedGroupId: 'g1' })).toBe('g1');
  });

  it('treats absent, null and blank as private', () => {
    expect(shareTargetOf({})).toBeNull();
    expect(shareTargetOf({ sharedGroupId: null })).toBeNull();
    expect(shareTargetOf({ sharedGroupId: '   ' })).toBeNull();
    expect(shareTargetOf(undefined)).toBeNull();
  });

  it("refuses the literal 'personal', which is the UI's word for no group", () => {
    // `selectedGroupId` is 'personal' when no group is chosen, and it used to be compared with
    // `!== 'personal'` at the call site. If that string ever reaches the field, the rule would
    // look up a group document called "personal" — and `groups/personal` is a perfectly valid
    // Firestore path, so the failure would be a silent miss rather than an error.
    expect(shareTargetOf({ sharedGroupId: 'personal' })).toBeNull();
  });
});

describe('shareKindOf', () => {
  it('mine and unshared is private', () => {
    expect(shareKindOf({ ownerId: ME }, ME)).toBe('private');
  });

  it('mine and pointed at a group is shared', () => {
    expect(shareKindOf({ ownerId: ME, sharedGroupId: 'g1' }, ME)).toBe('shared');
  });

  it("somebody else's is always 'fromOthers', even if it names a group", () => {
    expect(shareKindOf({ ownerId: THEM, sharedGroupId: 'g1' }, ME)).toBe('fromOthers');
    expect(shareKindOf({ ownerId: THEM }, ME)).toBe('fromOthers');
  });

  it('the old boolean with no group is named for what it is: never actually shared', () => {
    // This is the whole legacy population. Rendering it as a plain "Private" would read as this
    // change having revoked something, when in truth nothing was ever granted.
    expect(shareKindOf({ ownerId: ME, sharedWithFamily: true }, ME)).toBe('neverShared');
  });

  it('a real group id wins over the legacy boolean, whatever the boolean says', () => {
    expect(shareKindOf({ ownerId: ME, sharedGroupId: 'g1', sharedWithFamily: false }, ME)).toBe('shared');
  });

  it('a signed-out reader owns nothing', () => {
    expect(shareKindOf({ ownerId: ME }, undefined)).toBe('fromOthers');
    expect(shareKindOf({ ownerId: undefined }, undefined)).toBe('fromOthers');
  });
});

describe('canEdit', () => {
  it('is the owner, and nobody else', () => {
    expect(canEdit({ ownerId: ME }, ME)).toBe(true);
    expect(canEdit({ ownerId: THEM }, ME)).toBe(false);
    expect(canEdit({ ownerId: ME }, null)).toBe(false);
  });

  it('does not soften for an asset shared with me', () => {
    // The rules refuse the write regardless; the card must not offer a button that will fail.
    expect(canEdit({ ownerId: THEM, sharedGroupId: 'g1' }, ME)).toBe(false);
  });
});

describe('shareFieldsFor', () => {
  it('keeps the legacy boolean DERIVED, so the two fields cannot disagree', () => {
    expect(shareFieldsFor('g1')).toEqual({ sharedGroupId: 'g1', sharedWithFamily: true });
    expect(shareFieldsFor(null)).toEqual({ sharedGroupId: null, sharedWithFamily: false });
    expect(shareFieldsFor(undefined)).toEqual({ sharedGroupId: null, sharedWithFamily: false });
  });

  it("never writes 'personal' as a group", () => {
    expect(shareFieldsFor('personal')).toEqual({ sharedGroupId: null, sharedWithFamily: false });
  });

  it('always writes both fields, so unsharing actually clears the old one', () => {
    // A partial update that set only `sharedGroupId: null` would leave `sharedWithFamily: true`
    // behind, and the card would go straight back to claiming a sharing that does not exist.
    expect(Object.keys(shareFieldsFor(null)).sort()).toEqual(['sharedGroupId', 'sharedWithFamily']);
  });
});

describe('mergeAssets', () => {
  it('keeps my own copy of an asset that arrives from both listeners', () => {
    const mine = { id: 'a1', ownerId: ME, sharedGroupId: 'g1', name: 'mine' };
    const viaGroup = { id: 'a1', ownerId: ME, sharedGroupId: 'g1', name: 'copy' };
    const merged = mergeAssets([mine], [[viaGroup]]);
    expect(merged).toHaveLength(1);
    // Identity, not equality: the surviving object must be the one the edit controls belong to.
    expect(merged[0]).toBe(mine);
  });

  it('dedupes across several groups', () => {
    const a = { id: 'a1', ownerId: THEM };
    const merged = mergeAssets([], [[a], [a], [{ id: 'a2', ownerId: THEM }]]);
    expect(merged.map((x) => x.id)).toEqual(['a1', 'a2']);
  });

  it('puts what I own first', () => {
    const merged = mergeAssets(
      [{ id: 'mine', ownerId: ME }],
      [[{ id: 'theirs', ownerId: THEM }]],
    );
    expect(merged.map((x) => x.id)).toEqual(['mine', 'theirs']);
  });

  it('drops entries with no id rather than rendering a keyless card', () => {
    expect(mergeAssets([{ ownerId: ME } as any], [])).toEqual([]);
  });

  it('is empty for empty input', () => {
    expect(mergeAssets([], [])).toEqual([]);
    expect(mergeAssets([], [[], []])).toEqual([]);
  });
});

describe('shareListenerGroupIds', () => {
  it('returns nothing for no groups, so no listener is opened', () => {
    expect(shareListenerGroupIds([])).toEqual([]);
  });

  it("skips 'personal' and duplicates", () => {
    expect(shareListenerGroupIds([
      { id: 'g1' }, { id: 'personal' }, { id: 'g1' }, { id: 'g2' },
    ])).toEqual(['g1', 'g2']);
  });

  it('survives a malformed group row', () => {
    expect(shareListenerGroupIds([{ id: '' }, null as any, { id: 'g3' }])).toEqual(['g3']);
  });
});

describe('groupNameOf', () => {
  const groups = [{ id: 'g1', name: 'Family' }, { id: 'g2', name: '  ' }];

  it('names the group', () => {
    expect(groupNameOf(groups, 'g1')).toBe('Family');
  });

  it('returns null when the name is blank or the group is not ours to see', () => {
    expect(groupNameOf(groups, 'g2')).toBeNull();
    expect(groupNameOf(groups, 'g-unknown')).toBeNull();
    expect(groupNameOf(groups, null)).toBeNull();
  });
});
