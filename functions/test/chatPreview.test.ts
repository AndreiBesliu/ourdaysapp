// functions/test/chatPreview.test.ts
//
// A deleted or edited message, in the conversation list too (06.11.2026, functions/src/chatPreviewWrite.ts).
// The preview (`lastMessageText`) used to keep a deleted message's words until somebody wrote again. Now every
// trigger that touches it writes what the conversation's NEWEST message says now, so it converges whatever order
// Eventarc delivers the events in. Through the real update and create triggers, on the Firestore emulator, with FCM
// replaced by a recorder.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Fn = { run: (arg: unknown) => Promise<unknown>; __endpoint: { eventTrigger: { eventType: string; eventFilterPathPatterns: { document: string } } } };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const G = 'g-preview';
const CHAT = [ALICE, BOB].sort().join('__');
const ts = (iso: string) => admin.firestore.Timestamp.fromMillis(Date.parse(iso));
const T0 = ts('2026-11-06T09:00:00.000Z');
const T1 = ts('2026-11-06T09:05:00.000Z');
const T2 = ts('2026-11-06T09:10:00.000Z');
const LAST_AT = ts('2026-11-06T09:05:01.000Z');

const message = (fields: Record<string, unknown>) => ({
  senderId: BOB, seenBy: [BOB], replyToId: null, isDeleted: false, isEdited: false, ...fields,
});
const deleted = (m: Record<string, unknown>) => ({ ...m, isDeleted: true, text: null, imageUrl: null, audioUrl: null });
const conv = async (path: string) => (await db.doc(path).get()).data();
const bell = async () => (await db.collection('notifications').get()).docs.map((d) => d.data());

const TRIGGERS = { group: 'onGroupMessageUpdated', chat: 'onDirectMessageUpdated' } as const;
const PATHS = { group: `groups/${G}`, chat: `chats/${CHAT}` } as const;
type Kind = keyof typeof PATHS;

/** Write the message as it becomes, then hand the trigger its before and after, as Eventarc would. */
async function update(kind: Kind, id: string, before: Record<string, unknown>, after: Record<string, unknown>, write = true) {
  if (write) await db.doc(`${PATHS[kind]}/messages/${id}`).set(after);
  const params = kind === 'group' ? { groupId: G, messageId: id } : { chatId: CHAT, messageId: id };
  await fn[TRIGGERS[kind]].run({ params, data: { before: { data: () => before }, after: { data: () => after } } });
}

/** A create event for a message as it was created; the document itself is whatever it is now. */
async function created(kind: Kind, id: string, asCreated: Record<string, unknown>) {
  const ref = db.doc(`${PATHS[kind]}/messages/${id}`);
  const params = kind === 'group' ? { groupId: G, messageId: id } : { chatId: CHAT, messageId: id };
  const trigger = kind === 'group' ? 'onMessageCreated' : 'onDirectMessageCreated';
  await fn[trigger].run({ params, data: { ref, id, data: () => asCreated } });
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  // FCM is not emulated: nothing here may reach it.
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'sendEachForMulticast').mockImplementation((async (msg: { tokens: string[] }) => ({
    successCount: msg.tokens.length, failureCount: 0, responses: msg.tokens.map(() => ({ success: true })),
  })) as never);
  for (const kind of ['group', 'chat'] as const) {
    await db.doc(PATHS[kind]).set({
      members: [ALICE, BOB], ...(kind === 'group' ? { name: 'Family', ownerId: ALICE } : {}),
      lastMessageText: 'secret words', lastMessageBy: BOB, lastMessageAt: LAST_AT,
    });
    await db.doc(`${PATHS[kind]}/messages/m0`).set(message({ text: 'older words', senderId: ALICE, createdAt: T0 }));
    await db.doc(`${PATHS[kind]}/messages/m1`).set(message({ text: 'secret words', createdAt: T1 }));
  }
  for (const [uid, name] of [[ALICE, 'Alice'], [BOB, 'Bob']]) {
    await db.doc(`users/${uid}`).set({ name, fcmTokens: [`tok-${uid}`] });
    await db.doc(`profiles/${uid}`).set({ name });
  }
});

afterEach(() => { vi.restoreAllMocks(); });

const NEWEST = message({ text: 'secret words', createdAt: T1 });

describe('the triggers are where the messages are', () => {
  it.each([
    ['onGroupMessageUpdated', 'updated', 'groups/{groupId}/messages/{messageId}'],
    ['onDirectMessageUpdated', 'updated', 'chats/{chatId}/messages/{messageId}'],
    ['onMessageCreated', 'created', 'groups/{groupId}/messages/{messageId}'],
    ['onDirectMessageCreated', 'created', 'chats/{chatId}/messages/{messageId}'],
  ])('%s fires on %s %s (what the deploy reads)', (name, event, path) => {
    expect(fn[name].__endpoint.eventTrigger.eventType).toBe(`google.cloud.firestore.document.v1.${event}`);
    expect(fn[name].__endpoint.eventTrigger.eventFilterPathPatterns.document).toBe(path);
  });
});

describe('the newest message deleted, or edited', () => {
  it.each(['group', 'chat'] as const)('in a %s: its words leave the preview, which says it was deleted; when stays', async (kind) => {
    await update(kind, 'm1', NEWEST, deleted(NEWEST));
    const c = await conv(PATHS[kind]);
    expect(c).toMatchObject({ lastMessageText: '', lastMessageDeleted: true, lastMessageBy: BOB });
    expect(c?.lastMessageAt.toMillis()).toBe(LAST_AT.toMillis());
    expect(JSON.stringify(c)).not.toContain('secret');
  });

  it.each(['group', 'chat'] as const)('in a %s: a delete that sets only the flag and leaves the words (the rules allow it) still hides them', async (kind) => {
    await update(kind, 'm1', NEWEST, { ...NEWEST, isDeleted: true });
    const c = await conv(PATHS[kind]);
    expect(c).toMatchObject({ lastMessageText: '', lastMessageDeleted: true });
    expect(JSON.stringify(c)).not.toContain('secret');
  });

  it('a deleted newest message over a preview already empty still reads "deleted" (the live group of 06.11.2026)', async () => {
    await db.doc(PATHS.group).update({ lastMessageText: '' });
    await update('group', 'm1', NEWEST, deleted(NEWEST));
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: '', lastMessageDeleted: true, lastMessageBy: BOB });
  });

  it.each([
    ['a picture', { imageUrl: 'https://firebasestorage.googleapis.com/x.jpg' }, '\u{1F4F7}'],
    ['a voice note', { audioUrl: 'https://firebasestorage.googleapis.com/x.webm' }, '\u{1F3A4}'],
  ])('%s deleted goes the same way', async (_label, media, shown) => {
    const m = message({ ...media, createdAt: T1 });
    await db.doc(PATHS.group).update({ lastMessageText: shown });
    await update('group', 'm1', m, deleted(m));
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: '', lastMessageDeleted: true });
  });

  it.each(['group', 'chat'] as const)('edited in a %s: the new words, cut like every preview, and no longer "deleted"', async (kind) => {
    await db.doc(PATHS[kind]).update({ lastMessageDeleted: true });
    const edited = { ...NEWEST, text: `fixed ${'\u{1F600}'.repeat(200)}`, isEdited: true };
    await update(kind, 'm1', NEWEST, edited);
    const c = await conv(PATHS[kind]);
    expect(Array.from(c?.lastMessageText as string)).toHaveLength(140);
    expect((c?.lastMessageText as string).startsWith('fixed ')).toBe(true);
    expect(c && 'lastMessageDeleted' in c).toBe(false);
    // An edit moves nothing up the list.
    expect(c?.lastMessageAt.toMillis()).toBe(LAST_AT.toMillis());
  });

  it('the words and the name come from the same message: never one person’s words under another’s name', async () => {
    // Alice's message is the newest, but the preview still names Bob (a create trigger that never ran, say).
    await db.doc(`${PATHS.group}/messages/m2`).set(message({ text: 'see you', senderId: ALICE, createdAt: T2 }));
    const mine = message({ text: 'see you', senderId: ALICE, createdAt: T2 });
    await update('group', 'm2', mine, { ...mine, text: 'see you Sunday', isEdited: true });
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'see you Sunday', lastMessageBy: ALICE });
  });
});

describe('whatever order the events arrive in, the preview ends as the newest message is', () => {
  it.each(['group', 'chat'] as const)('in a %s, deleted a second after it was sent, its delete handled first: not brought back, not announced', async (kind) => {
    const sent = message({ text: 'wrong chat, sorry: secret', senderId: ALICE, createdAt: T2 });
    await update(kind, 'm2', sent, deleted(sent));
    await created(kind, 'm2', sent);
    const c = await conv(PATHS[kind]);
    expect(c).toMatchObject({ lastMessageText: '', lastMessageDeleted: true, lastMessageBy: ALICE });
    expect(JSON.stringify(c)).not.toContain('secret');
    // Taken back before it was announced: nobody is told, so its words reach no phone and no bell.
    expect(await bell()).toEqual([]);
  });

  it.each(['group', 'chat'] as const)('in a %s, an edit made before the message was announced is what goes out, to the list and the bell', async (kind) => {
    const sent = message({ text: 'meet at 5', senderId: ALICE, createdAt: T2 });
    await db.doc(`${PATHS[kind]}/messages/m2`).set({ ...sent, text: 'meet at 6', isEdited: true });
    await created(kind, 'm2', sent);
    expect(await conv(PATHS[kind])).toMatchObject({ lastMessageText: 'meet at 6', lastMessageBy: ALICE });
    const rows = await bell();
    expect(rows.map((r) => [r.userId, r.body])).toEqual([[BOB, 'meet at 6']]);
  });

  it('an edit event handled after the delete it preceded does not bring the words back', async () => {
    const edited = { ...NEWEST, text: 'fixed words', isEdited: true };
    await db.doc(`${PATHS.group}/messages/m1`).set(deleted(edited));
    await update('group', 'm1', edited, deleted(edited), false);
    await update('group', 'm1', NEWEST, edited, false);
    const c = await conv(PATHS.group);
    expect(c).toMatchObject({ lastMessageText: '', lastMessageDeleted: true });
    expect(JSON.stringify(c)).not.toContain('fixed');
  });

  it('two messages whose create events finish in the wrong order: the preview is the newer one', async () => {
    const older = message({ text: 'first', senderId: ALICE, createdAt: T2 });
    const newer = message({ text: 'second', senderId: BOB, createdAt: ts('2026-11-06T09:15:00.000Z') });
    await db.doc(`${PATHS.group}/messages/m2`).set(older);
    await db.doc(`${PATHS.group}/messages/m3`).set(newer);
    await created('group', 'm3', newer);
    await created('group', 'm2', older);
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'second', lastMessageBy: BOB });
  });

  it('a new message after a deleted one: the preview is the new message, and no longer says deleted', async () => {
    await db.doc(PATHS.chat).update({ lastMessageText: '', lastMessageDeleted: true });
    const sent = message({ text: 'hello again', senderId: ALICE, createdAt: T2 });
    await db.doc(`${PATHS.chat}/messages/m2`).set(sent);
    await created('chat', 'm2', sent);
    const c = await conv(PATHS.chat);
    expect(c).toMatchObject({ lastMessageText: 'hello again', lastMessageBy: ALICE });
    expect(c && 'lastMessageDeleted' in c).toBe(false);
    expect(c?.lastMessageAt.toMillis()).toBeGreaterThan(LAST_AT.toMillis());
  });

  it('a group of one: nobody to tell, and still a preview', async () => {
    await db.doc(PATHS.group).update({ members: [ALICE] });
    const sent = message({ text: 'note to self', senderId: ALICE, createdAt: T2 });
    await db.doc(`${PATHS.group}/messages/m2`).set(sent);
    await created('group', 'm2', sent);
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'note to self', lastMessageBy: ALICE });
    expect(await bell()).toEqual([]);
  });
});

describe('what leaves the preview alone', () => {
  it('an older message deleted or edited: the preview is the newest one’s, and is not even written again', async () => {
    // The probe is the transaction's write itself: Firestore keeps `updateTime` on a write that changes nothing, so
    // comparing it would pass with the write back in (the mutant survived that way, 06.11.2026).
    const writes = vi.spyOn(admin.firestore.Transaction.prototype, 'update');
    const older = message({ text: 'older words', senderId: ALICE, createdAt: T0 });
    await update('group', 'm0', older, deleted(older));
    await update('chat', 'm0', older, { ...older, text: 'older, fixed', isEdited: true });
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'secret words', lastMessageBy: BOB });
    expect(await conv(PATHS.chat)).toMatchObject({ lastMessageText: 'secret words', lastMessageBy: BOB });
    expect((await conv(PATHS.group))?.lastMessageDeleted).toBeUndefined();
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ['words', { lastMessageText: 'stale words' }],
    ['name', { lastMessageBy: ALICE }],
    ['"deleted"', { lastMessageDeleted: true }],
  ])('a stale %s in the preview is corrected by the next edit or delete of any message, even an older one', async (_label, stale) => {
    await db.doc(PATHS.group).update(stale);
    const older = message({ text: 'older words', senderId: ALICE, createdAt: T0 });
    await update('group', 'm0', older, deleted(older));
    const c = await conv(PATHS.group);
    expect(c).toMatchObject({ lastMessageText: 'secret words', lastMessageBy: BOB });
    expect(c && 'lastMessageDeleted' in c).toBe(false);
  });

  it.each([
    ['a text', 'x'],
    ['a map', { a: 1 }],
    ['a time in 2099', ts('2099-01-01T00:00:00.000Z')],
  ])('a message from before 08.10 whose createdAt is %s is never the newest', async (_label, when) => {
    await db.doc(`${PATHS.group}/messages/odd`).set(message({ text: 'odd old words', senderId: ALICE, createdAt: when }));
    const older = message({ text: 'older words', senderId: ALICE, createdAt: T0 });
    await db.doc(PATHS.group).update({ lastMessageText: 'stale words' });
    await update('group', 'm0', older, deleted(older));
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'secret words', lastMessageBy: BOB });
  });

  it('the same words sent again are a new message: the conversation still moves up the list', async () => {
    const again = message({ text: 'secret words', createdAt: T2 });
    await db.doc(`${PATHS.group}/messages/m2`).set(again);
    await created('group', 'm2', again);
    expect((await conv(PATHS.group))?.lastMessageAt.toMillis()).toBeGreaterThan(LAST_AT.toMillis());
  });

  it('a receipt, a reaction or a pin changes nothing, and reads nothing', async () => {
    const tx = vi.spyOn(db, 'runTransaction');
    const docGet = vi.spyOn(admin.firestore.DocumentReference.prototype, 'get');
    const queryGet = vi.spyOn(admin.firestore.Query.prototype, 'get');
    await update('group', 'm1', NEWEST, { ...NEWEST, seenBy: [BOB, ALICE] }, false);
    await update('chat', 'm1', NEWEST, { ...NEWEST, reactions: { '❤️': [ALICE] } }, false);
    await update('group', 'm1', NEWEST, { ...NEWEST, isPinned: true }, false);
    expect(tx).not.toHaveBeenCalled();
    expect(docGet).not.toHaveBeenCalled();
    expect(queryGet).not.toHaveBeenCalled();
  });

  it('an update to a message already deleted changes nothing', async () => {
    await update('group', 'm1', NEWEST, deleted(NEWEST));
    await db.doc(PATHS.group).update({ lastMessageText: 'set by hand' });
    await update('group', 'm1', deleted(NEWEST), { ...deleted(NEWEST), isPinned: false });
    expect(await conv(PATHS.group)).toMatchObject({ lastMessageText: 'set by hand' });
  });

  it('a conversation deleted meanwhile is not brought back holding a preview', async () => {
    await db.recursiveDelete(db.doc(PATHS.group));
    await update('group', 'm1', NEWEST, deleted(NEWEST));
    expect((await db.doc(PATHS.group).get()).exists).toBe(false);
  });

  it.each(['onGroupMessageUpdated', 'onDirectMessageUpdated'])('%s is retried by the platform when it throws; the create triggers are not (they announce)', (name) => {
    const ep = (n: string) => (fn[n] as unknown as { __endpoint: { eventTrigger: { retry?: boolean } } }).__endpoint;
    expect(ep(name).eventTrigger.retry).toBe(true);
    expect(ep('onMessageCreated').eventTrigger.retry).toBeFalsy();
    expect(ep('onDirectMessageCreated').eventTrigger.retry).toBeFalsy();
  });

  it.each(['group', 'chat'] as const)('in a %s, a preview that cannot be rewritten is reported and thrown, so the platform tries again', async (kind) => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('injected: preview transaction'));
    await expect(update(kind, 'm1', NEWEST, deleted(NEWEST))).rejects.toThrow('injected: preview transaction');
    const rows = (await db.collection('errorLogs').get()).docs.map((d) => d.data());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ context: 'chat:preview', source: 'server' });
    expect(rows[0].message).toContain('injected: preview transaction');
  });

  it.each(['group', 'chat'] as const)('in a %s, a NEW message whose preview cannot be written is reported, and still announced', async (kind) => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('injected: preview transaction'));
    const sent = message({ text: 'hello there', senderId: ALICE, createdAt: T2 });
    await db.doc(`${PATHS[kind]}/messages/m2`).set(sent);
    await created(kind, 'm2', sent);
    const rows = (await db.collection('errorLogs').get()).docs.map((d) => d.data());
    expect(rows).toEqual([expect.objectContaining({ context: 'chat:preview', source: 'server' })]);
    expect(rows[0].message).toContain('injected: preview transaction');
    expect((await bell()).map((r) => [r.userId, r.body])).toEqual([[BOB, 'hello there']]);
    // Nothing else wrote the preview meanwhile.
    expect(await conv(PATHS[kind])).toMatchObject({ lastMessageText: 'secret words' });
  });

  it.each(['group', 'chat'] as const)('in a %s, without the preview, a message already taken back is still not announced', async (kind) => {
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('injected: preview transaction'));
    const sent = message({ text: 'wrong chat: secret', senderId: ALICE, createdAt: T2 });
    await db.doc(`${PATHS[kind]}/messages/m2`).set(deleted(sent));
    await created(kind, 'm2', sent);
    expect(await bell()).toEqual([]);
  });
});
