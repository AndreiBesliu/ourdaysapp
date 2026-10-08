// rules-tests/messages.test.ts
//
// A chat message, in a group and in a direct chat, has exactly the fields the clients write, of the
// kinds they write (08.10.2026). Until then the rules typed only `senderId` and `seenBy`: a member
// could write `text` as a map, a `createdAt` that was not a time, reactions that were not lists, or
// an `id`, and the conversation crashed for the others every time they opened it — on the web the
// whole app, in the APK a white screen — and messages cannot be deleted (reproduced on the
// emulators). An `imageUrl` of `javascript:` went to `window.open` on a tap.

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FieldPath, Timestamp, addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ALICE, BOB, CAROL, DAVE, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';
import { PALETTE, apkMessage, chatUrl, webMessage } from './_chat';

beforeAll(async () => { await startEnv('demo-ourdays-messages'); });
afterAll(stopEnv);

const AB = [ALICE, BOB].sort().join('__');

/**
 * Refused BY THE RULE. Firestore stops at 1000 expressions per request and weighs a refused write in
 * full; a refusal for that reason looks the same to assertFails, and would hide a rule grown too
 * dear (the first version of the reactions check did, on every refusal of any message).
 */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}
const POISON = { toString: 0 };
const [THUMB, HEART, LAUGH] = PALETTE;

type Conv = [string, string, string];
const CONVS: Conv[] = [['a group', 'groups', G1], ['a direct chat', 'chats', AB]];

describe.each(CONVS)('a message in %s', (_label, coll, conv) => {
  const path = `${coll}/${conv}/messages`;
  const msg = (who: string, id: string) => doc(as(who), path, id);
  const post = (who: string, payload: Record<string, unknown>) => addDoc(collection(as(who), path), payload);

  beforeEach(async () => {
    await resetWorld();
    await seed(async (db) => {
      await setDoc(doc(db, 'chats', AB), { members: [ALICE, BOB].sort(), createdBy: ALICE });
      const base = { senderId: ALICE, text: 'hello', imageUrl: null, createdAt: new Date('2026-10-08T09:00:00Z'), seenBy: [ALICE], replyToId: null, isDeleted: false, isEdited: false };
      await setDoc(doc(db, path, 'm-a'), { ...base, reactions: {}, isPinned: false });
      await setDoc(doc(db, path, 'm-edited'), { ...base, text: 'changed once', isEdited: true });
      await setDoc(doc(db, path, 'm-none'), base);
      await setDoc(doc(db, path, 'm-pal'), { ...base, reactions: { [THUMB]: [ALICE], [HEART]: [ALICE], up: [ALICE] } });
      await setDoc(doc(db, path, 'm-bob'), { ...base, reactions: { [THUMB]: [BOB] } });
      await setDoc(doc(db, path, 'm-del'), { ...base, text: null, isDeleted: true, isPinned: true });
      await setDoc(doc(db, path, 'm-del-photo'), { ...base, text: null, isDeleted: true, imageUrl: chatUrl('chat-images', conv) });
      await setDoc(doc(db, path, 'm-odd-map'), { ...base, reactions: 'x' });
      await setDoc(doc(db, path, 'm-odd-list'), { ...base, reactions: { [THUMB]: 'x' } });
      await setDoc(doc(db, `${coll}/${conv}/typing`, ALICE), { updatedAt: new Date() });
      await setDoc(doc(db, path, 'm-voice'), { ...base, text: null, audioUrl: chatUrl('chat-audio', conv, 'a_1_voice.webm') });
      await setDoc(doc(db, path, 'm-photo'), { ...base, imageUrl: chatUrl('chat-images', conv) });
      await setDoc(doc(db, path, 'm-apk'), { senderId: ALICE, text: 'from the phone', imageUrl: null, createdAt: new Date('2026-10-08T09:00:00Z'), seenBy: [ALICE], replyToId: null });
      // What a member could plant until 08.10.2026.
      await setDoc(doc(db, path, 'm-poison'), { senderId: ALICE, text: { a: 1 }, createdAt: 'x', seenBy: [ALICE], reactions: 'x', id: POISON, imageUrl: 'javascript:alert(1)' });
    });
  });

  // ── what the clients write: every one passes ──────────────────────────────────────────────
  it('the web’s text, reply, photo, photo with text and voice; the APK’s, with its raw file name', async () => {
    for (const payload of [
      webMessage(BOB, { text: 'hi' }),
      webMessage(BOB, { text: 'a reply', replyToId: 'm-a' }),
      webMessage(BOB, { text: null, imageUrl: chatUrl('chat-images', conv, `${BOB}_1759900000000_photo.jpg`) }),
      webMessage(BOB, { text: 'look', imageUrl: chatUrl('chat-images', conv) }),
      { ...webMessage(BOB, { text: null }), audioUrl: chatUrl('chat-audio', conv, `${BOB}_1759900000000_voice.webm`) },
      { ...webMessage(BOB, { text: null }), audioUrl: chatUrl('chat-audio', conv, '1759900000000.webm') },
      apkMessage(BOB, { text: 'from the phone' }),
      apkMessage(BOB, { text: null, imageUrl: chatUrl('chat-images', conv, '1759900000000_IMG 2026 (1)é.jpg') }),
      webMessage(BOB, { text: 'x'.repeat(4000) }),
      webMessage(BOB, { text: 'a reply', replyToId: 'x'.repeat(1500) }),
    ]) {
      await assertSucceeds(post(BOB, payload));
    }
  });

  it('marking seen, in a batch, across a message a member planted before the rule', async () => {
    const bob = as(BOB);
    const batch = writeBatch(bob);
    for (const id of ['m-a', 'm-poison', 'm-apk']) batch.update(doc(bob, path, id), { seenBy: arrayUnion(BOB) });
    await assertSucceeds(batch.commit());
  });

  it('every reaction on and off, by the other person and by the author', async () => {
    for (const who of [BOB, ALICE]) {
      for (const e of PALETTE) {
        await assertSucceeds(updateDoc(msg(who, 'm-a'), { reactions: { [e]: [who] } }));
        await assertSucceeds(updateDoc(msg(who, 'm-a'), { reactions: {} }));
      }
    }
    // On a message that has no `reactions` at all; then the author beside them.
    await assertSucceeds(updateDoc(msg(BOB, 'm-none'), { reactions: { [LAUGH]: [BOB] } }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-none'), { reactions: { [LAUGH]: [BOB, ALICE] } }));
  });

  it('the web\u2019s own write: one emoji, as arrayUnion / arrayRemove / deleteField', async () => {
    const thumb = new FieldPath('reactions', THUMB);
    await assertSucceeds(updateDoc(msg(BOB, 'm-pal'), thumb, arrayUnion(BOB)));
    await assertSucceeds(updateDoc(msg(BOB, 'm-pal'), thumb, arrayRemove(BOB)));
    await assertSucceeds(updateDoc(msg(BOB, 'm-a'), thumb, arrayUnion(BOB)));
    await assertSucceeds(updateDoc(msg(BOB, 'm-a'), thumb, deleteField()));
    // On an old document whose reactions are not a map, or not a list under the emoji.
    await assertSucceeds(updateDoc(msg(BOB, 'm-odd-map'), thumb, [BOB]));
    await assertSucceeds(updateDoc(msg(BOB, 'm-odd-list'), thumb, [BOB]));
  });

  it('beside somebody else’s reaction, and leaving it there; an old key outside the six is left alone', async () => {
    await assertSucceeds(updateDoc(msg(BOB, 'm-pal'), { reactions: { [THUMB]: [ALICE, BOB], [HEART]: [ALICE], up: [ALICE] } }));
    await assertSucceeds(updateDoc(msg(BOB, 'm-pal'), { reactions: { [THUMB]: [ALICE], [HEART]: [ALICE], up: [ALICE] } }));
  });

  it('pinning and unpinning, by either; unpinning a deleted message', async () => {
    await assertSucceeds(updateDoc(msg(BOB, 'm-a'), { isPinned: true }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-a'), { isPinned: false }));
    await assertSucceeds(updateDoc(msg(BOB, 'm-del'), { isPinned: false }));
    await assertSucceeds(updateDoc(msg(BOB, 'm-poison'), { isPinned: true }));
  });

  it('the author edits: the text, an APK message, a new picture, words on a voice note, a planted text', async () => {
    await assertSucceeds(updateDoc(msg(ALICE, 'm-a'), { text: 'hello (edited)', isEdited: true }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-apk'), { text: 'fixed', isEdited: true }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-photo'), { imageUrl: chatUrl('chat-images', conv, 'a_2_new.jpg'), isEdited: true }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-voice'), { text: 'listen', isEdited: true }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-poison'), { text: 'repaired', isEdited: true }));
  });

  it('the author deletes: text, picture, voice, an APK message, a planted one, one already deleted', async () => {
    const del = { isDeleted: true, text: null, imageUrl: null, audioUrl: null };  // GroupChatWidget handleDelete
    for (const id of ['m-a', 'm-photo', 'm-voice', 'm-apk', 'm-poison', 'm-del-photo']) {
      await assertSucceeds(updateDoc(msg(ALICE, id), del));
    }
  });

  it('"is typing": set, set again, cleared', async () => {
    const mine = doc(as(BOB), `${coll}/${conv}/typing`, BOB);
    await assertSucceeds(setDoc(mine, { updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(mine, { updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(mine));
  });

  // ── a new message with anything else: refused, each with only that wrong ─────────────────
  it('text that is not text, empty, or over 4000', async () => {
    for (const text of [{ a: 1 }, POISON, 5, ['x'], '', 'x'.repeat(4001)]) await fails(post(BOB, webMessage(BOB, { text })));
  });

  it('a time that is not the server’s', async () => {
    for (const createdAt of [new Date(), Timestamp.fromMillis(0), 'x', 5]) await fails(post(BOB, webMessage(BOB, { createdAt })));
    const { createdAt: _gone, ...noTime } = webMessage(BOB);
    await fails(post(BOB, noTime));
  });

  it('a key no client writes, or flags already set, or receipts for others', async () => {
    for (const extra of [{ id: 'other' }, { id: POISON }, { reactions: {} }, { isPinned: false }, { foo: 1 }, { isDeleted: true }, { isEdited: true }, { seenBy: [] }, { seenBy: [ALICE] }]) {
      await fails(post(BOB, webMessage(BOB, extra)));
    }
    await fails(post(BOB, webMessage(BOB, { text: null })));  // nothing in it at all
  });

  it('a picture or a voice link that is not ours, not this conversation’s, or not one', async () => {
    const good = chatUrl('chat-images', conv);
    const bad = [
      'javascript:alert(1)', 'data:image/png;base64,AAAA', good.replace('https:', 'http:'),
      good.replace('firebasestorage.googleapis.com', 'evil.example'), good.replace('our-days-2a939.firebasestorage.app', 'other.appspot.com'),
      chatUrl('chat-images', 'another-conversation'), chatUrl('chat-audio', conv), good.replace('chat-images', 'assets'),
      good.replace(`%2F${conv}%2F`, `%2F${conv}%2Fextra%2F`), good.split('?')[0], good + 'y'.repeat(2049 - good.length), { a: 1 }, POISON,
    ];
    for (const imageUrl of bad) await fails(post(BOB, webMessage(BOB, { text: null, imageUrl })));
    for (const audioUrl of ['javascript:alert(1)', chatUrl('chat-images', conv), chatUrl('chat-audio', 'another-conversation')]) {
      await fails(post(BOB, { ...webMessage(BOB, { text: null }), audioUrl }));
    }
    // Controls: the same payload with a good link, and one exactly at the cap.
    await assertSucceeds(post(BOB, webMessage(BOB, { text: null, imageUrl: good })));
    await assertSucceeds(post(BOB, webMessage(BOB, { text: null, imageUrl: good + 'y'.repeat(2048 - good.length) })));
  });

  it('a reply that names no message', async () => {
    for (const replyToId of [{ a: 1 }, 5, '', 'x'.repeat(1501)]) await fails(post(BOB, webMessage(BOB, { replyToId })));
  });

  // ── a change: judged on what it changes ───────────────────────────────────────────────────
  it('the other person may not change what the author wrote, nor anything but seen, reactions and pin', async () => {
    for (const change of [
      // With isEdited too, so it is the list of keys that refuses, not the edit mark.
      { text: 'something else', isEdited: true }, { imageUrl: chatUrl('chat-images', conv), isEdited: true }, { isEdited: true }, { isDeleted: true },
      { createdAt: serverTimestamp() }, { replyToId: 'm-none' }, { senderId: BOB }, { id: 'x' }, { foo: 1 },
    ]) {
      await fails(updateDoc(msg(BOB, 'm-a'), change));
    }
    // On a message already marked edited, where only the list of keys stands in the way.
    await fails(updateDoc(msg(BOB, 'm-edited'), { text: 'not what Alice wrote' }));
    await assertSucceeds(updateDoc(msg(ALICE, 'm-edited'), { text: 'what Alice wrote' }));
  });

  it('a reaction is only ever one’s own, under the six, as a list', async () => {
    for (const e of PALETTE) await fails(updateDoc(msg(BOB, 'm-a'), { reactions: { [e]: [ALICE] } }));
    // Two emoji in one write: neither client ever sends that.
    await fails(updateDoc(msg(BOB, 'm-pal'), { reactions: { [THUMB]: [ALICE, BOB], [HEART]: [ALICE, BOB], up: [ALICE] } }));
    for (const reactions of [
      { [THUMB]: [ALICE] },                                   // on m-a: adds ALICE, not oneself
      { [THUMB]: [] },                                        // an emptied emoji left as []
      { up: [BOB] },                                          // a key outside the six
      { '❤': [BOB] },                                    // the heart without its variation selector
      { [THUMB]: [BOB, BOB] },                                // oneself twice
      { [THUMB]: 'x' },                                       // not a list
    ]) {
      await fails(updateDoc(msg(BOB, 'm-a'), { reactions }));
    }
    for (const reactions of ['x', [BOB], deleteField()]) await fails(updateDoc(msg(BOB, 'm-a'), { reactions }));
    // Taking Alice's away, or swapping her for oneself.
    await fails(updateDoc(msg(BOB, 'm-pal'), { reactions: { [HEART]: [ALICE], up: [ALICE] } }));
    await fails(updateDoc(msg(BOB, 'm-pal'), { reactions: { [THUMB]: [BOB], [HEART]: [ALICE], up: [ALICE] } }));
  });

  it('the author may not add or take away anybody else’s reaction, on their own message', async () => {
    await fails(updateDoc(msg(ALICE, 'm-a'), { reactions: { [THUMB]: [BOB] } }));
    await fails(updateDoc(msg(ALICE, 'm-bob'), { reactions: {} }));
  });

  it('a pin is true or false, and a deleted message is not pinned', async () => {
    for (const isPinned of ['yes', 1, { a: 1 }, deleteField()]) await fails(updateDoc(msg(BOB, 'm-a'), { isPinned }));
    await seed(async (db) => { await updateDoc(doc(db, path, 'm-del'), { isPinned: false }); });
    await fails(updateDoc(msg(BOB, 'm-del'), { isPinned: true }));
    await fails(updateDoc(msg(ALICE, 'm-a'), { isPinned: true, isDeleted: true, text: null }));
  });

  it('the author’s edit and delete stay what the app does', async () => {
    for (const change of [
      // Each marked as edited, so the clause named is the one that refuses it.
      { text: { a: 1 }, isEdited: true }, { text: '', isEdited: true }, { text: 'x'.repeat(4001), isEdited: true },
      { imageUrl: 'javascript:alert(1)', isEdited: true }, { imageUrl: chatUrl('chat-images', 'another-conversation'), isEdited: true },
      { audioUrl: chatUrl('chat-audio', conv) },
      { createdAt: serverTimestamp() }, { replyToId: 'm-none' }, { text: null, imageUrl: null, isEdited: true },
    ]) {
      await fails(updateDoc(msg(ALICE, 'm-a'), change));
    }
    // Words or a picture changed without showing as edited.
    await fails(updateDoc(msg(ALICE, 'm-a'), { text: 'changed' }));
    await fails(updateDoc(msg(ALICE, 'm-photo'), { imageUrl: chatUrl('chat-images', conv, 'a_9_other.jpg') }));
    // `isEdited` only ever becomes true (on an APK message, which has none).
    await fails(updateDoc(msg(ALICE, 'm-apk'), { isEdited: false }));
    // A deleted message stays deleted, and its content does not come back.
    for (const change of [{ isDeleted: false }, { isDeleted: deleteField() }, { text: 'back' }, { imageUrl: chatUrl('chat-images', conv) }, { isEdited: true }]) {
      await fails(updateDoc(msg(ALICE, 'm-del'), change));
    }
  });

  it('"is typing" is the server’s time and nothing else, and only one’s own', async () => {
    const t = (who: string, uid: string) => doc(as(who), `${coll}/${conv}/typing`, uid);
    for (const body of [{ at: 1 }, { updatedAt: new Date() }, { updatedAt: serverTimestamp(), x: 1 }]) {
      await fails(setDoc(t(BOB, BOB), body));
    }
    await fails(setDoc(t(BOB, ALICE), { updatedAt: serverTimestamp() }));
    await fails(setDoc(t(CAROL, CAROL), { updatedAt: serverTimestamp() }));
    await fails(setDoc(t(DAVE, DAVE), { updatedAt: serverTimestamp() }));
    await fails(deleteDoc(t(BOB, ALICE)));
    await fails(deleteDoc(t(DAVE, ALICE)));
  });
});

describe('a group’s id is compared, never read as a pattern', () => {
  it('a group named like a pattern cannot pass `javascript:` as its picture', async () => {
    const odd = 'a|javascript:.*';
    await resetWorld();
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', odd), { name: 'Odd', ownerId: BOB, members: [BOB] });
    });
    const url = `javascript:alert(1)//%2F${odd}%2Fx?alt=media&token=a`;
    await fails(addDoc(collection(as(BOB), `groups/${odd}/messages`), webMessage(BOB, { text: null, imageUrl: url })));
  });
});
