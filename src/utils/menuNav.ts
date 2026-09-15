// src/utils/menuNav.ts
//
// Where the arrow keys move inside an open menu.
//
// A menu is not a dialog. A dialog traps Tab in a ring and that is the whole story; a menu is a
// single control whose ITEMS are reached with the arrow keys, exactly one of which is a tab stop.
// That is what a screen reader announces when it reads `role="menu"`, and promising it without
// implementing it is worse than not claiming it at all.
//
// Free of React and of the DOM, like `dialogStack`, for the same reason: this is the part with
// rules, so this is the part that has to be runnable in a plain test.

/** What a key press means, once the menu's orientation has been taken into account. */
export type MenuMove = 'next' | 'previous' | 'first' | 'last';

export type MenuOrientation = 'vertical' | 'horizontal';

/**
 * Which move a key means, or null for "not ours — let it through".
 *
 * Only the axis the menu actually runs along is claimed. A vertical menu that also swallowed
 * Left and Right would be taking keys it has no use for, and in this app a popover can hold a
 * text input: stealing Left from someone moving the caret inside their own half-typed message
 * would be a bug with no upside. The unclaimed axis is left alone on purpose.
 */
export function menuMoveFor(key: string, orientation: MenuOrientation = 'vertical'): MenuMove | null {
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (orientation === 'horizontal') {
    if (key === 'ArrowRight') return 'next';
    if (key === 'ArrowLeft') return 'previous';
    return null;
  }
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'previous';
  return null;
}

/**
 * The index to focus next.
 *
 * `current` is the index of the focused item, or -1 when focus is elsewhere — which happens more
 * than one would think: the menu was opened by a click and focus is still on the trigger, or the
 * user clicked the menu's own padding and landed on `document.body`.
 *
 * Returns -1 for "there is nothing to move to", which the caller reads as "do nothing" and, more
 * importantly, as "do not preventDefault" — swallowing a key without moving anything is how a
 * keyboard user ends up stuck.
 */
export function nextMenuIndex(count: number, current: number, move: MenuMove): number {
  if (count <= 0) return -1;
  if (move === 'first') return 0;
  if (move === 'last') return count - 1;
  // Focus outside the menu: Down enters at the top, Up at the bottom. This is also the path taken
  // the first time an arrow is pressed after opening with the mouse.
  if (current < 0 || current >= count) return move === 'next' ? 0 : count - 1;
  // Wrapping, because a menu is a ring: holding Down past the last item returning to the first is
  // what every desktop menu does, and stopping dead at the end reads as a broken key.
  return move === 'next' ? (current + 1) % count : (current - 1 + count) % count;
}
