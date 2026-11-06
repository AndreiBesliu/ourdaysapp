// functions/src/chatPreview.ts
//
// The conversation list's preview of a message (`lastMessageText` on a group or a direct chat), and which
// change to a message reaches it.
//
// The preview is written by the server when a message is created (onMessageCreated, onDirectMessageCreated),
// and until 06.11.2026 by nothing else. A message deleted, or edited, after that left its old words in every
// member's list until somebody wrote again: the words somebody took back, in a copy only the server can write
// (the 08.10 map of what a deleted message leaves behind). Now an update that changes what the list would show
// rewrites the preview from the conversation's newest message as it is now, whichever message the update was to
// (chatPreviewWrite.ts): an older message's leaves it as it is, and a stale one is corrected.
//
// Pure: no imports, so the app's own suite tests it (src/utils/functionsPurity.test.ts).

/** How many characters of a message the list keeps. */
export const PREVIEW_MAX = 140;

/**
 * What the list shows for a message: its words, cut on whole characters, else a picture or a voice note, else
 * nothing. One definition for both triggers that write it, and for the update that rewrites it.
 */
export function previewOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string" && m.text) return Array.from(m.text).slice(0, PREVIEW_MAX).join("");
  if (typeof m.imageUrl === "string" && m.imageUrl) return "\u{1F4F7}";
  if (typeof m.audioUrl === "string" && m.audioUrl) return "\u{1F3A4}";
  return "";
}

/** What an update does to the preview: the message deleted, its preview changed, or nothing (`null`). */
export type PreviewUpdate = { deleted: true } | { deleted: false; text: string } | null;

export function previewUpdate(before: unknown, after: unknown): PreviewUpdate {
  const was = before && typeof before === "object" ? before as Record<string, unknown> : {};
  const is = after && typeof after === "object" ? after as Record<string, unknown> : {};
  if (is.isDeleted === true) return was.isDeleted === true ? null : { deleted: true };
  // A receipt, a reaction or a pin changes nothing the list shows: by far most updates end here.
  const text = previewOf(is);
  return text === previewOf(was) ? null : { deleted: false, text };
}
