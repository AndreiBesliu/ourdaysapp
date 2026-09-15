// src/utils/dialogStack.test.ts
//
// The stack exists because of one measured defect: opening an event, pressing Edit, and hitting
// Escape closed BOTH modals, because both had registered a listener on `window` and neither knew
// the other was there. The first describe block is that exact scenario.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDialog,
  closeDialog,
  topDialog,
  isTopDialog,
  isTopModal,
  dialogDepth,
  modalDepth,
  resetDialogStack,
  nextFocusIndex,
  expectProgrammaticPop,
  isProgrammaticPop,
  hasPendingProgrammaticPop,
  pushHistoryOwner,
  dropHistoryOwner,
  isTopHistoryOwner,
} from './dialogStack';

beforeEach(resetDialogStack);

describe('the defect this file exists for', () => {
  it('lets only the edit form answer Escape when it sits over the details view', () => {
    openDialog('event-details');
    openDialog('add-event'); // Edit pressed; details deliberately stays mounted underneath

    expect(isTopDialog('add-event')).toBe(true);
    expect(isTopDialog('event-details')).toBe(false);
  });

  it('hands Escape back to the details view once the edit form closes', () => {
    openDialog('event-details');
    openDialog('add-event');
    closeDialog('add-event');

    expect(isTopDialog('event-details')).toBe(true);
    expect(topDialog()).toBe('event-details');
  });

  it('leaves nobody listening once everything is closed', () => {
    openDialog('event-details');
    openDialog('add-event');
    closeDialog('add-event');
    closeDialog('event-details');

    expect(topDialog()).toBeNull();
    expect(isTopDialog('event-details')).toBe(false);
    expect(dialogDepth()).toBe(0);
  });
});

describe('closing out of order', () => {
  it('removes by identity, not by popping the end', () => {
    // React does not promise cleanups run in reverse order of setup. If the lower dialog
    // unmounts first and we popped the end instead, 'top' would be stranded and the dialog
    // actually on screen would stop answering Escape.
    openDialog('a');
    openDialog('b');
    openDialog('c');

    closeDialog('b'); // the middle one

    expect(topDialog()).toBe('c');
    expect(dialogDepth()).toBe(2);

    closeDialog('c');
    expect(topDialog()).toBe('a');
  });

  it('ignores closing something that was never open', () => {
    openDialog('a');
    closeDialog('ghost');

    expect(topDialog()).toBe('a');
    expect(dialogDepth()).toBe(1);
  });

  it('ignores closing the same dialog twice', () => {
    openDialog('a');
    openDialog('b');
    closeDialog('b');
    closeDialog('b');

    expect(topDialog()).toBe('a');
    expect(dialogDepth()).toBe(1);
  });
});

describe('registering', () => {
  it('does not let a dialog sit above itself', () => {
    // A re-render that re-runs the effect must not deepen the stack, or the matching cleanup
    // would leave one copy behind and the dialog below would never regain the top.
    openDialog('a');
    openDialog('b');
    openDialog('b');

    expect(dialogDepth()).toBe(2);

    closeDialog('b');
    expect(topDialog()).toBe('a');
  });

  it('ignores an empty id rather than stacking a nameless entry', () => {
    openDialog('');
    expect(dialogDepth()).toBe(0);
    expect(topDialog()).toBeNull();
  });

  it('reports nothing on top when nothing is open', () => {
    expect(topDialog()).toBeNull();
    expect(dialogDepth()).toBe(0);
    expect(isTopDialog('anything')).toBe(false);
  });
});

describe('telling our own history rewind from the user pressing Back', () => {
  // A browser harness caught this one AFTER the top-only rule was already in place: one Escape
  // still closed two stacked dialogs. The top one closed to the key, wound back the history entry
  // it had pushed, and that `history.back()` fired a real popstate which the dialog underneath —
  // by then the top — answered by closing itself.
  const popstate = () => ({ type: 'popstate' }) as unknown as Event;

  it('consumes exactly the pop that our own rewind caused', () => {
    expectProgrammaticPop();
    const ours = popstate();
    expect(isProgrammaticPop(ours)).toBe(true);

    const theirs = popstate();
    expect(isProgrammaticPop(theirs)).toBe(false);
  });

  it('gives every listener for one event the same answer', () => {
    // Each open dialog has its own popstate listener and they all see the same event object.
    // Only the first may spend the credit; the rest must still be told to ignore it.
    expectProgrammaticPop();
    const ev = popstate();
    expect(isProgrammaticPop(ev)).toBe(true);
    expect(isProgrammaticPop(ev)).toBe(true);
    expect(isProgrammaticPop(ev)).toBe(true);

    // ...and the credit was spent once, so the next real back press gets through.
    expect(isProgrammaticPop(popstate())).toBe(false);
  });

  it('counts, so two dialogs unmounting in one tick do not swallow a real back press', () => {
    expectProgrammaticPop();
    expectProgrammaticPop();

    expect(isProgrammaticPop(popstate())).toBe(true);
    expect(isProgrammaticPop(popstate())).toBe(true);
    expect(isProgrammaticPop(popstate())).toBe(false);
  });

  it('treats a back press with no rewind outstanding as the user', () => {
    expect(isProgrammaticPop(popstate())).toBe(false);
  });

  it('does not leak a pending rewind into the next test', () => {
    expectProgrammaticPop();
    resetDialogStack();
    expect(isProgrammaticPop(popstate())).toBe(false);
  });
});

describe('focus order inside a dialog', () => {
  it('moves forward and wraps at the end', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it('moves backward and wraps at the start', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it('pulls focus in from outside rather than letting Tab escape the overlay', () => {
    // current === -1 means focus is on the page behind, or on the body. This is the case that
    // makes it a trap rather than a suggestion.
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  it('treats an out-of-range index as outside', () => {
    // The focused element can be removed from the DOM between renders; the stale index must not
    // produce a nonsense target.
    expect(nextFocusIndex(3, 7, false)).toBe(0);
    expect(nextFocusIndex(3, 7, true)).toBe(2);
  });

  it('says "do nothing" when the dialog holds nothing focusable', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it('keeps a single focusable element focused, in both directions', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});

describe('knowing a rewind is still in flight', () => {
  // A dialog that opens in the same tick as another one closes must hold its history push until
  // that rewind has landed: history.back() is asynchronous and pushState is not, so the push landed
  // first and the rewind traversed OVER it. Measured in a browser on the recurring-panel handoff:
  // the editor was open with its entry stranded forward, and one Back press closed it AND stepped
  // the app a screen further back. CalendarGrid had been hiding the same race behind a 50 ms timer.
  const popstate = () => ({ type: 'popstate' }) as unknown as Event;

  it('is quiet when nothing is pending', () => {
    expect(hasPendingProgrammaticPop()).toBe(false);
  });

  it('reports a rewind from the moment it is announced until its pop is consumed', () => {
    expectProgrammaticPop();
    expect(hasPendingProgrammaticPop()).toBe(true);
    isProgrammaticPop(popstate());
    expect(hasPendingProgrammaticPop()).toBe(false);
  });

  it('stays pending while any announced rewind is still unconsumed', () => {
    expectProgrammaticPop();
    expectProgrammaticPop();
    isProgrammaticPop(popstate());
    expect(hasPendingProgrammaticPop()).toBe(true);
    isProgrammaticPop(popstate());
    expect(hasPendingProgrammaticPop()).toBe(false);
  });

  it('is cleared by reset, so one test cannot hand a phantom rewind to the next', () => {
    expectProgrammaticPop();
    resetDialogStack();
    expect(hasPendingProgrammaticPop()).toBe(false);
  });
});

describe('menus and popovers share the stack, without claiming to cover the page', () => {
  // The case that settles the design: the owner card inside the event form. Two separate stacks
  // would mean one Escape closing the card AND the form under it — the original defect, wearing
  // a different hat.
  it('gives Escape to a popover opened inside a dialog', () => {
    openDialog('add-event');
    openDialog('owner-card', false);

    expect(isTopDialog('owner-card')).toBe(true);
    expect(isTopDialog('add-event')).toBe(false);
  });

  it('but leaves the Tab ring with the form underneath it', () => {
    // The popover is rendered INSIDE the form's panel, so its buttons are already part of the
    // ring. Standing the ring down would let Tab walk out of a modal form into the page behind.
    openDialog('add-event');
    openDialog('owner-card', false);

    expect(isTopModal('add-event')).toBe(true);
    expect(isTopModal('owner-card')).toBe(false);
  });

  it('hands the ring back to the dialog below when a dialog closes over a menu', () => {
    openDialog('bell', false);
    openDialog('recurring-panel');
    expect(isTopModal('recurring-panel')).toBe(true);

    closeDialog('recurring-panel');
    expect(isTopModal('bell')).toBe(false);
    expect(isTopDialog('bell')).toBe(true);
  });

  it('reports no top modal when only menus are open', () => {
    openDialog('bell', false);
    openDialog('fab', false);
    expect(isTopModal('bell')).toBe(false);
    expect(isTopModal('fab')).toBe(false);
    expect(isTopDialog('fab')).toBe(true);
  });

  it('counts only the overlays that cover the page', () => {
    // The scroll lock rides on this number. Counting menus too would strand it: a menu open
    // (depth 1), a dialog opened FROM it (depth 2, so it never locks), then both closed — the
    // dialog's cleanup sees 1 and does not restore, the menu never touched `overflow`, and the
    // page stays unscrollable for the rest of the session with no error anywhere.
    openDialog('fab', false);
    expect(dialogDepth()).toBe(1);
    expect(modalDepth()).toBe(0);

    openDialog('add-event');
    expect(dialogDepth()).toBe(2);
    expect(modalDepth()).toBe(1);

    closeDialog('fab');
    expect(modalDepth()).toBe(1);
    closeDialog('add-event');
    expect(modalDepth()).toBe(0);
  });

  it('gives a real Back press to the last overlay that PUSHED, not to the top one', () => {
    // Four independent reviews found the same defect in the first version of this, which asked
    // `isTopDialog`: a popover open above a dialog made the dialog "not top", so its own popstate
    // listener stood down — and nothing else was listening, because a popover pushes nothing. The
    // entry was already gone: the first Back press did NOTHING, and the second walked out of the
    // calendar with the form still on screen.
    openDialog('event-form');
    pushHistoryOwner('event-form');
    openDialog('owner-card', false); // no history entry: menus do not push

    expect(isTopDialog('owner-card')).toBe(true);   // Escape goes to the card...
    expect(isTopHistoryOwner('event-form')).toBe(true); // ...but Back belongs to the form
    expect(isTopHistoryOwner('owner-card')).toBe(false);
  });

  it('hands ownership back in push order as overlays close', () => {
    pushHistoryOwner('details');
    pushHistoryOwner('editor');
    expect(isTopHistoryOwner('editor')).toBe(true);
    expect(isTopHistoryOwner('details')).toBe(false);

    dropHistoryOwner('editor');
    expect(isTopHistoryOwner('details')).toBe(true);

    dropHistoryOwner('details');
    expect(isTopHistoryOwner('details')).toBe(false);
  });

  it('nobody owns a pop when nothing has pushed', () => {
    expect(isTopHistoryOwner('anything')).toBe(false);
    openDialog('bell', false);
    expect(isTopHistoryOwner('bell')).toBe(false);
  });

  it('is cleared by reset, so one test cannot hand an owner to the next', () => {
    pushHistoryOwner('leftover');
    resetDialogStack();
    expect(isTopHistoryOwner('leftover')).toBe(false);
  });

  it('keeps a re-registered id at the kind it was opened with', () => {
    // `openDialog` is called from an effect that can re-run; a second registration must not
    // quietly promote a menu into a modal and take the page's scrollbar with it.
    openDialog('bell', false);
    openDialog('bell', true);
    expect(modalDepth()).toBe(0);
    expect(dialogDepth()).toBe(1);
  });
});
