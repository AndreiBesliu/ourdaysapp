// src/utils/menuNav.test.ts
//
// Arrow-key movement inside a menu. Pure, so the part with rules is the part that gets run —
// the wiring around it lives in a hook no test in this repo has a DOM to reach.

import { describe, it, expect } from 'vitest';
import { menuMoveFor, nextMenuIndex } from './menuNav';

describe('which keys a menu claims', () => {
  it('walks a vertical menu with Up and Down', () => {
    expect(menuMoveFor('ArrowDown')).toBe('next');
    expect(menuMoveFor('ArrowUp')).toBe('previous');
  });

  it('walks a horizontal one with Left and Right', () => {
    expect(menuMoveFor('ArrowRight', 'horizontal')).toBe('next');
    expect(menuMoveFor('ArrowLeft', 'horizontal')).toBe('previous');
  });

  it('jumps to the ends with Home and End, whichever way it runs', () => {
    expect(menuMoveFor('Home')).toBe('first');
    expect(menuMoveFor('End')).toBe('last');
    expect(menuMoveFor('Home', 'horizontal')).toBe('first');
    expect(menuMoveFor('End', 'horizontal')).toBe('last');
  });

  it('leaves the OTHER axis alone', () => {
    // Not pedantry: a popover in this app can hold a text input, and swallowing Left from somebody
    // moving the caret through their own half-typed message would be a bug with no upside.
    expect(menuMoveFor('ArrowLeft')).toBeNull();
    expect(menuMoveFor('ArrowRight')).toBeNull();
    expect(menuMoveFor('ArrowUp', 'horizontal')).toBeNull();
    expect(menuMoveFor('ArrowDown', 'horizontal')).toBeNull();
  });

  it('claims nothing else, so every other key reaches the page', () => {
    for (const key of ['Enter', ' ', 'Escape', 'Tab', 'a', 'PageDown', 'ArrowDow']) {
      expect(menuMoveFor(key)).toBeNull();
    }
  });
});

describe('where focus lands', () => {
  it('steps forward and back', () => {
    expect(nextMenuIndex(3, 0, 'next')).toBe(1);
    expect(nextMenuIndex(3, 2, 'previous')).toBe(1);
  });

  it('wraps at both ends, because a menu is a ring', () => {
    expect(nextMenuIndex(3, 2, 'next')).toBe(0);
    expect(nextMenuIndex(3, 0, 'previous')).toBe(2);
  });

  it('jumps to either end', () => {
    expect(nextMenuIndex(4, 2, 'first')).toBe(0);
    expect(nextMenuIndex(4, 2, 'last')).toBe(3);
  });

  it('enters from the top on Down and from the bottom on Up when focus is outside', () => {
    // The usual case right after opening with the mouse: focus is still on the trigger, so the
    // menu holds nothing focused and `indexOf` reports -1.
    expect(nextMenuIndex(3, -1, 'next')).toBe(0);
    expect(nextMenuIndex(3, -1, 'previous')).toBe(2);
  });

  it('treats an index past the end the same as being outside', () => {
    // An item can be removed between the key press and the lookup — a notification deleted by the
    // row's own button, say. Reading past the end would be undefined.
    expect(nextMenuIndex(2, 7, 'next')).toBe(0);
    expect(nextMenuIndex(2, 7, 'previous')).toBe(1);
  });

  it('says "nothing to do" for an empty menu rather than moving to item zero', () => {
    // -1 is what stops the caller calling preventDefault: swallowing the arrow keys while an
    // empty menu is open would leave the page unable to scroll and nothing to show for it.
    for (const move of ['next', 'previous', 'first', 'last'] as const) {
      expect(nextMenuIndex(0, -1, move)).toBe(-1);
    }
  });

  it('stays put in a menu of one', () => {
    expect(nextMenuIndex(1, 0, 'next')).toBe(0);
    expect(nextMenuIndex(1, 0, 'previous')).toBe(0);
  });
});
