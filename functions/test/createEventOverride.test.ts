// functions/test/createEventOverride.test.ts
//
// The first test in this project that runs a CALLABLE — the real handler, via `.run()` — against
// the Firestore emulator. Every callable runs on the Admin SDK, which does not evaluate rules, so
// the 290-odd rules tests say nothing about what these functions let through. This one was chosen
// first because it had two defects at once (24.09.2026):
//
//   * A.5 — it copied `rsvps` from the request, so one member could answer for the family;
//   * A.6 — it was not idempotent (a second member with a stale screen made a second override for
//     the same day, and the event showed twice), and the server's dedupe keyed on the override's
//     NEW date, hiding a real occurrence when one was moved onto another's day.
//
// Runs under `npm run test:rules`, which starts the emulator and sets FIRESTORE_EMULATOR_HOST and
// GCLOUD_PROJECT before anything here imports the functions — so `admin.initializeApp()` in
// index.ts connects to the emulator and cannot reach a real project (the id is `demo-*`).

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { expandInWindow, type EventDoc } from '../src/recurrenceServer';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createEventOverride: { run: (req: CallableRequest<any>) => Promise<any> };
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
const PARENT = 'series-walk';

function call(uid: string, data: Record<string, unknown>) {
  return createEventOverride.run({
    data,
    auth: { uid, token: { uid } },
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}

async function overridesOf(parentId: string) {
  return (await db.collection('events').where('overrideOfParent', '==', parentId).get()).docs;
}

beforeAll(async () => {
  // Refuse to run anywhere but the emulator. Without these the Admin SDK would look for real
  // credentials, and a demo id guarantees it could not find a real project even if it did.
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  createEventOverride = (await import('../src/index')).createEventOverride as never;
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE, BOB, CAROL], name: 'Family' });
  await db.doc(`events/${PARENT}`).set({
    title: 'Walk', ownerId: ALICE, groupId: 'g1', date: '2026-09-20T00:00:00.000Z',
    recurrenceRule: { frequency: 'daily' }, rsvpEnabled: true,
    rsvps: { [ALICE]: 'yes', [CAROL]: 'no' }, assigneeIds: [],
  });
});

describe('A.5 — an override carries only the caller’s own RSVP', () => {
  it('Bob cannot answer for Carol, or for anybody else, through the callable', async () => {
    const { id } = await call(BOB, {
      parentId: PARENT, overrideDate: '2026-09-22',
      data: { title: 'Walk', rsvps: { [ALICE]: 'no', [CAROL]: 'yes', [BOB]: 'maybe', 'uid-dave': 'yes' } },
    });
    const rsvps = (await db.doc(`events/${id}`).get()).data()?.rsvps;
    expect(rsvps).toEqual({ [ALICE]: 'yes', [CAROL]: 'no', [BOB]: 'maybe' });
  });
});

describe('A.6 — one override per occurrence', () => {
  it('records the day it replaces, and excepts it on the parent', async () => {
    const { id, existed } = await call(BOB, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk' } });
    expect(existed).toBe(false);
    expect((await db.doc(`events/${id}`).get()).data()?.overrideDate).toBe('2026-09-22');
    expect((await db.doc(`events/${PARENT}`).get()).data()?.recurrenceExceptions).toEqual(['2026-09-22']);
  });

  it('a second call for the same day returns the SAME override instead of making another', async () => {
    const first = await call(ALICE, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk (Alice)' } });
    const second = await call(BOB, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk' } });
    expect(second).toEqual({ id: first.id, existed: true });
    expect(await overridesOf(PARENT)).toHaveLength(1);
    // Materialising does not overwrite the edit somebody already made with a copy of the parent.
    expect((await db.doc(`events/${first.id}`).get()).data()?.title).toBe('Walk (Alice)');
  });

  it('with apply, the edit form’s change lands on the existing override — other answers kept', async () => {
    const first = await call(CAROL, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk' } });
    const second = await call(BOB, {
      parentId: PARENT, overrideDate: '2026-09-22', apply: true,
      data: { title: 'Walk, later', rsvps: { [CAROL]: 'yes', [BOB]: 'yes' } },
    });
    expect(second.id).toBe(first.id);
    const doc = (await db.doc(`events/${first.id}`).get()).data();
    expect(doc?.title).toBe('Walk, later');
    expect(doc?.rsvps).toEqual({ [ALICE]: 'yes', [CAROL]: 'no', [BOB]: 'yes' });
    expect(await overridesOf(PARENT)).toHaveLength(1);
  });

  it('a DELETED occurrence is not resurrected from a stale screen', async () => {
    await db.doc(`events/${PARENT}`).update({ recurrenceExceptions: ['2026-09-22'] });
    await expect(call(BOB, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk' } }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await overridesOf(PARENT)).toHaveLength(0);
  });

  it('an override made before overrideDate existed is still found, not duplicated', async () => {
    await db.doc('events/legacy').set({
      title: 'Walk (old)', ownerId: ALICE, groupId: 'g1', date: '2026-09-22T00:00:00.000Z',
      overrideOfParent: PARENT,
    });
    await db.doc(`events/${PARENT}`).update({ recurrenceExceptions: ['2026-09-22'] });
    const r = await call(BOB, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk' } });
    expect(r).toEqual({ id: 'legacy', existed: true });
    expect(await overridesOf(PARENT)).toHaveLength(1);
  });

  it('moving an occurrence onto another occurrence’s day no longer hides the real one', async () => {
    // Daily series; the 22nd moved to the 23rd. The server's dedupe keyed on the override's own
    // date, so the REAL occurrence on the 23rd got no reminder and fell out of the digest.
    await call(BOB, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk', date: '2026-09-23T00:00:00.000Z' } });
    const docs = (await db.collection('events').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as EventDoc);
    const on23 = expandInWindow(docs, '2026-09-22', '2026-09-23').filter((o) => o.day === '2026-09-23');
    expect(on23.map((o) => (o.virtual ? 'series' : 'override')).sort()).toEqual(['override', 'series']);
    // And the 22nd, which the override replaced, is gone from the series.
    expect(expandInWindow(docs, '2026-09-22', '2026-09-22').filter((o) => o.virtual)).toEqual([]);
  });
});

describe('pre-deploy review 24.09 — only a document that BELONGS to the parent is its override', () => {
  it('a planted personal event carrying the keys is not adopted, and not written into', async () => {
    // Any account may create an event with these two keys; no rule mentions them.
    await db.doc('events/000-plant').set({
      title: 'x', ownerId: 'uid-dave', groupId: null, date: '2026-09-22T00:00:00.000Z',
      overrideOfParent: PARENT, overrideDate: '2026-09-22',
    });
    const r = await call(BOB, {
      parentId: PARENT, overrideDate: '2026-09-22', apply: true,
      data: { title: 'Walk', description: 'gate code 4711' },
    });
    expect(r.id).not.toBe('000-plant');
    expect((await db.doc('events/000-plant').get()).data()?.description).toBeUndefined();
    expect((await db.doc(`events/${r.id}`).get()).data()?.ownerId).toBe(ALICE);
  });

  it('a leave-group copy of an override does not stand in for the real one', async () => {
    // LeaveGroupModal (and the APK) copy an event with a full spread, override keys included.
    const real = await call(ALICE, { parentId: PARENT, overrideDate: '2026-09-22', data: { title: 'Walk (real)' } });
    await db.doc('events/000-copy').set({
      title: 'Walk (copy)', ownerId: BOB, groupId: null, date: '2026-09-22T00:00:00.000Z',
      overrideOfParent: PARENT, overrideDate: '2026-09-22',
    });
    const again = await call(CAROL, { parentId: PARENT, overrideDate: '2026-09-22', apply: true, data: { title: 'Walk, later' } });
    expect(again).toEqual({ id: real.id, existed: true });
    expect((await db.doc('events/000-copy').get()).data()?.title).toBe('Walk (copy)');
  });

  it('and such a copy does not hide the real occurrence from reminders and the digest', async () => {
    await db.doc('events/000-copy').set({
      title: 'Walk (copy)', ownerId: BOB, groupId: null, date: '2026-09-22T00:00:00.000Z',
      overrideOfParent: PARENT, overrideDate: '2026-09-22',
    });
    const docs = (await db.collection('events').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as EventDoc);
    const on22 = expandInWindow(docs, '2026-09-22', '2026-09-22').filter((o) => o.virtual);
    expect(on22.map((o) => o.source.id)).toEqual([PARENT]);
  });
});

describe('pre-deploy review 24.09 — no client-written stamp survives the trigger', () => {
  it('a personal invitation loses a verifiedGroupName its sender wrote', async () => {
    // Before the rule that forbids it is live, a client may write the stamp. With no group the
    // trigger used to write `{ sender }` only, so the forged group name survived.
    const { onGroupInviteCreated } = await import('../src/index');
    await db.doc('group_invites/i1').set({
      fromId: BOB, groupId: null, toEmail: 'x@example.test', status: 'pending', verifiedGroupName: 'Bank',
    });
    const snap = await db.doc('group_invites/i1').get();
    await (onGroupInviteCreated as unknown as { run: (e: unknown) => Promise<unknown> })
      .run({ data: snap, params: { inviteId: 'i1' } });
    const after = (await db.doc('group_invites/i1').get()).data();
    expect(after?.verifiedGroupName).toBeUndefined();
    expect(after?.sender).toBeDefined();
  });
});
