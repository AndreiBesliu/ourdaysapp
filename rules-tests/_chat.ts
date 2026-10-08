// rules-tests/_chat.ts
//
// A chat message exactly as the web writes one (GroupChatWidget.tsx, handleSend), and a picture or
// voice link exactly as getDownloadURL returns one. Since 08.10.2026 a message must be born with
// these keys, typed; a fixture that is not a real client payload would be refused for the wrong
// reason, and a test meant to prove one refusal would pass because of another.

import { serverTimestamp } from 'firebase/firestore';

export function webMessage(uid: string, extra: Record<string, unknown> = {}) {
  return {
    text: 'hello', imageUrl: null, senderId: uid, createdAt: serverTimestamp(), seenBy: [uid],
    replyToId: null, isDeleted: false, isEdited: false, ...extra,
  };
}

/** The installed APK's create (apk-compat.test.ts records it): no audio, no flags. */
export function apkMessage(uid: string, extra: Record<string, unknown> = {}) {
  return { text: 'hello', imageUrl: null, senderId: uid, createdAt: serverTimestamp(), seenBy: [uid], replyToId: null, ...extra };
}

/** A download URL in our bucket: `folder` is chat-images or chat-audio, `conv` the conversation's id. */
export function chatUrl(folder: string, conv: string, name = 'uid_1759900000000_photo.jpg') {
  return `https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/${folder}%2F${conv}%2F${encodeURIComponent(name)}?alt=media&token=0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0`;
}

/** The six reactions both clients offer, byte for byte. */
export const PALETTE = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
