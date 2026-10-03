// src/hooks/useDelayedFlag.ts
//
// True once `on` has been true for `ms` without a break; false at once when it goes false (03.10.2026).
//
// The Wallet's "Not sent yet" exists for writes the server has not confirmed. An ordinary online save
// is confirmed in well under a second, so showing the mark at once flashed it on every save — and a
// mark kept invisible with CSS still took its line, so the page jumped, and a screen reader still
// read it (review 03.10). Delaying the MOUNT avoids all three.

import { useEffect, useState } from 'react';

export function useDelayedFlag(on: boolean, ms: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    const id = setTimeout(() => setReady(true), ms);
    return () => {
      clearTimeout(id);
      setReady(false);
    };
  }, [on, ms]);
  return on && ready;
}
