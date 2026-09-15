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
  dialogDepth,
  resetDialogStack,
  nextFocusIndex,
  expectProgrammaticPop,
  isProgrammaticPop,
  hasPendingProgrammaticPop,
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
