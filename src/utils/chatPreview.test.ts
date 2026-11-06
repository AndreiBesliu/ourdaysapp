// src/utils/chatPreview.test.ts
//
// The conversation list's preview of a message, and which updates reach it (06.11.2026). Tested where it is
// decided (functions/src/chatPreview.ts); the emulator suite walks the real triggers past it
// (functions/test/chatPreview.test.ts). Also the list's side: a deleted newest message reads as one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PREVIEW_MAX, previewOf, previewUpdate } from '../../functions/src/chatPreview';
import { buildConversations, previewLine } from './conversations';

const FUNCTIONS = resolve(__dirname, '..', '..', 'functions', 'src');

describe('previewOf: what the list shows for a message', () => {
  it('words first, cut on whole characters; then a picture, then a voice note, then nothing', () => {
    expect(previewOf({ text: 'hi', imageUrl: 'https://x/y.jpg' })).toBe('hi');
    expect(previewOf({ imageUrl: 'https://x/y.jpg', audioUrl: 'https://x/y.webm' })).toBe('\u{1F4F7}');
    expect(previewOf({ audioUrl: 'https://x/y.webm' })).toBe('\u{1F3A4}');
    expect(previewOf({})).toBe('');
    expect(previewOf(null)).toBe('');
    const long = `${'x'.repeat(139)}\u{1F600}\u{1F600}`;
    expect(previewOf({ text: long })).toBe(`${'x'.repeat(139)}\u{1F600}`);
    expect(Array.from(previewOf({ text: 'y'.repeat(500) }))).toHaveLength(PREVIEW_MAX);
  });

  it('what is not text is not words', () => {
    expect(previewOf({ text: { evil: 1 }, imageUrl: 'https://x/y.jpg' })).toBe('\u{1F4F7}');
    expect(previewOf({ text: 7, imageUrl: 3 })).toBe('');
  });

  it('is the one definition, used by the one writer; no trigger keeps a copy or writes the preview itself', () => {
    expect(readFileSync(join(FUNCTIONS, 'chatPreviewWrite.ts'), 'utf8')).toMatch(/\bpreviewOf\(/);
    for (const file of ['index.ts', 'directChat.ts']) {
      const src = readFileSync(join(FUNCTIONS, file), 'utf8');
      expect(src, file).toContain('syncPreview(');
      expect(src, file).toContain('previewNewMessage(');
      expect(src, file).not.toMatch(/\.(slice|substring|substr)\(\s*0\s*,\s*(140|PREVIEW_MAX)\s*\)/);
      // In code (not comments), the preview's key appears only as the empty seed of a new direct chat
      // (openDirectChat): any other mention, in whatever form a write could take, is a second writer.
      const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const uses = code.match(/.{0,2}lastMessageText.{0,6}/g) ?? [];
      expect(uses, file).toEqual(file === 'directChat.ts' ? [expect.stringMatching(/^\s*lastMessageText: "",$/)] : []);
    }
  });
});

describe('previewUpdate: which updates reach the list', () => {
  const m = { text: 'secret words', senderId: 'b' };

  it('deleted now: the preview says so', () => {
    expect(previewUpdate(m, { ...m, isDeleted: true, text: null })).toEqual({ deleted: true });
  });

  it('already deleted: nothing more to do', () => {
    expect(previewUpdate({ isDeleted: true }, { isDeleted: true, isPinned: true })).toBeNull();
  });

  it('edited words, or a picture swapped for words: the new preview', () => {
    expect(previewUpdate(m, { ...m, text: 'fixed', isEdited: true })).toEqual({ deleted: false, text: 'fixed' });
    expect(previewUpdate({ imageUrl: 'https://x/y.jpg' }, { text: 'caption' })).toEqual({ deleted: false, text: 'caption' });
  });

  it('a receipt, a reaction, a pin, or words past the cut changed: nothing', () => {
    expect(previewUpdate(m, { ...m, seenBy: ['a', 'b'] })).toBeNull();
    expect(previewUpdate(m, { ...m, reactions: { x: ['a'] } })).toBeNull();
    expect(previewUpdate(m, { ...m, isPinned: true })).toBeNull();
    const long = 'z'.repeat(200);
    expect(previewUpdate({ text: long }, { text: `${long}!` })).toBeNull();
  });

  it('a flag that is not exactly true is not a delete', () => {
    expect(previewUpdate(m, { ...m, isDeleted: 'yes' })).toBeNull();
  });
});

describe('the list: a deleted newest message', () => {
  const people = {};
  const build = (extra: Record<string, unknown>) => buildConversations({
    groups: [{ id: 'g', name: 'Family', members: ['a', 'b'], lastMessageText: '', lastMessageBy: 'b', ...extra }],
    chats: [{ id: 'a__b', members: ['a', 'b'], lastMessageText: '', lastMessageBy: 'b', ...extra }],
    people, myUid: 'a', unknownLabel: 'Someone', untitledGroup: 'Group',
  });

  it('is marked, in a group and in a direct chat, only when the server says exactly true', () => {
    expect(build({ lastMessageDeleted: true }).map((c) => [c.kind, c.lastDeleted])).toEqual([['group', true], ['chat', true]]);
    expect(build({}).map((c) => c.lastDeleted)).toEqual([false, false]);
    expect(build({ lastMessageDeleted: 'true' }).map((c) => c.lastDeleted)).toEqual([false, false]);
  });

  const labels = { deleted: 'Deleted message', nothing: 'Nothing said yet' };

  it('the row reads "deleted" after who sent it, not "nothing said yet"', () => {
    expect(previewLine({ lastText: '', lastDeleted: true }, 'You: ', labels)).toBe('You: Deleted message');
    expect(previewLine({ lastText: '', lastDeleted: true }, 'Bob: ', labels)).toBe('Bob: Deleted message');
    expect(previewLine({ lastText: '', lastDeleted: false }, 'Bob: ', labels)).toBe('Nothing said yet');
    expect(previewLine({ lastText: 'see you', lastDeleted: false }, 'Bob: ', labels)).toBe('Bob: see you');
    // Words win: a stale flag never hides a message.
    expect(previewLine({ lastText: 'see you', lastDeleted: true }, '', labels)).toBe('see you');
  });

  it('is what the row shows, with both labels in the reader’s language', () => {
    // The wiring only (no DOM here): the row's line is previewLine's, with the two labels in the reader's language.
    const chat = readFileSync(resolve(__dirname, '..', 'screens', 'Chat.tsx'), 'utf8');
    expect(chat).toMatch(/previewLine\(\s*c\s*,\s*prefix\s*,\s*\{\s*deleted:\s*t\('chatDeletedPreview',\s*language\)\s*,\s*nothing:\s*t\('chatNothingYet',\s*language\)\s*,?\s*\}\s*\)/);
  });
});
