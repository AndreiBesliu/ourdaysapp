// src/hooks/focusables.ts
//
// What counts as a place focus can land, inside an overlay.
//
// Shared by `useDialog` (which rings them for Tab) and `useMenu` (which walks them with the arrow
// keys). Written down once: the two would have drifted on the very first custom control added to
// either list, and the drift would show as "Tab reaches it but the arrows skip it" — the kind of
// difference nobody reports, they just stop using the keyboard.

// Deliberately not `[tabindex]` in general: a container given tabindex="-1" to receive programmatic
// focus is not a tab stop, and including it would let Tab land on the panel itself.
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(panel: HTMLElement, selector: string = FOCUSABLE): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(selector))
    // `offsetParent` is null for anything display:none — a collapsed section, a step of a wizard
    // that is not on screen. Tabbing to an invisible control looks to the user like focus vanished.
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}
