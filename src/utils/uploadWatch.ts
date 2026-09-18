// src/utils/uploadWatch.ts
//
// When is an upload stuck, as opposed to slow?
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// The wallet raced the upload against a fifteen-second timer:
//
//   const uploadTask = uploadBytes(fileRef, buffer, …);
//   const timeoutTask = new Promise((_, reject) => setTimeout(() => reject(
//     new Error('Upload timed out. Storage might be blocked.')), 15000));
//   await Promise.race([uploadTask, timeoutTask]);
//
// Three things wrong with that, in order of how much they cost:
//
//   1. **`Promise.race` does not cancel the loser.** `uploadBytes` has no cancel at all. So at
//      fifteen seconds the person is told the upload failed while it carries on and finishes,
//      leaving a file in Storage that no document points at. Measured on live before this change:
//      44 objects, of which TWO orphans — and one of them is under `assets/`, which is this exact
//      path. The person paid for it, cannot see it, and cannot delete it.
//   2. **Fifteen seconds is a duration, and the question is not about duration.** The rules allow
//      an image up to 10 MB. On a phone on a bad line that is a perfectly healthy upload that takes
//      longer than fifteen seconds. Four files on live are over 2 MB.
//   3. **"Storage might be blocked" is a diagnosis, not an observation.** It names a cause the code
//      has no way to know, and the likeliest real cause — a slow connection — is not it.
//
// ── What replaces it ─────────────────────────────────────────────────────────────────
//
// A resumable upload reports bytes as they go, and can be CANCELLED. So the question becomes the
// one that can actually be answered: has anything moved lately? An upload that is transferring is
// healthy however long it takes; an upload that has transferred nothing for twenty seconds has
// lost its connection, and saying so is an observation rather than a guess.
//
// This module is the decision, and nothing else — no firebase, no React, no clock. `uploadFile.ts`
// is the thin wrapper that owns the SDK and calls in here.

/** How long nothing may move before an upload counts as stuck. */
export const STALL_MS = 20_000;

export interface UploadWatch {
  /** Bytes reported by the most recent progress event. */
  transferred: number;
  /** When `transferred` last INCREASED — not when an event last arrived. */
  lastProgressAt: number;
}

/** A watch for an upload that has just started. */
export function startWatch(now: number): UploadWatch {
  return { transferred: 0, lastProgressAt: now };
}

/**
 * Fold in a progress report.
 *
 * `lastProgressAt` moves only when bytes actually increase. A stream of events that all say the
 * same number is precisely what a stalled connection looks like, and treating those as progress
 * would make the watchdog unable to fire at all.
 */
export function watchTick(w: UploadWatch, transferred: number, now: number): UploadWatch {
  const bytes = Number.isFinite(transferred) && transferred > 0 ? transferred : 0;
  if (bytes <= w.transferred) return w;
  return { transferred: bytes, lastProgressAt: now };
}

/** Whether nothing has moved for long enough to call it stuck. */
export function hasStalled(w: UploadWatch, now: number, stallMs: number = STALL_MS): boolean {
  return now - w.lastProgressAt >= stallMs;
}

/**
 * What to show while it runs: a percentage, or null when the total is not known yet.
 *
 * Returned as a number rather than a string so the caller decides the wording, and clamped because
 * a `totalBytes` that arrives late has been seen to make this exceed 100.
 */
export function percentOf(transferred: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(transferred) || transferred < 0) return 0;
  return Math.max(0, Math.min(100, Math.round((transferred / total) * 100)));
}
