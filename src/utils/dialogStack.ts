// src/utils/dialogStack.ts
//
// Which dialog is on top.
//
// Every modal in this app used to answer that question for itself, and the answer was always
// "me". Each one registered its own `keydown` listener on `window`, so one Escape reached all of
// them at once: opening an event, pressing Edit, and hitting Escape closed the edit form AND the
// details view underneath it — losing whatever had been typed. `useModalBack` had the same shape
// with `popstate`, and there the cost was higher: both handlers ran, both modals closed, and then
// the lower one's cleanup still saw its own entry on top of the history stack and called
// `history.back()` a second time, walking the app backwards out of the calendar.
//
// A window listener cannot know it is not the only one. So the knowledge lives here instead, in
// one module-level stack, and each dialog asks before acting.
//
// This file is deliberately free of React and of the DOM: the ordering rules are the part that was
// wrong, so they are the part that has to be runnable in a plain test.

let stack: string[] = [];

/**
 * Register a dialog as open. Ids must be unique per mounted instance — `useDialog` derives one.
 * Registering an id that is already present moves nothing: a dialog cannot be above itself.
 */
export function openDialog(id: string): void {
  if (!id) return;
  if (stack.includes(id)) return;
  stack.push(id);
}

/**
 * Unregister a dialog.
 *
 * Removes by identity from ANYWHERE in the stack rather than popping the end. React does not
 * promise that effect cleanups run in the reverse order of their setup — when a parent unmounts,
 * several dialogs can go at once — and a stack that assumed LIFO would strand a dead id on top
 * and silently deafen the dialog underneath it to Escape for the rest of the session.
 */
export function closeDialog(id: string): void {
  const at = stack.indexOf(id);
  if (at !== -1) stack.splice(at, 1);
}

/** The id of the dialog the user is actually looking at, or null if none is open. */
export function topDialog(): string | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/**
 * Whether this dialog should respond to a global key or history event.
 *
 * The one rule the whole file exists for: only the top dialog acts.
 */
export function isTopDialog(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** How many dialogs are open. Used to ref-count the body scroll lock. */
export function dialogDepth(): number {
  return stack.length;
}

// ---------------------------------------------------------------------------------------------
// Telling our own history rewind apart from the user's back gesture.
//
// When a dialog is dismissed by its X, its backdrop or Escape, the history entry it pushed on
// open is still sitting there, so it winds it back — otherwise the user's next Back press would
// be swallowed doing nothing visible. But `history.back()` fires a real `popstate`, and by the
// time that arrives the dialog underneath is the top one and dutifully closes itself.
//
// That is not a hypothetical: a browser harness showed one Escape closing two stacked dialogs
// even after the top-only rule was in place, because the second one died to the rewind rather
// than to the key. So a rewind is announced in advance and the popstate it causes is consumed.
//
// Counted rather than flagged because two dialogs can unmount in the same tick, and matched per
// event object because every open dialog's listener sees the same popstate and only the first of
// them may spend the credit.

let programmaticPops = 0;
let seenPops = new WeakSet<Event>();
let ignoredPops = new WeakSet<Event>();

/** Call immediately before `history.back()` that the app itself initiated. */
export function expectProgrammaticPop(): void {
  programmaticPops += 1;
}

/**
 * Whether this popstate is the app winding back its own entry rather than the user going back.
 *
 * Safe to call from every listener for the same event: the verdict is decided once, on first
 * sight, and the same answer is returned to all of them.
 */
export function isProgrammaticPop(event: Event): boolean {
  if (!seenPops.has(event)) {
    seenPops.add(event);
    if (programmaticPops > 0) {
      programmaticPops -= 1;
      ignoredPops.add(event);
    }
  }
  return ignoredPops.has(event);
}

/** Test seam. Module state outlives a test file otherwise, and the next test inherits a lie. */
export function resetDialogStack(): void {
  stack = [];
  programmaticPops = 0;
  seenPops = new WeakSet();
  ignoredPops = new WeakSet();
}

/**
 * Where focus goes next inside a dialog, given Tab or Shift+Tab.
 *
 * Pure so the wrap-around can be tested without a browser. `current` is the index of the currently
 * focused element among the dialog's focusable ones, or -1 when focus is somewhere else entirely
 * (the page behind, or the document body after a click on a non-focusable part of the panel).
 *
 * Returns -1 when there is nothing to focus, which the caller reads as "do nothing".
 */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  // Focus is outside the dialog: Tab enters at the top, Shift+Tab at the bottom. Without this the
  // trap would let a stray Tab fall through into the page behind the overlay.
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}
