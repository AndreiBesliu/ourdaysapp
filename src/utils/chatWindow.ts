// src/utils/chatWindow.ts
//
// How much of a conversation the chat keeps live, and how often "is typing…" is written. Pure.
// Chosen by Andrei from the backlog, 28.09.2026.
//
// ── Why a window ─────────────────────────────────────────────────────────────────────────────
//
// The chat listened to EVERY message of the conversation, and the widget is mounted the whole time a
// group is selected on the calendar. So each app start read the conversation's entire history, and
// the listener was re-created on every open and close of the pane. Measured on live the same day: 47
// messages in all, 23 in the largest conversation, none pinned. Harmless today; a family chat at a
// few dozen messages a day passes ten thousand within a year, and all of it would be read at every
// start. Now the newest CHAT_PAGE are live, and older ones load on request, a page at a time.
//
// What the window changes, and how each is kept:
//   * pinned messages: from their own query, so an old pin stays in the bar;
//   * a pinned message outside the window: tapping it loads older pages until it is there;
//   * search and "seen" work on what is loaded: the "load older" button is on screen whenever
//     there is more;
//   * a reply whose original is not loaded shows without the quote until it is.
//
// ── Why the typing throttle ──────────────────────────────────────────────────────────────────
//
// "Is typing" was one Firestore write per KEYSTROKE, and every write is also a snapshot pushed to
// everybody else in the conversation. The mark only has to stay fresher than TYPING_FRESH_MS, which
// is what the readers accept, so it is refreshed at most every TYPING_REFRESH_MS.

/** How many of the newest messages are live; "load older" adds this many again. */
export const CHAT_PAGE = 100;

/** A typing mark older than this is not shown. */
export const TYPING_FRESH_MS = 5000;

/** A person typing re-marks at most this often. Below TYPING_FRESH_MS, so a steady typer never blinks out. */
export const TYPING_REFRESH_MS = 2500;

/** Whether the window is full, so there may be older messages behind it. */
export function mayHaveOlder(loaded: number, windowSize: number): boolean {
  return loaded >= windowSize;
}

/**
 * The window that holds a message with `newerOrSame` messages at or after it (itself included): whole
 * pages, never smaller than one, and never smaller than the window already open.
 */
export function windowToReach(newerOrSame: number, current: number): number {
  return Math.max(current, CHAT_PAGE, Math.ceil(Math.max(0, newerOrSame) / CHAT_PAGE) * CHAT_PAGE);
}

/**
 * Where the list should be scrolled after it changes, instead of the usual end: the message that
 * was at the top before "load older" (once the older page is actually in, i.e. the first message
 * changed), or a pinned message being reached. Given up after `until`.
 */
export type ScrollAnchor = { convId: string; id: string; block: 'start' | 'center'; waitForGrowth: boolean; until: number };

/** What to do with an anchor after the list changed: scroll to it, keep waiting, or drop it. */
export function anchorStep(
  anchor: ScrollAnchor | null,
  convId: string,
  firstId: string | undefined,
  rendered: boolean,
  now: number,
): 'none' | 'scroll' | 'wait' {
  if (!anchor || anchor.convId !== convId || now > anchor.until) return 'none';
  if (!rendered) return 'wait';
  if (anchor.waitForGrowth && firstId === anchor.id) return 'wait';
  return 'scroll';
}

/** Whether a keystroke should write the typing mark, given when it was last written (null: not since). */
export function typingWriteDue(lastWriteAt: number | null, now: number): boolean {
  return lastWriteAt === null || now - lastWriteAt >= TYPING_REFRESH_MS;
}

type PinnedDoc = { id: string; isDeleted?: boolean; createdAt?: { toMillis?: () => number } | null };

/** The pinned query's documents as the bar shows them: not deleted, oldest first (the bar shows the last). */
export function pinnedInOrder<T extends PinnedDoc>(docs: T[]): T[] {
  const at = (d: T) => d.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  return docs.filter((d) => !d.isDeleted).sort((a, b) => at(a) - at(b));
}
