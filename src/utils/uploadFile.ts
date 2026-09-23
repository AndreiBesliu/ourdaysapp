// src/utils/uploadFile.ts
//
// The one place this app puts a file into Storage.
//
// ── Why one place ─────────────────────────────────────────────────────────────────────
//
// There were seven upload sites across four files — the wallet, the event form twice, group chat
// twice (an image and a voice note) and settings twice. All used `uploadBytes`, which is not
// resumable: no progress, and no way to cancel. Six of them had no time limit at all, so a dead
// connection meant a spinner that never came back. The seventh raced a fifteen-second timer it
// could not cancel, which is worse than either — see the header of `uploadWatch.ts`, and the two
// orphaned files it left on live.
//
// So the SDK call lives here, once, and the decision it needs lives in `uploadWatch.ts` where it
// can be tested without a network.
//
// ── What it does ──────────────────────────────────────────────────────────────────────
//
//   * resumable, so bytes are reported and the task can be CANCELLED;
//   * gives up only when nothing has moved for `STALL_MS` — slow is not stuck;
//   * cancels the task when it gives up, so a give-up cannot leave a file nobody points at;
//   * reports progress to the caller, so a big photo is a progress bar and not a frozen button.

import { ref, uploadBytesResumable, getDownloadURL, type StorageReference } from 'firebase/storage';
import { storage } from '../firebase';
import { startWatch, watchTick, hasStalled, percentOf, STALL_MS } from './uploadWatch';
import { checkUpload, type UploadRefusal } from './uploadLimits';

export class UploadStalled extends Error {
  constructor() {
    super('upload-stalled');
    this.name = 'UploadStalled';
  }
}

/**
 * The upload was not attempted, because Storage would have refused it.
 *
 * This is a DIFFERENT thing from a failure, and the difference is the whole point: a stall is
 * worth retrying and this is not. Sending the bytes anyway and letting the rules say no meant
 * spending the person's connection on a request whose answer was already known — and then
 * offering them a retry that produced a byte-identical request and a byte-identical refusal.
 */
export class UploadRefused extends Error {
  // Declared rather than a constructor parameter property: `erasableSyntaxOnly` is on, and that
  // shorthand emits code instead of erasing.
  readonly refusal: UploadRefusal;

  constructor(refusal: UploadRefusal) {
    super(`upload-refused/${refusal.kind}`);
    this.name = 'UploadRefused';
    this.refusal = refusal;
  }
}

export interface UploadOptions {
  /** Called with 0-100, or null while the total size is still unknown. */
  onProgress?: (percent: number | null) => void;
  contentType?: string;
  /** Overridable so a test does not have to wait twenty seconds. */
  stallMs?: number;
}

/** Byte length of whatever `uploadFile` accepts. */
function sizeOf(data: Blob | Uint8Array | ArrayBuffer): number {
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return (data as Uint8Array).byteLength;
}

/**
 * Put `data` at `path` and return its download URL.
 *
 * Throws `UploadStalled` when nothing has moved for `stallMs`, having first cancelled the upload —
 * the cancellation is the point, not the error.
 *
 * Throws `UploadRefused`, before sending anything, when the file cannot satisfy the Storage rule
 * for this path. That one is not worth retrying and the caller should not offer to.
 */
export async function uploadFile(
  path: string,
  data: Blob | Uint8Array | ArrayBuffer,
  options: UploadOptions = {},
): Promise<string> {
  const { onProgress, contentType, stallMs = STALL_MS } = options;

  // Asked here rather than at the seven call sites, because a call site is a thing that can be
  // forgotten — and six of the seven had been.
  const blobType = typeof Blob !== 'undefined' && data instanceof Blob ? data.type : undefined;
  const refusal = checkUpload(path, sizeOf(data), contentType ?? blobType);
  if (refusal) throw new UploadRefused(refusal);

  const fileRef: StorageReference = ref(storage, path);
  const task = uploadBytesResumable(fileRef, data, contentType ? { contentType } : undefined);

  let watch = startWatch(Date.now());
  let settled = false;

  await new Promise<void>((resolve, reject) => {
    // The watchdog asks the question on a timer of its own rather than inside the progress handler,
    // because a connection that has died stops delivering progress events entirely — the handler is
    // exactly what would never run again.
    const tick = setInterval(() => {
      if (settled) return;
      if (!hasStalled(watch, Date.now(), stallMs)) return;
      settled = true;
      clearInterval(tick);
      // Cancel BEFORE rejecting. The old code rejected and let the upload finish in the
      // background, which is how a file with no document gets into the bucket.
      try { task.cancel(); } catch { /* already finished; nothing to cancel */ }
      reject(new UploadStalled());
    }, 1000);

    task.on(
      'state_changed',
      (snap) => {
        watch = watchTick(watch, snap.bytesTransferred, Date.now());
        onProgress?.(percentOf(snap.bytesTransferred, snap.totalBytes));
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        reject(err);
      },
      () => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        onProgress?.(100);
        resolve();
      },
    );
  });

  return getDownloadURL(fileRef);
}
