// src/hooks/useMenu.ts
//
// The overlays that are NOT windows: the notification bell, the hamburger, the floating button's
// three choices, the chat panel, the reaction picker, the two owner cards.
//
// Seven of them were left out of `useDialog` on purpose when twenty-two dialogs adopted it, and
// the note said why: a menu wants different rules. It closes when you click elsewhere, it is
// walked with the arrow keys, and it must NOT be `aria-modal`, because the page behind it is not
// blocked — announcing that it is would be a lie told to the one user who cannot see the screen.
// Handing them the dialog hook would have been wrong, not merely incomplete.
//
// What they DO share with a dialog is the one question that was answered wrong everywhere before
// `dialogStack` existed: am I the thing the user is looking at? So both kinds register on the same
// stack. The case that settles it is the owner card inside the event form — two stacks would mean
// one Escape closing the card AND the form under it, throwing away whatever had been typed. That
// is the original bug wearing a different hat.
//
// What is missing here on purpose: nothing decides anything. The arrow-key rules live in
// `menuNav`, the ordering in `dialogStack`, the history in `useOverlayHistory` — all runnable
// without a browser. What is left is wiring, which no unit test in this repo has a DOM to reach,
// so it is kept as thin as it can be made and proven on a real page instead.

import { useEffect, useId, useRef } from 'react';
import { openDialog, closeDialog, isTopDialog } from '../utils/dialogStack';
import { menuMoveFor, nextMenuIndex, type MenuOrientation } from '../utils/menuNav';
import { useOverlayHistory } from './useOverlayHistory';
import { focusableIn } from './focusables';

export interface MenuOptions {
  /**
   * What a screen reader announces. Pass the translated string — `t('notificationsTitle', language)`.
   * A menu with no name is announced as "menu", which tells the user nothing about which one.
   */
  label?: string;
  /**
   * `menu` for a list of commands — gets `role="menu"`, arrow keys, and closes on Tab.
   * `popover` for a panel of content that happens to float: the owner card, the notification list,
   * the chat pane. Those get a non-modal `role="dialog"` and keep ordinary Tab behaviour, because
   * their contents are not commands in a ring and pretending otherwise breaks the reading order.
   */
  kind?: 'menu' | 'popover';
  /** Which axis the arrow keys walk. Only meaningful for `kind: 'menu'`. */
  orientation?: MenuOrientation;
  /**
   * Whether a press outside closes it. True for everything small. FALSE for the chat pane, where
   * a stray tap on the calendar would take a half-typed message off the screen.
   */
  dismissOnOutsideClick?: boolean;
  /**
   * Whether the Android back button closes it. Off by default: a three-item dropdown is an
   * affordance, not a place, and an entry each would make Back feel like it is stuttering.
   */
  history?: boolean;
  /**
   * Whether opening moves focus inside. On by default — a menu the keyboard cannot reach is
   * decoration. Off for anything opened without a deliberate gesture.
   */
  autoFocus?: boolean;
  /**
   * What Escape does, when that is not simply "close".
   *
   * Only the chat pane needs this, and it needs it because Escape and Back are different gestures
   * there: Escape peels one layer — cancel the edit, else cancel the reply, else close — while
   * Back closes the pane outright. Routing both through `onClose` would leave Back cancelling a
   * reply and CONSUMING the pane's history entry on the way, so the next press would walk out of
   * the calendar with the pane still open.
   */
  onEscape?: () => void;
}

/**
 * Wire up one menu or popover.
 *
 * Call it unconditionally, above any early return, like every other hook:
 *
 *   const { menuRef, triggerRef, menuProps, triggerProps } =
 *     useMenu(isOpen, () => setIsOpen(false), { label: t('notificationsTitle', language) });
 *   ...
 *   <button ref={triggerRef} {...triggerProps} onClick={() => setIsOpen(!isOpen)}>…</button>
 *   {isOpen && <div ref={menuRef} {...menuProps} className="absolute …">…</div>}
 *
 * The trigger ref matters: without it, the press that opens the menu is also a press outside it,
 * and the menu would close in the same breath it opened — the classic version of this bug, where
 * the button simply "stops working".
 */
export function useMenu<Trigger extends HTMLElement = HTMLButtonElement>(
  isOpen: boolean,
  onClose: () => void,
  opts: MenuOptions = {},
) {
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  // Generic, defaulting to a button: `ref` is invariant in its element type, so a plain
  // `RefObject<HTMLElement>` would be rejected on every `<button ref={triggerRef}>` in the app.
  const triggerRef = useRef<Trigger>(null);

  // Kept in a ref so an inline arrow from the caller — which every one of them passes — does not
  // tear the listeners down and rebuild them on every render of the parent.
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(opts.onEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = opts.onEscape;
  }, [onClose, opts.onEscape]);

  const kind = opts.kind ?? 'menu';
  const orientation = opts.orientation ?? 'vertical';
  const dismissOnOutsideClick = opts.dismissOnOutsideClick !== false;
  const withHistory = opts.history === true;
  const autoFocus = opts.autoFocus !== false;

  useEffect(() => {
    if (!isOpen) return;

    // `false`: this is not a modal. It takes its place in the ordering — so Escape reaches it
    // first — without claiming the page behind it, which means no scroll lock and no taking the
    // Tab ring away from a dialog underneath.
    openDialog(id, false);

    const restoreTo = document.activeElement as HTMLElement | null;

    /**
     * The items the arrow keys walk. `role="menuitem"` when the caller has marked them, and every
     * focusable thing otherwise: a menu whose author forgot the roles should still be walkable.
     * Fail open, the same rule the dialog's Tab ring follows.
     */
    const itemsOf = (panel: HTMLElement): HTMLElement[] => {
      const marked = focusableIn(panel, '[role="menuitem"]');
      return marked.length ? marked : focusableIn(panel);
    };

    if (autoFocus) {
      const panel = menuRef.current;
      if (panel) {
        // A menu puts focus on its first command; a popover on the panel itself, so that Tab then
        // walks its contents in reading order and Shift+Tab returns to the trigger. `preventScroll`
        // because the reaction picker lives inside a scrolling message list, and a focus that
        // yanked the conversation to a different place would be its own bug.
        const first = kind === 'menu' ? itemsOf(panel)[0] : null;
        if (first) {
          first.focus({ preventScroll: true });
        } else {
          // tabindex="0", not "-1". A popover opened INSIDE a dialog is inside that dialog's Tab
          // ring, and the ring walks the elements it can see: with -1 the panel is invisible to
          // it, `indexOf` reports -1, and the next Tab jumps to the FIRST control of the form,
          // skipping the popover's own contents entirely. As a real tab stop it sits in document
          // order, so Tab from it walks into the popover, which is where the user is looking.
          if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '0');
          panel.focus({ preventScroll: true });
        }
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(id)) return;

      if (event.key === 'Escape') {
        // Deliberately BEFORE the panel lookup. An overlay whose `isOpen` is true while nothing is
        // rendered — a caller whose state outlives its parent, which this codebase produces —
        // would otherwise sit on top of the stack unable to be closed by the one key that exists
        // to close things. Escape needs no panel; it needs the caller's onClose.
        event.preventDefault();
        (onEscapeRef.current ?? onCloseRef.current)();
        return;
      }

      const panel = menuRef.current;
      if (!panel) return;
      if (kind !== 'menu') return;

      if (event.key === 'Tab') {
        // Tab leaves a menu. Focus is put back on the trigger rather than left to the browser's
        // default: by the time the default would run, React may already have unmounted the item
        // that had focus, and focus lost that way lands on `document.body` — the keyboard user
        // restarts from the top of the page. One extra Tab from the trigger is the smaller cost.
        event.preventDefault();
        onCloseRef.current();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }

      const move = menuMoveFor(event.key, orientation);
      if (!move) return;
      const items = itemsOf(panel);
      const next = nextMenuIndex(items.length, items.indexOf(document.activeElement as HTMLElement), move);
      // -1 means there was nothing to move to. Swallowing the key anyway would leave the page
      // unable to scroll with the arrows while an empty menu is open.
      if (next < 0) return;
      event.preventDefault();
      items[next].focus({ preventScroll: true });
    };

    // `pointerdown`, not `click`: the press that OPENED this menu has already had its pointerdown
    // dispatched by the time this effect runs, so it cannot close what it just opened. A `click`
    // listener added here would still receive that very click on its way up to the document and
    // the menu would never appear to open at all.
    //
    // Capture phase, because several menus in this app live inside handlers that stop propagation
    // on the way up, and "I clicked elsewhere and it stayed open" is the failure that follows.
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      // A node already detached from the document cannot be compared meaningfully — this happens
      // when a click removes its own element — and treating it as "outside" would close a menu the
      // user never pressed outside of.
      if (target instanceof Node && target.isConnected === false) return;
      if (menuRef.current?.contains(target)) return;
      // The trigger's own press is a toggle, handled by the trigger. Closing here as well would
      // close and reopen in the same gesture, which reads as a button that does nothing.
      if (triggerRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    if (dismissOnOutsideClick) document.addEventListener('pointerdown', onPointerDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (dismissOnOutsideClick) document.removeEventListener('pointerdown', onPointerDown, true);
      closeDialog(id);

      // Give focus back, but only if it is still inside the menu that is going away — or on the
      // body, where a click on the panel's own padding leaves it. If the user has already clicked
      // somewhere else, taking focus back would be the rude version of helpful.
      const panelNow = menuRef.current;
      const focusIsInside = panelNow ? panelNow.contains(document.activeElement) : false;
      if (focusIsInside || document.activeElement === document.body) {
        const back = triggerRef.current?.isConnected ? triggerRef.current : restoreTo;
        if (back?.isConnected) back.focus({ preventScroll: true });
      }
    };
  }, [isOpen, id, kind, orientation, dismissOnOutsideClick, autoFocus]);

  useOverlayHistory(isOpen, id, withHistory, () => onCloseRef.current());

  return {
    menuRef,
    triggerRef,
    menuProps: {
      // A popover is a dialog that does not block: same announcement, no `aria-modal`. Claiming
      // modality here would tell a screen-reader user the rest of the page is unavailable while
      // it plainly is not.
      role: (kind === 'menu' ? 'menu' : 'dialog') as 'menu' | 'dialog',
      ...(kind === 'menu' ? { 'aria-orientation': orientation } : {}),
      ...(opts.label ? { 'aria-label': opts.label } : {}),
    },
    triggerProps: {
      'aria-haspopup': (kind === 'menu' ? 'menu' : 'dialog') as 'menu' | 'dialog',
      'aria-expanded': isOpen,
    },
  };
}
