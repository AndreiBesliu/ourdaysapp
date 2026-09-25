// src/utils/uploadName.ts
//
// The name a chat upload is stored under, and why it starts with a uid.
//
// ── The problem it answers ───────────────────────────────────────────────────────────────
//
// storage.rules does not ask whether the uploader belongs to the conversation they are writing into.
// Its header said for months that Storage rules CANNOT read Firestore — wrong: cross-service rules
// can, for an IAM grant and a billed read per request, and the file declines that (25.09.2026). The
// consequence was that `chat-images/{anything}/…` accepted a write from any signed-in account.
//
// Membership stays unknowable there. OWNERSHIP does not: if the uploader's uid leads the filename,
// a rule can require `fileName.matches(request.auth.uid + '_.*')`. That does not stop somebody
// writing into a conversation they are not in — nothing in Storage can — but it does stop them
// writing a file attributed to anyone else, and it makes every object in the bucket traceable to
// the account that put it there.
//
// ── Why the name has to be cleaned ───────────────────────────────────────────────────────
//
// A Firebase object name is ONE flat string; the slashes are a convention the console renders as
// folders. So a user-supplied filename containing `/` silently changes the object's depth, and a
// rule written for a single segment stops matching. The upload is then refused — the safe
// direction — but the person sees only a failure, which is a poor way to learn that their holiday
// photo was called `holiday 2026/07.jpg`.

/** A leading `_` would be ambiguous against the uid separator; everything else is cosmetic. */
const UNSAFE = /[^A-Za-z0-9._-]/g;

/**
 * A filename that cannot break out of the `<uid>_<when>_` prefix the Storage rules match on.
 *
 * The tail is kept rather than the head: a name long enough to truncate is usually
 * `IMG_20260922_181245_something.jpg`, where the end is what distinguishes it. Never empty, so the
 * resulting path always has a final segment.
 */
export function sanitiseUploadName(name: unknown): string {
  if (typeof name !== 'string') return 'file';
  const cleaned = name.replace(UNSAFE, '-').slice(-80);
  return cleaned.replace(/^[-_.]+/, '') || 'file';
}

/**
 * The full object name for a chat attachment.
 *
 * `uid` first, then the clock, then the cleaned original — the prefix the rule anchors on, and an
 * ordering that sorts usefully in the console.
 */
export function chatUploadPath(
  prefix: 'chat-images' | 'chat-audio',
  convId: string,
  uid: string,
  name: string,
  now: number,
): string {
  return `${prefix}/${convId}/${uid}_${now}_${sanitiseUploadName(name)}`;
}
