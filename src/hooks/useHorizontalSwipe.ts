// src/hooks/useHorizontalSwipe.ts
//
// Swipe left for the next month, right for the previous one (31.10.2026). framer-motion did this in the
// calendar, and it was the only thing in the app using it: about 124 kB loaded at boot. The same
// decision, with pointer events: a swipe counts past 50 px, or when fast enough (framer's "swipe power",
// distance × speed), and only when it is more sideways than up or down, so scrolling the page on a phone
// is still scrolling (the grid is `touch-action: pan-y`). A click that ends a swipe does not open the day.

import { useRef, type PointerEvent, type MouseEvent } from 'react';

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

/** Pointer handlers for an element that swipes between periods. */
export function useHorizontalSwipe(onNext: () => void, onPrev: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const way = swipeDirection(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (!way) return;
      swiped.current = true;
      if (way === 'next') onNext(); else onPrev();
    },
    onPointerCancel: () => { start.current = null; },
    onClickCapture: (e: MouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
