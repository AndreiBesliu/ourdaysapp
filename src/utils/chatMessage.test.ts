// src/utils/chatMessage.test.ts
//
// A chat message as the screens may use it, and the few facts the app, the rules and the installed
// APK must agree on (08.10.2026).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CHAT_TEXT_MAX, REACTION_PALETTE, isTimestamp, normaliseMessage, normaliseMessages, storageUrlOrNull } from './chatMessage';

const POISON = { toString: 0 };
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/chat-images%2Fg%2Fa_1_x.jpg?alt=media&token=0b1c2d3e-4f50';

describe('a message as the screens may use it', () => {
  it('a message the app wrote comes through as it was', () => {
    const m = { id: 'm', senderId: 'a', text: 'hi', imageUrl: URL_OK, audioUrl: null, replyToId: 'p', seenBy: ['a', 'b'], reactions: { '\u{1F44D}': ['b'] }, isPinned: true, isDeleted: false, isEdited: true, createdAt: ts(5) };
    expect(normaliseMessage(m)).toEqual(m);
  });

  it('what a member could plant comes through as harmless kinds', () => {
    const got = normaliseMessage({
      id: 'm', senderId: POISON, text: { a: 1 }, imageUrl: 'javascript:alert(1)', audioUrl: 5, replyToId: { a: 1 },
      seenBy: 'x', reactions: { '\u{1F44D}': 'x', '❤️': ['b', 'b', 7, ''], up: ['c'], constructor: ['d'] },
      isPinned: 'yes', isDeleted: 1, isEdited: {}, createdAt: null,
    })!;
    expect(got).toMatchObject({
      senderId: '', text: null, imageUrl: null, audioUrl: null, replyToId: null, seenBy: [],
      reactions: { '❤️': ['b'] }, isPinned: false, isDeleted: false, isEdited: false, createdAt: null,
    });
    // Exactly: no key outside the six, and an emoji left with nobody is gone.
    expect(got.reactions).toEqual({ '❤️': ['b'] });
    expect(normaliseMessage({ id: 'm', text: '', replyToId: '', createdAt: null })).toMatchObject({ text: null, replyToId: null });
  });

  it('a time that is not a time hides the message; none (one’s own, unsent) keeps it', () => {
    for (const [i, createdAt] of ['x', 5, { toMillis: 1 }, POISON, { toMillis: () => 1 }].entries()) {
      // Not String(createdAt) in the label: that throws on POISON, as it did on screen.
      expect(normaliseMessage({ id: 'm', text: 'x', createdAt }), `case ${i}`).toBeNull();
    }
    expect(normaliseMessage({ id: 'm', text: 'x' })?.createdAt).toBeNull();
    expect(normaliseMessages([{ id: 'a', createdAt: ts(1) }, { id: 'b', createdAt: 'x' }]).map((m) => m.id)).toEqual(['a']);
    expect(isTimestamp(ts(1))).toBe(true);
  });

  it('a link opens only if it is a Firebase Storage download link', () => {
    expect(storageUrlOrNull(URL_OK)).toBe(URL_OK);
    for (const u of ['javascript:alert(1)', `javascript:alert(1)//${URL_OK}`, 'data:image/png;base64,AA', URL_OK.replace('https:', 'http:'), URL_OK.replace('firebasestorage.googleapis.com', 'evil.example'), URL_OK.split('?')[0], `${URL_OK}#x`, 5, null]) {
      expect(storageUrlOrNull(u), String(u)).toBeNull();
    }
  });
});

describe('what the app, the rules and the installed APK agree on', () => {
  const rules = readFileSync('firestore.rules', 'utf8');

  it('the six reactions, byte for byte', () => {
    const hits = [...rules.matchAll(/keys\.hasOnly\(\['([^']+)'\]\) \? '([^']+)'/g)];
    // Each branch judges the emoji it found, not another one.
    for (const m of hits) expect(m[2], m[1]).toBe(m[1]);
    const inRules = hits.map((m) => m[1]);
    expect(inRules).toEqual([...REACTION_PALETTE]);
    const apk = readFileSync('android/app/src/main/assets/public/assets/index-DTbgbzyX.js', 'utf8');
    const m = apk.match(/ne=\[`([^`]+)`,`([^`]+)`,`([^`]+)`,`([^`]+)`,`([^`]+)`,`([^`]+)`\]/);
    expect(m, 'the APK palette').not.toBeNull();
    expect(m!.slice(1)).toEqual([...REACTION_PALETTE]);
  });

  it('the longest message', () => {
    expect(rules).toContain(`v is string && v.size() > 0 && v.size() <= ${CHAT_TEXT_MAX}`);
    expect(readFileSync('src/components/GroupChatWidget.tsx', 'utf8')).toContain('maxLength={CHAT_TEXT_MAX}');
  });
});

describe('the conversation uses all of it', () => {
  const w = readFileSync('src/components/GroupChatWidget.tsx', 'utf8');
  it.each([
    ['messages through the normaliser', 'const fetchedMessages = normaliseMessages(docs);'],
    ['pinned ones too', 'setPinnedDocs(normaliseMessages(docs))'],
    ['"is typing" only from a time', 'isTimestamp(d.updatedAt)'],
    ['the six from one place', 'const EMOJIS = REACTION_PALETTE;'],
    ['a reaction writes its one emoji, as a change', "new FieldPath('reactions', emoji), change"],
    ['added with arrayUnion, removed with arrayRemove, an emptied emoji deleted', '!current.includes(uid) ? arrayUnion(uid)\n      : current.length === 1 ? deleteField()\n      : arrayRemove(uid)'],
    ['an edit sends a picture only when a new one is attached', '...(imageUrl ? { imageUrl } : {}),'],
    ['a delete clears the voice note', 'audioUrl: null'],
    ['a picture opens without a hold on the app', "window.open(msg.imageUrl, '_blank', 'noopener')"],
    ['receipts in chunks, when the chat opens', 'markSeen(unseen.map(m => m.id), myUid);'],
    ['and when one sends', 'markSeen(unseenByMe.map(m => m.id), myUid);'],
    ['of twenty-five', 'const SEEN_CHUNK = 25;'],
    ['one batch per chunk', 'for (let i = 0; i < ids.length; i += SEEN_CHUNK) {'],
  ])('%s', (_label, line) => {
    expect(w).toContain(line);
  });

  it('the whole map is never written back', () => {
    expect(w).not.toMatch(/reactions:\s*newReactions/);
    expect(w).not.toMatch(/imageUrl \|\| editingMsg\.imageUrl/);
  });

  it('both places that show a conversation hold it in a boundary of its own', () => {
    expect(readFileSync('src/screens/Chat.tsx', 'utf8')).toContain('<ErrorBoundary key={conversationKey(active)} context="GroupChatWidget"');
    expect(readFileSync('src/screens/CalendarHome.tsx', 'utf8')).toContain('<ErrorBoundary key={`chat-${activeGroupId}`} context="GroupChatWidget"');
  });
});
