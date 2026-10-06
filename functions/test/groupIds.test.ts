// functions/test/groupIds.test.ts
//
// Every group id ever used goes on a server-only list, so a deleted group's id cannot be created
// again (functions/src/groupIds.ts; the rule is in firestore.rules, tested in rules-tests/groups.test.ts).
// Through the real triggers and the real deletion, on the Firestore emulator.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Fn = { run: (arg: unknown) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const G = 'aaaaaaaaaaaaaaaaaaa1';

const used = async (id: string) => (await db.doc(`usedGroupIds/${id}`).get());
const exists = async (path: string) => (await db.doc(path).get()).exists;
const groupEvent = (groupId: string) => ({ params: { groupId }, data: undefined });

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('the list of used group ids', () => {
  it('a group goes on it when it is created; again changes nothing, and it holds a time only', async () => {
    await fn.onGroupCreated.run(groupEvent(G));
    const first = await used(G);
    expect(first.exists).toBe(true);
    expect(Object.keys(first.data()!)).toEqual(['at']);
    await fn.onGroupCreated.run(groupEvent(G));
    expect((await used(G)).data()!.at.isEqual(first.data()!.at)).toBe(true);
  });

  it('and when its document is deleted by anybody: the net for the installed app and the console', async () => {
    await fn.onGroupDeleted.run(groupEvent(G));
    expect((await used(G)).exists).toBe(true);
  });

  it('both triggers are retried by the platform when they throw', () => {
    for (const name of ['onGroupCreated', 'onGroupDeleted']) {
      const ep = (fn[name] as unknown as { __endpoint: { eventTrigger: { retry?: boolean } } }).__endpoint;
      expect(ep.eventTrigger.retry, name).toBe(true);
    }
  });

  it('a failure is logged and thrown, so the platform tries again', async () => {
    const realDoc = db.doc.bind(db);
    vi.spyOn(db, 'doc').mockImplementation(((path: string) => {
      const ref = realDoc(path);
      if (path === `usedGroupIds/${G}`) {
        return Object.assign(Object.create(Object.getPrototypeOf(ref)), ref, {
          create: () => Promise.reject(Object.assign(new Error('list unavailable'), { code: 14 })),
        });
      }
      return ref;
    }) as never);
    await expect(fn.onGroupCreated.run(groupEvent(G))).rejects.toThrow('list unavailable');
    vi.restoreAllMocks();
    const rows = (await db.collection('errorLogs').get()).docs.map((d) => d.data());
    expect(rows).toEqual([expect.objectContaining({ message: `list unavailable (group ${G})`, context: 'groupIds:onGroupCreated' })]);
  });

  it('the server’s deletion puts it on the list FIRST: a run that stops half way has already closed the id', async () => {
    await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
    vi.spyOn(db, 'recursiveDelete').mockRejectedValueOnce(new Error('stopped'));
    await expect(fn.deleteGroupCascade.run({
      data: { groupId: G }, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>)).rejects.toBeTruthy();
    expect((await used(G)).exists).toBe(true);
    expect(await exists(`groups/${G}`)).toBe(true);
  });

  it('a normal deletion leaves the id on the list and the group gone', async () => {
    await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
    await fn.deleteGroupCascade.run({
      data: { groupId: G }, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>);
    expect((await used(G)).exists).toBe(true);
    expect(await exists(`groups/${G}`)).toBe(false);
  });
});

describe('a chat message does not bring a deleted group back', () => {
  it('the preview is an update: a group deleted between the read and the write stays deleted', async () => {
    await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
    await db.doc(`users/${ALICE}`).set({ name: 'Alice' });
    const msgRef = db.doc(`groups/${G}/messages/m1`);
    await msgRef.set({ senderId: ALICE, text: 'hello' });
    const snap = await msgRef.get();
    // The trigger reads the group first; the group is deleted before its preview write.
    const realDoc = db.doc.bind(db);
    let n = 0;
    vi.spyOn(db, 'doc').mockImplementation(((path: string) => {
      const ref = realDoc(path);
      if (path === `groups/${G}` && ++n === 2) {
        return Object.assign(Object.create(Object.getPrototypeOf(ref)), ref, {
          update: async (...args: unknown[]) => { await realDoc(path).delete(); return (ref.update as (...a: unknown[]) => unknown)(...args); },
        });
      }
      return ref;
    }) as never);
    await fn.onMessageCreated.run({ data: snap, params: { groupId: G, messageId: 'm1' } });
    vi.restoreAllMocks();
    expect(n).toBe(2);
    expect(await exists(`groups/${G}`)).toBe(false);
    expect((await db.collection('notifications').get()).size).toBe(0);
  });

  it('on a group that exists, the preview is written as before', async () => {
    await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB], name: 'Family' });
    await db.doc(`users/${ALICE}`).set({ name: 'Alice' });
    const msgRef = db.doc(`groups/${G}/messages/m1`);
    await msgRef.set({ senderId: ALICE, text: 'hello' });
    await fn.onMessageCreated.run({ data: await msgRef.get(), params: { groupId: G, messageId: 'm1' } });
    expect((await db.doc(`groups/${G}`).get()).data()).toMatchObject({ lastMessageText: 'hello', lastMessageBy: ALICE, members: [ALICE, BOB] });
  });
});

describe('the one-off listing of ids the list cannot learn by itself (groupIdsBackfill.ts)', () => {
  let bf: typeof import('../src/groupIdsBackfill');
  beforeAll(async () => { bf = await import('../src/groupIdsBackfill'); });

  const LIVE = 'live-group-1';
  const LIVE_LATE = 'live-group-late';
  beforeEach(async () => {
    // A group made after its own first message: what an id deleted and created again looks like.
    await db.doc(`groups/${LIVE_LATE}/messages/m0`).set({ senderId: ALICE, text: 'before' });
    // Two back-to-back writes can share a createTime on the emulator, and an equal time is not
    // "created after" (the check is strict on purpose: a group and its first message never are).
    // This fixture once passed alone and failed in the full suite.
    await new Promise((r) => setTimeout(r, 10));
    await db.doc(`groups/${LIVE_LATE}`).set({ ownerId: BOB, members: [BOB], name: 'Again' });
    await db.doc(`groups/${LIVE}`).set({ ownerId: ALICE, members: [ALICE], name: 'Family' });
    await db.doc(`groups/${LIVE}/messages/m1`).set({ senderId: ALICE, text: 'hi' });
    // A deleted group whose messages were left (the installed app deletes only the document).
    await db.doc('groups/gone-parent/messages/m1').set({ senderId: ALICE, text: 'left' });
    // Deleted groups still named elsewhere.
    await db.doc('events/e1').set({ ownerId: ALICE, groupId: 'gone-event' });
    await db.doc('expenses/x1').set({ ownerId: ALICE, groupId: 'gone-expense' });
    await db.doc('games/g1').set({ createdBy: ALICE, groupId: 'gone-game' });
    await db.doc('group_invites/i1').set({ fromId: ALICE, groupId: 'gone-invite' });
    await db.doc('invite_links/l1').set({ createdBy: ALICE, groupId: 'gone-link' });
    await db.doc('assets/a1').set({ ownerId: ALICE, sharedGroupId: 'gone-asset' });
    // Nothing to list.
    await db.doc('events/e2').set({ ownerId: ALICE, groupId: null });
    await db.doc('assets/a2').set({ ownerId: ALICE, sharedGroupId: '' });
    // Not one document id: reported, never written.
    await db.doc('events/e3').set({ ownerId: ALICE, groupId: 'x/typing/y' });
  });

  it('the plan is every live group, every deleted parent, every id still named; odd ids refused; re-created ones flagged', async () => {
    const plan = await bf.planGroupIdBackfill(db);
    expect(plan.toRegister).toEqual([
      'gone-asset', 'gone-event', 'gone-expense', 'gone-game', 'gone-invite', 'gone-link', 'gone-parent', LIVE, LIVE_LATE,
    ].sort());
    expect(plan).toMatchObject({ live: 2, missingParents: 1, referencedDead: 6, refused: ['x/typing/y'], recreatedSuspects: [LIVE_LATE] });
  });

  it('the plan writes nothing; applying lists them all once, and again lists nothing new', async () => {
    const plan = await bf.planGroupIdBackfill(db);
    expect((await db.collection('usedGroupIds').get()).size).toBe(0);
    expect(await bf.applyGroupIdBackfill(plan.toRegister, db)).toBe(9);
    expect((await db.collection('usedGroupIds').get()).docs.map((d) => d.id).sort()).toEqual(plan.toRegister);
    expect(await bf.applyGroupIdBackfill(plan.toRegister, db)).toBe(0);
  });

  it('an id that is not one document is skipped even if handed in', async () => {
    expect(await bf.applyGroupIdBackfill(['x/typing/y', '..', '__bad__', ''], db)).toBe(0);
    expect((await db.collection('usedGroupIds').get()).size).toBe(0);
  });

  it('isPlainDocId: one segment, not reserved', () => {
    for (const ok of ['aaaaaaaaaaaaaaaaaaa1', 'group-one']) expect(bf.isPlainDocId(ok), ok).toBe(true);
    for (const bad of ['', 'a/b', '.', '..', '__x__', 7, null, 'x'.repeat(1501)]) expect(bf.isPlainDocId(bad), String(bad)).toBe(false);
  });
});
