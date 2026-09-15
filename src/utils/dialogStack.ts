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

interface Entry {
  id: string;
  /**
   * Whether this overlay covers the page (a dialog) or merely sits on it (a menu, a popover).
   *
   * Both kinds belong on the SAME stack, because the question they ask is the same one — "is the
   * user looking at me?" — and a profile popover opened INSIDE the event form is the case that
   * proves it: with two stacks, one Escape would close the popover and the form under it at once,
   * which is the exact bug this module was written to end. What differs is only what a modal owes
   * the page behind it: the scroll lock and the Tab ring, both of which count `modal` entries.
   */
  modal: boolean;
}

let stack: Entry[] = [];

/**
 * Register an overlay as open. Ids must be unique per mounted instance — `useDialog` and
 * `useMenu` both derive one. Registering an id that is already present moves nothing: an overlay
 * cannot be above itself.
 */
export function openDialog(id: string, modal = true): void {
  if (!id) return;
  if (stack.some((e) => e.id === id)) return;
  stack.push({ id, modal });
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
  const at = stack.findIndex((e) => e.id === id);
  if (at !== -1) stack.splice(at, 1);
}

/** The id of the overlay the user is actually looking at, or null if none is open. */
export function topDialog(): string | null {
  return stack.length ? stack[stack.length - 1].id : null;
}

/**
 * Whether this dialog should respond to a global key or history event.
 *
 * The one rule the whole file exists for: only the top dialog acts.
 */
export function isTopDialog(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1].id === id;
}

/**
 * Whether this dialog is the topmost one that COVERS the page, ignoring any menu or popover
 * floating above it.
 *
 * Escape belongs to the very top — a popover opened inside a form must swallow it, or the form
 * closes with the popover and takes the typing with it. The Tab ring does not: while that popover
 * is open, the form is still the thing the user is inside, and the popover is rendered within it.
 * Suspending the ring because something non-modal sits on top would let Tab walk out of a modal
 * form into the page behind — a regression dressed as a refinement.
 */
export function isTopModal(id: string): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].modal) return stack[i].id === id;
  }
  return false;
}

/** How many overlays are open, of any kind. */
export function dialogDepth(): number {
  return stack.length;
}

/**
 * How many of them cover the page. Used to ref-count the body scroll lock.
 *
 * Counting ALL overlays here would strand the lock: open a menu (depth 1), open a dialog from it
 * (depth 2 — so it never locks), then close both. The dialog's cleanup sees depth 1 and does not
 * restore; the menu's sees 0 but never touched `overflow`. The page stays unscrollable for the
 * rest of the session with no error anywhere — the same shape of bug as the per-dialog
 * `previousOverflow` capture this file already threw out once.
 */
export function modalDepth(): number {
  return stack.reduce((n, e) => (e.modal ? n + 1 : n), 0);
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

// ---------------------------------------------------------------------------------------------
// Who owns the entry the back button is about to pop.
//
// A SECOND sequence, deliberately, because it is a different one: the overlay stack holds every
// open overlay, while this holds only those that pushed a history entry — and menus do not. The
// two used to be treated as one, and the cost was measured by four independent reviews of the same
// change: a popover open above a dialog made the dialog "not the top one", so its own popstate
// listener stood down, nothing closed, and the entry was gone. The user's first Back press did
// NOTHING, and the second walked out of the calendar with the form still on screen.
//
// The rule that replaces it is the one the browser actually implements: the entry popped is the
// last one pushed, so the overlay that acts is the last one to have pushed. Anything floating
// above it without an entry of its own is not part of that conversation, and closing the owner
// takes it along anyway, since it is rendered inside it.

let historyOwners: string[] = [];

/** Call when an overlay has pushed (or is about to push) its history entry. */
export function pushHistoryOwner(id: string): void {
  if (!id || historyOwners.includes(id)) return;
  historyOwners.push(id);
}

/** Call when it is gone, however it went. */
export function dropHistoryOwner(id: string): void {
  const at = historyOwners.indexOf(id);
  if (at !== -1) historyOwners.splice(at, 1);
}

/** Whether this overlay owns the entry a real Back press would pop. */
export function isTopHistoryOwner(id: string): boolean {
  return historyOwners.length > 0 && historyOwners[historyOwners.length - 1] === id;
}

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

/**
 * Is one of our own rewinds still in flight?
 *
 * A dialog that opens in the same tick as another one closes must not push its history entry yet.
 * `history.back()` is asynchronous and `pushState` is not, so the push lands first and the rewind
 * then traverses over it — leaving the new dialog open with its entry stranded FORWARD, and the
 * next Back press closing it AND stepping the app one screen further back than it should. Measured
 * in a browser on the recurring-panel → editor handoff. The opener waits for the pop instead.
 */
export function hasPendingProgrammaticPop(): boolean {
  return programmaticPops > 0;
}

/** Test seam. Module state outlives a test file otherwise, and the next test inherits a lie. */
export function resetDialogStack(): void {
  stack = [];
  historyOwners = [];
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
