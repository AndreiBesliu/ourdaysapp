// src/utils/walletCategories.test.ts
//
// Deleting a wallet category, as something that runs in a second.

import { describe, it, expect } from 'vitest';
import {
  UNCATEGORIZED, categoriesOf, affectedByRemoval, afterRemoval, orphanCategories,
} from './walletCategories';

const ME = 'u1', EMILIA = 'u5';

describe('the two fields a card carries', () => {
  it('reads the array first, because every read path on the screen does', () => {
    expect(categoriesOf({ categories: ['Loyalty', 'Cards'], category: 'Loyalty' }))
      .toEqual(['Loyalty', 'Cards']);
  });

  it('still sees a card written before the array existed', () => {
    expect(categoriesOf({ category: 'Vehicles' })).toEqual(['Vehicles']);
  });

  it('keeps a legacy value the array forgot, rather than losing it quietly', () => {
    // The pair CAN disagree. Measured on live: today they do not, on any of the 18 cards. That is
    // a fact about today, not a guarantee, and dropping the odd one out would be silent.
    expect(categoriesOf({ categories: ['Cards'], category: 'Loyalty' })).toEqual(['Cards', 'Loyalty']);
  });

  it('is empty, never undefined, for a card with nothing on it', () => {
    expect(categoriesOf({})).toEqual([]);
    expect(categoriesOf(null)).toEqual([]);
    expect(categoriesOf({ categories: 'not a list', category: '  ' })).toEqual([]);
  });
});

describe('which cards a deletion has to touch', () => {
  const mine = { id: 'a1', ownerId: ME, categories: ['Cards'], category: 'Cards' };
  const arrayOnly = { id: 'a2', ownerId: ME, categories: ['Cards'], category: 'Loyalty' };
  const legacyOnly = { id: 'a3', ownerId: ME, category: 'Cards' };
  const hers = { id: 'a4', ownerId: EMILIA, categories: ['Cards'], category: 'Cards' };
  const ALL = [mine, arrayOnly, legacyOnly, hers];

  it('finds the card the old code walked past', () => {
    // The old selector was `a.category === catName`, so `arrayOnly` — whose legacy field says
    // something else entirely — was never touched and kept the deleted name for ever.
    expect(affectedByRemoval(ALL, 'Cards', ME).map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('does not touch somebody else’s card', () => {
    // The rules refuse the write anyway; attempting it turns a deletion into a permission error.
    expect(affectedByRemoval(ALL, 'Cards', ME).some((a) => a.id === 'a4')).toBe(false);
  });

  it('is empty for a name nobody carries', () => {
    expect(affectedByRemoval(ALL, 'Nothing', ME)).toEqual([]);
    expect(affectedByRemoval(ALL, '', ME)).toEqual([]);
    expect(affectedByRemoval(ALL, null, ME)).toEqual([]);
  });
});

describe('what a touched card becomes', () => {
  it('removes the name from the array, not only from the legacy field', () => {
    expect(afterRemoval({ categories: ['Cards', 'Loyalty'], category: 'Cards' }, 'Cards'))
      .toEqual({ categories: ['Loyalty'], category: 'Loyalty' });
  });

  it('keeps the legacy field in step with the head of the array', () => {
    // The save path writes `category: selected[0] || 'Uncategorized'`. A cleaned card and a
    // freshly saved one have to look the same, or the next read disagrees with itself.
    const out = afterRemoval({ categories: ['Cards', 'Vehicles', 'Financial'], category: 'Cards' }, 'Cards');
    expect(out.categories[0]).toBe('Vehicles');
    expect(out.category).toBe('Vehicles');
  });

  it('falls back when the last category goes', () => {
    expect(afterRemoval({ categories: ['Cards'], category: 'Cards' }, 'Cards'))
      .toEqual({ categories: [], category: UNCATEGORIZED });
  });

  it('leaves a card that does not carry the name exactly as it was', () => {
    expect(afterRemoval({ categories: ['Loyalty'], category: 'Loyalty' }, 'Cards'))
      .toEqual({ categories: ['Loyalty'], category: 'Loyalty' });
  });
});

describe('the names with no way back', () => {
  const listed = ['Home & Living', 'Health & Medical', 'Vehicles', 'Financial'];
  const assets = [
    { id: 'a1', ownerId: ME, categories: ['Cards', 'Loyalty'], category: 'Cards' },
    { id: 'a2', ownerId: ME, categories: ['Vehicles'], category: 'Vehicles' },
    { id: 'a3', ownerId: ME, categories: [], category: UNCATEGORIZED },
    { id: 'a4', ownerId: EMILIA, categories: ['Ghost of hers'], category: 'Ghost of hers' },
  ];

  it('names what the list has lost, so the owner can act on it', () => {
    // Measured on live: five cards carry a name their owner's list does not have. The screen
    // groups by those names and offers no control for them at all.
    expect(orphanCategories(assets, listed, ME)).toEqual(['Cards', 'Loyalty']);
  });

  it('does not offer to manage the fallback', () => {
    // `Uncategorized` is where cards go, not a category anybody keeps.
    expect(orphanCategories(assets, listed, ME)).not.toContain(UNCATEGORIZED);
  });

  it('does not report somebody else’s orphan, which I could not repair anyway', () => {
    expect(orphanCategories(assets, listed, ME)).not.toContain('Ghost of hers');
  });

  it('is empty when the list already covers everything', () => {
    expect(orphanCategories([assets[1], assets[2]], listed, ME)).toEqual([]);
    expect(orphanCategories([], listed, ME)).toEqual([]);
  });

  it('closes the loop: deleting an orphan clears it, and it stops being reported', () => {
    // The point of listing them. Without this the two halves could each be right separately and
    // still not add up to a repair.
    const touched = affectedByRemoval(assets, 'Cards', ME);
    const cleaned = assets.map((a) =>
      touched.includes(a) ? { ...a, ...afterRemoval(a, 'Cards') } : a);
    expect(orphanCategories(cleaned, listed, ME)).toEqual(['Loyalty']);
  });
});
