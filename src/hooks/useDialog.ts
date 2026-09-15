// src/hooks/useDialog.ts
//
// Everything a modal in this app has to do besides render itself.
//
// It replaces two habits that were repeated by hand in a dozen components and were wrong in the
// same way each time: a `keydown` listener on `window` that closed "the" modal, and a `popstate`
// listener that did the same for the Android back button. Neither could tell whether it was the
// modal the user was actually looking at. Opening an event, pressing Edit and hitting Escape
// closed the edit form and the details view underneath it together, discarding whatever had been
// typed; the back button additionally walked the app out of the calendar, because the lower
// modal's cleanup still found its own entry on top of the history stack and went back a second
// time.
//
// `dialogStack` answers "am I on top", and it is a plain module with plain tests. What is left
// here is the browser wiring, which the test suite has no DOM to exercise — so the rule is that
// anything decidable without a DOM is decided over there, not here.
//
// Also the accessibility the app never had: not one of its fifteen overlays carried role="dialog"
// or aria-modal, so a screen reader announced them as anonymous groups of text and let the user
// tab straight through into the page behind.

import { useEffect, useId, useRef } from 'react';
import {
  openDialog,
  closeDialog,
  isTopDialog,
  dialogDepth,
  nextFocusIndex,
  expectProgrammaticPop,
  isProgrammaticPop,
} from '../utils/dialogStack';

// Deliberately not `[tabindex]` in general: a container given tabindex="-1" to receive programmatic
// focus is not a tab stop, and including it would let Tab land on the panel itself.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    // `offsetParent` is null for anything display:none — a collapsed section, a step of a wizard
    // that is not on screen. Tabbing to an invisible control looks to the user like focus vanished.
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export interface DialogOptions {
  /**
   * What a screen reader announces when the dialog opens. Pass the same translated string the
   * heading shows — `t('createGroup', language)` — so the six languages stay in step without
   * threading an id onto every heading element.
   */
  label?: string;
  /**
   * Whether the Android hardware back button and the browser's Back should close this dialog.
   * On by default, which is what every existing caller of `useModalBack` wanted.
   */
  history?: boolean;
}

/**
 * Wire up one dialog.
 *
 * Call it unconditionally, next to the component's other hooks and ABOVE any
 * `if (!isOpen) return null` — a hook below an early return is React error #310, which this
 * codebase has already shipped to production once.
 *
 * Spread the returned props onto the overlay or panel element and attach the ref to the panel:
 *
 *   const { dialogRef, dialogProps } = useDialog(isOpen, onClose, { label: t('addEvent', language) });
 *   ...
 *   <div className="fixed inset-0 ...">
 *     <div ref={dialogRef} {...dialogProps} className="...panel...">
 */
export function useDialog(isOpen: boolean, onClose: () => void, opts: DialogOptions = {}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Kept in a ref so that a caller passing an inline arrow — which every one of them does — does
  // not tear the listeners down and build them up again on every render of the parent. The old
  // hand-written effects had `onClose` in their dependency array and did exactly that.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const withHistory = opts.history !== false;

  useEffect(() => {
    if (!isOpen) return;

    openDialog(id);

    // Where focus came from, so it can be given back. Without this, closing a dialog drops focus
    // on document.body and a keyboard user restarts from the top of the page every time.
    const restoreTo = document.activeElement as HTMLElement | null;

    // Ref-counted against the stack rather than a boolean: with two dialogs open, closing the
    // upper one must not unlock the page behind the lower one.
    //
    // The value to restore is NOT captured per dialog. That was the first version and it was
    // wrong: if the lower dialog closes first, the upper one's cleanup restores what it saw on
    // open — which was already 'hidden' — and the page stays unscrollable for the rest of the
    // session, with no error anywhere. Nothing else in this app writes body.overflow (App.tsx
    // touches only the background properties), so the baseline is simply empty.
    if (dialogDepth() === 1) document.body.style.overflow = 'hidden';

    // Focus the panel itself, never the first field. Focusing an input here would raise the
    // on-screen keyboard the instant any dialog opened on a phone, including ones that only ask
    // the user to confirm something.
    const panel = dialogRef.current;
    if (panel) {
      if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(id)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const current = dialogRef.current;
      if (!current) return;
      const items = focusableIn(current);
      const next = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      // Fail OPEN. If the panel holds nothing focusable — because the query missed a custom
      // control, or a list rendered as clickable divs, which this app does — then swallowing Tab
      // would leave the keyboard user with no way out of a dialog and no way through it. A trap
      // that is wrong should leak, not lock.
      if (next < 0) return;
      event.preventDefault();
      items[next].focus();
    };

    window.addEventListener('keydown', onKeyDown);

    // The back button. One history entry per open dialog, popped by whichever is on top.
    let pushed = false;
    const marker = `dialog:${id}`;
    const onPopState = (event: PopStateEvent) => {
      // A rewind this app started on some other dialog's way out is not the user pressing Back.
      // Without this the dialog underneath closes too, which is the very bug the stack exists
      // to prevent — it just arrives by the history route instead of the keyboard one.
      if (isProgrammaticPop(event)) return;
      if (!isTopDialog(id)) return;
      pushed = false; // the entry this dialog pushed is the one that was just popped
      onCloseRef.current();
    };
    if (withHistory) {
      window.history.pushState({ dialogMarker: marker }, '');
      pushed = true;
      window.addEventListener('popstate', onPopState);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (withHistory) window.removeEventListener('popstate', onPopState);
      closeDialog(id);

      if (dialogDepth() === 0) document.body.style.overflow = '';

      // Only wind the history back if this dialog's own entry is still the current one — that is,
      // it was closed by its own X or backdrop rather than by the back button that already popped
      // it. Checking the marker rather than a bare flag keeps a second dialog's entry from being
      // mistaken for this one's.
      if (withHistory && pushed && window.history.state?.dialogMarker === marker) {
        expectProgrammaticPop();
        window.history.back();
      }

      // Give focus back, but only if it is still inside the dialog that is going away. If the user
      // has already clicked somewhere else, stealing it back would be the rude version of helpful.
      const panelNow = dialogRef.current;
      const focusIsInside = panelNow ? panelNow.contains(document.activeElement) : false;
      if ((focusIsInside || document.activeElement === document.body) && restoreTo?.isConnected) {
        restoreTo.focus({ preventScroll: true });
      }
    };
  }, [isOpen, id, withHistory]);

  return {
    dialogRef,
    dialogProps: {
      role: 'dialog' as const,
      'aria-modal': true,
      ...(opts.label ? { 'aria-label': opts.label } : {}),
    },
  };
}
