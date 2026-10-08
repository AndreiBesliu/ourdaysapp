// src/utils/chatMessage.ts
//
// A chat message as the screens may use it (08.10.2026). The rules now take only what the clients
// write, typed (firestore.rules, messageCreateOk / messageUpdateOk), but every field of a message is
// shown to the others in the conversation, and until that day a member could write any of them as
// anything: a `text` that was a map crashed the app for whoever opened the chat, a `createdAt` that
// was not a time crashed the day separators, reactions that were not lists crashed the chips, and an
// `imageUrl` of `javascript:` went to `window.open` on a tap. Messages cannot be deleted. So the
// listeners pass every message through here.

/** The longest message: the rules' `chatTextOk`, and the chat input's maxLength. */
export const CHAT_TEXT_MAX = 4000;

/** The six reactions both clients offer, byte for byte (the rules list the same six). */
export const REACTION_PALETTE = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'] as const;

/** A download link from Firebase Storage, the only kind the app ever stores. */
const STORAGE_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/?#]+\/o\/[^?#]+\?alt=media&token=[-0-9A-Za-z]+$/;

export function storageUrlOrNull(v: unknown): string | null {
  return typeof v === 'string' && STORAGE_URL.test(v) ? v : null;
}

/** A Firestore time: something with both `toMillis` and `toDate`. */
export function isTimestamp(v: unknown): v is { toMillis(): number; toDate(): Date } {
  const t = v as { toMillis?: unknown; toDate?: unknown } | null;
  return !!t && typeof t.toMillis === 'function' && typeof t.toDate === 'function';
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((u): u is string => typeof u === 'string' && u !== ''))] : [];

/**
 * The message with every field of the kind the app writes, or null to leave it out. `createdAt` is
 * null on one's own message until the server answers; anything else that is not a time hides the
 * message (it would also sit at the end of the conversation for ever: it sorts after every time).
 */
export function normaliseMessage<T extends Record<string, any>>(raw: T): (T & { text: string | null }) | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.createdAt != null && !isTimestamp(raw.createdAt)) return null;
  const reactions: Record<string, string[]> = {};
  if (raw.reactions && typeof raw.reactions === 'object' && !Array.isArray(raw.reactions)) {
    for (const e of REACTION_PALETTE) {
      if (Object.prototype.hasOwnProperty.call(raw.reactions, e)) {
        const users = stringList(raw.reactions[e]);
        if (users.length) reactions[e] = users;
      }
    }
  }
  return {
    ...raw,
    senderId: typeof raw.senderId === 'string' ? raw.senderId : '',
    text: typeof raw.text === 'string' && raw.text !== '' ? raw.text : null,
    imageUrl: storageUrlOrNull(raw.imageUrl),
    audioUrl: storageUrlOrNull(raw.audioUrl),
    replyToId: typeof raw.replyToId === 'string' && raw.replyToId !== '' ? raw.replyToId : null,
    seenBy: stringList(raw.seenBy),
    reactions,
    isPinned: raw.isPinned === true,
    isDeleted: raw.isDeleted === true,
    isEdited: raw.isEdited === true,
    createdAt: raw.createdAt ?? null,
  };
}

export function normaliseMessages<T extends Record<string, any>>(list: readonly T[]) {
  return list.map(normaliseMessage).filter((m): m is NonNullable<ReturnType<typeof normaliseMessage<T>>> => m !== null);
}
