// src/utils/rummyHand.test.ts
//
// A Rummy hand is a row of POSITIONS, not a list of cards. Attaching a card to a meld leaves a
// `null` behind, so the remaining cards do not shuffle sideways under the player's fingers
// mid-turn. `calculatePenaltyPoints` has always declared that in its signature:
// `hand: (RummyCard | null)[]`.
//
// The component then wrote the same selection filter in three places and guarded it in two.
// The third was `stageMeld`:
//
//     const cardsToMeld = localHand.filter(c => selectedCards.includes(c.id));
//
// `.id` on an empty slot throws. The route to it is ordinary play, not a corner case: attach a
// card to a meld — which is what CREATES the gap — then select cards and lay down another meld.
// Mid-game, mid-turn, with everything on screen gone.
//
// The fix was not a `c &&`. It was deleting the duplication that made the omission possible, and
// this file is what holds the single version honest.

import { describe, it, expect } from 'vitest';
import { selectedFrom, calculatePenaltyPoints, type RummyCard } from '../components/games/rummy/RummyEngine';

const card = (id: string, value: string, suit: RummyCard['suit'] = 'hearts'): RummyCard =>
  ({ id, value, suit } as RummyCard);

describe('selecting from a hand with gaps in it', () => {
  it('does not throw on an empty slot — the crash that shipped', () => {
    const hand = [card('a', '7'), null, card('b', '8')];
    expect(() => selectedFrom(hand, ['a', 'b'])).not.toThrow();
    expect(selectedFrom(hand, ['a', 'b']).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('survives a hand that is nothing but gaps', () => {
    // Reachable: lay down every card you hold and the row is all empty slots until the next draw.
    expect(selectedFrom([null, null, null], ['a'])).toEqual([]);
    expect(selectedFrom([], ['a'])).toEqual([]);
  });

  it('returns only what was selected, in hand order', () => {
    const hand = [card('a', '7'), card('b', '8'), null, card('c', '9')];
    expect(selectedFrom(hand, ['c', 'a']).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('ignores an id that is not in the hand', () => {
    // The selection is held in its own state and survives a hand that has moved on beneath it.
    expect(selectedFrom([card('a', '7')], ['ghost']).map((c) => c.id)).toEqual([]);
  });

  it('selects nothing when nothing is selected', () => {
    expect(selectedFrom([card('a', '7'), null], [])).toEqual([]);
  });
});

describe('the rest of the engine agrees that a slot can be empty', () => {
  it('scores a hand with gaps without throwing', () => {
    // The precedent this whole fix rests on: the engine's own signature has said
    // `(RummyCard | null)[]` all along. Only the component forgot.
    expect(() => calculatePenaltyPoints([card('a', '7'), null, card('b', 'K')])).not.toThrow();
    expect(calculatePenaltyPoints([null, null])).toBe(0);
  });
});
