// src/utils/uploadLimits.ts
//
// What Storage will accept, stated on the client — so a file that CANNOT land is refused before
// it is uploaded rather than after.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// There are seven upload sites in this app and not one of them checked a size. The limits lived
// only in `storage.rules`, which a browser never sees. So an ordinary photo from an ordinary
// phone — 12 MB is not unusual any more — uploaded IN FULL, over whatever connection the person
// happened to be on, and was refused at the very last step. What they saw was "the message could
// not be sent", with the picture still attached. Pressing send again spent the 12 MB again, and
// was refused again. There is no number of retries that succeeds: the request is byte-identical
// and so is the refusal.
//
// The check belongs here and is applied inside `uploadFile`, not at the call sites, because a
// call site is a thing that can be forgotten — and six of the seven had been.
//
// ── These numbers are a COPY, and a copy goes stale ───────────────────────────────────
//
// They must equal what the rules enforce. `uploadLimits.test.ts` parses `storage.rules` and
// fails if they drift, in BOTH directions: a limit changed there, or a new folder added there
// that nothing here knows about.

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 15 * 1024 * 1024;

export interface UploadLimit {
  maxBytes: number;
  /** What `contentType` must start with, mirroring `matches('image/.*')` in the rules. */
  typePrefix: string;
}

const IMAGE: UploadLimit = { maxBytes: IMAGE_MAX_BYTES, typePrefix: 'image/' };
const AUDIO: UploadLimit = { maxBytes: AUDIO_MAX_BYTES, typePrefix: 'audio/' };

/**
 * Keyed by the FIRST path segment, which is what `storage.rules` matches on. Every writable
 * folder in the rules must appear here; the test enforces that, so adding a folder there without
 * adding it here is a failing build rather than a silent hole.
 */
const BY_ROOT: Readonly<Record<string, UploadLimit>> = {
  assets: IMAGE,
  events: IMAGE,
  checklists: IMAGE,
  profiles: IMAGE,
  backgrounds: IMAGE,
  'chat-images': IMAGE,
  'chat-audio': AUDIO,
};

/** The limit Storage will apply to `path`, or null when this app does not upload there. */
export function limitForPath(path: unknown): UploadLimit | null {
  if (typeof path !== 'string') return null;
  const root = path.replace(/^\/+/, '').split('/')[0];
  return Object.prototype.hasOwnProperty.call(BY_ROOT, root) ? BY_ROOT[root] : null;
}

export type UploadRefusal =
  | { kind: 'too-large'; maxBytes: number; size: number }
  | { kind: 'wrong-type'; typePrefix: string; contentType: string };

/**
 * Why Storage would refuse this upload, or null if nothing here can tell.
 *
 * `contentType` is optional on purpose: `uploadFile` also accepts a `Uint8Array`, which carries
 * no type. An unknown type is NOT treated as wrong — only a known, mismatched one is. Guessing
 * would turn this from a guard into a second way to fail.
 */
export function checkUpload(
  path: unknown,
  size: number,
  contentType?: string | null,
): UploadRefusal | null {
  const limit = limitForPath(path);
  if (!limit) return null;

  // The rule says `size < N`, strictly. Exactly N is refused, so this has to be `>=`.
  if (Number.isFinite(size) && size >= limit.maxBytes) {
    return { kind: 'too-large', maxBytes: limit.maxBytes, size };
  }
  if (contentType && !contentType.startsWith(limit.typePrefix)) {
    return { kind: 'wrong-type', typePrefix: limit.typePrefix, contentType };
  }
  return null;
}

/**
 * Would Storage refuse this as a chat photo?
 *
 * Lives here so the caller needs no path at all. Writing `chat-images/${id}/x` at the call site
 * just to ask a question about the limit trips the guard in `uploadName.test.ts` that forbids
 * hand-built upload paths — and rightly, since the next person to read it cannot tell a probe
 * from a real destination.
 */
export function checkChatImage(file: { size: number; type?: string }): UploadRefusal | null {
  return checkUpload('chat-images', file.size, file.type);
}

/** Which sentence a refusal deserves. The two reasons need different advice. */
export function refusalKey(refusal: UploadRefusal): 'fileTooLarge' | 'fileTypeNotAllowed' {
  return refusal.kind === 'too-large' ? 'fileTooLarge' : 'fileTypeNotAllowed';
}

/**
 * The numbers to put after that sentence, or ''.
 *
 * Both of them: "too large" without a limit leaves the person guessing how much smaller, and
 * without their own file's size they cannot tell whether it is close or nowhere near.
 */
export function refusalDetail(refusal: UploadRefusal): string {
  return refusal.kind === 'too-large'
    ? ` (${describeBytes(refusal.size)} / ${describeBytes(refusal.maxBytes)})`
    : '';
}

/** "12.4 MB" — for a message that has to name a number the person can compare to their file. */
export function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
