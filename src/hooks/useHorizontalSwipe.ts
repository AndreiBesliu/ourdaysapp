// src/hooks/useHorizontalSwipe.ts
//
// Swipe left for the next month, right for the previous one (31.10.2026). framer-motion did this in the
// calendar, and it was the only thing in the app using it: about 124 kB loaded at boot. The same
// decision, with pointer events: a swipe counts past 50 px, or when fast enough (framer's "swipe power",
// distance × speed), and only when it is more sideways than up or down, so scrolling the page on a phone
// is still scrolling (the grid is `touch-action: pan-y`). The click that ends a swipe does not open the day.
//
// The gesture itself is `createSwipeTracker`, plain code, so its life is tested without a DOM (review of
// 31.10.2026, which found three faults in the first version, all now pinned in the test):
//   * the "a swipe just happened" mark was cleared only by the next click, so after a swipe that ended
//     with no click (most of them, on a phone) the FIRST tap on a day was swallowed — now every press
//     starts clean;
//   * a second finger overwrote the first's start, so lifting one read as a swipe — now only the primary
//     pointer counts, and a second one cancels the gesture;
//   * a mouse released outside the grid left its start behind for a later, unrelated release — now
//     leaving the grid ends the gesture.

import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** framer's threshold for |distance| × speed (px × px/s), and the distance that counts on its own. */
export const SWIPE_POWER = 10000;
export const SWIPE_DISTANCE = 50;

/** Which way a gesture of `dx`, `dy` (px) over `ms` went, or null when it was not a swipe. */
export function swipeDirection(dx: number, dy: number, ms: number): 'next' | 'prev' | null {
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  const power = Math.abs(dx) * (dx / Math.max(ms, 1)) * 1000;
  if (power < -SWIPE_POWER || dx < -SWIPE_DISTANCE) return 'next';
  if (power > SWIPE_POWER || dx > SWIPE_DISTANCE) return 'prev';
  return null;
}

/** What the tracker reads of a pointer or click event: React's, or a test's plain object. */
type Pointer = Pick<PointerEvent, 'button' | 'clientX' | 'clientY' | 'timeStamp' | 'pointerId' | 'isPrimary'>;
type Click = Pick<MouseEvent, 'stopPropagation' | 'preventDefault'>;

/** The gesture: pointer handlers that call `onNext` / `onPrev`, and swallow only the click that ends a swipe. */
export function createSwipeTracker(swipe: { next: () => void; prev: () => void }) {
  let start: { x: number; y: number; t: number; id: number } | null = null;
  let swiped = false;
  return {
    onPointerDown: (e: Pointer) => {
      swiped = false;
      if (!e.isPrimary) { start = null; return; }
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    },
    onPointerUp: (e: Pointer) => {
      const s = start;
      if (!s || e.pointerId !== s.id) return;
      start = null;
      const way = swipeDirection(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (!way) return;
      swiped = true;
      if (way === 'next') swipe.next(); else swipe.prev();
    },
    onPointerCancel: () => { start = null; },
    onPointerLeave: () => { start = null; },
    onClickCapture: (e: Click) => {
      if (!swiped) return;
      swiped = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

/** Pointer handlers for an element that swipes between periods. */
export function useHorizontalSwipe(onNext: () => void, onPrev: () => void) {
  const latest = useRef({ next: onNext, prev: onPrev });
  latest.current = { next: onNext, prev: onPrev };
  const tracker = useRef<ReturnType<typeof createSwipeTracker> | null>(null);
  if (!tracker.current) tracker.current = createSwipeTracker({ next: () => latest.current.next(), prev: () => latest.current.prev() });
  return tracker.current;
}
