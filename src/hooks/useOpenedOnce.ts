// src/hooks/useOpenedOnce.ts
//
// True from the first time `open` is true, for good (29.10.2026). The calendar keeps its windows
// mounted while shut, so a boundary tries again on the next open and a form keeps its state; their
// code now loads on demand, so a window is mounted the first time it opens and kept from then on.
// Before that first open it would only have held its initial state, so nothing a person sees changes.
// The latch is set while rendering (React's "information from previous renders"), so the window
// mounts in the same render that opens it, without a frame of nothing.

import { useState } from 'react';

/** The latch itself: once open, opened. */
export function latchOpened(opened: boolean, open: boolean): boolean {
  return opened || open;
}

export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  const next = latchOpened(opened, open);
  if (next !== opened) setOpened(next);
  return next;
}
