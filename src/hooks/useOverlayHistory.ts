// src/hooks/useOverlayHistory.ts
//
// One history entry per open overlay, and the Android back button that pops it.
//
// This was inside `useDialog` until a second kind of overlay needed it — the floating chat panel,
// where Back today walks the user out of the calendar entirely and leaves the panel behind. The
// rules here took a browser harness and two wrong versions to get right, so they exist ONCE:
// a fact written in two places drifts, and the half that drifts is the half nobody is watching.

import { useEffect, useRef } from 'react';
import {
  pushHistoryOwner,
  dropHistoryOwner,
  isTopHistoryOwner,
  expectProgrammaticPop,
  isProgrammaticPop,
  hasPendingProgrammaticPop,
} from '../utils/dialogStack';

/**
 * Push an entry while `isOpen`, and call `onBack` when the user pops it.
 *
 * `id` must be the same id the overlay registered on the stack, so that "am I on top" is asked of
 * the same identity that Escape asks it of.
 *
 * `enabled` is false for overlays that should not own a history entry at all — a three-item
 * dropdown is an affordance, not a place, and giving every one of them an entry would make Back
 * feel like it is stuttering.
 */
export function useOverlayHistory(isOpen: boolean, id: string, enabled: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!isOpen || !enabled) return;

    let pushed = false;
    let pushWhenSettled: (() => void) | null = null;
    const marker = `dialog:${id}`;
    const push = () => {
      window.history.pushState({ dialogMarker: marker }, '');
      pushed = true;
    };

    const onPopState = (event: PopStateEvent) => {
      // A rewind this app started on some other overlay's way out is not the user pressing Back.
      // Without this the overlay underneath closes too, which is the very bug the stack exists
      // to prevent — it just arrives by the history route instead of the keyboard one.
      if (isProgrammaticPop(event)) {
        // And if THIS overlay opened while that rewind was still in flight, its own entry was
        // held back until now — see below. The rewind has landed; nothing can traverse over it.
        if (pushWhenSettled) {
          const settled = pushWhenSettled;
          pushWhenSettled = null;
          settled();
        }
        return;
      }
      // The last overlay to have PUSHED, not the top of the overlay stack. Those differ the
      // moment a menu or popover floats above a dialog: the menu pushed nothing, so if the dialog
      // stood down here, nobody would be listening for a pop that had already happened. One dead
      // Back press, then the next one leaves the screen with the dialog still open.
      if (!isTopHistoryOwner(id)) return;
      pushed = false; // the entry this overlay pushed is the one that was just popped
      onBackRef.current();
    };

    // Registered before the push rather than after it, because the push itself can be deferred
    // while somebody else's rewind is in flight — and ownership is about which overlay WILL answer
    // for the newest entry, not about the instant the entry appears.
    pushHistoryOwner(id);
    window.addEventListener('popstate', onPopState);
    // "Close the panel, open the editor" in one handler is a common shape in this app, and it
    // races: `history.back()` is asynchronous while `pushState` is not, so the new entry landed
    // first and the rewind then traversed OVER it. The overlay was open with its entry stranded
    // forward, and the next Back press closed it AND stepped the app one screen further back
    // than it should. Measured in a browser. CalendarGrid had been papering over the same race
    // with a 50 ms setTimeout in three places. So: when a rewind is still in flight, the push
    // waits for it to land rather than guessing at a delay.
    if (hasPendingProgrammaticPop()) pushWhenSettled = push;
    else push();

    return () => {
      // An overlay closed before the rewind it was waiting on has landed must never push after
      // its own death — that would strand an entry for something that no longer exists.
      pushWhenSettled = null;
      window.removeEventListener('popstate', onPopState);
      dropHistoryOwner(id);

      // Only wind the history back if this overlay's own entry is still the current one — that is,
      // it was closed by its own X or backdrop rather than by the back button that already popped
      // it. Checking the marker rather than a bare flag keeps a second overlay's entry from being
      // mistaken for this one's.
      if (pushed && window.history.state?.dialogMarker === marker) {
        expectProgrammaticPop();
        // The credit is spent by the EVENT, never left for a listener to find. If this was the only
        // overlay open, no listener of ours survives to see the pop that follows — and a credit left
        // behind swallowed the user's next real Back press on whatever opened next: one dead press,
        // silently. This one-shot listener is registered before the other overlays' (they attach on
        // open, later), so it runs first and marks the event; `isProgrammaticPop` remembers per
        // event, so every other listener still gets the same answer.
        window.addEventListener('popstate', (event) => { isProgrammaticPop(event); }, { once: true });
        window.history.back();
      }
    };
  }, [isOpen, id, enabled]);
}
