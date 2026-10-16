// functions/test/deletionReads.test.ts
//
// Deleting an account or a group reads what the person and their groups hold, and until 15.10.2026 it
// read every document whole, in pages of 300 to 500. Anybody can pad a document to 1 MiB, and several
// of the documents it read are written by OTHER people: a friend request or an invitation by anybody
// signed in (their rules type no field), a group event by every member (its checklist, its picture and
// `hiddenFrom` have no limit). A few hundred of them ran the deletion out of its 256 MiB at every
// attempt, after its first steps had run; the account could then not be deleted, from Settings or from
// Admin, and a group's owner could not delete the group. Pinned here, on the emulators, through the
// real callables:
//   1. no read, query or document, brings a field the deletion does not use (a field `pad` on every
//      document somebody else could have written);
//   2. a page that brings any field brings at most TEN documents (ten of 1 MiB is what the function can
//      hold beside everything else); every other page brings references only;
//   3. and everything still happens, across pages: of each kind, more than one such page holds.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { watchReads } from './watchReads';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

/** The test's own number, not the code's: a constant raised in the code must turn this red. */
const MOST_PER_FIELD_PAGE = 10;
/** Of every kind, more than one page of fields holds, so each read has to go on to a second page. */
const N = 12;
const PAD = { pad: 'x'.repeat(64) };

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let deleteMine: Callable;
let deleteGroup: Callable;
let db: admin.firestore.Firestore;
let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const BOB = 'uid-bob';
const STRANGER = 'uid-stranger';
const EMAIL = 'gone@example.test';
const G_OWNED = 'aaaaaaaaaaaaaaaaaaa1'; // theirs, with Ana in it: passes to Ana
const G_MEMBER = 'bbbbbbbbbbbbbbbbbbb2'; // Bob's, they are in it
const G_LEFT = 'ccccccccccccccccccc3'; // Bob's, they left it earlier
const G_ALONE = 'zzzzzzzzzzzzzzzzzzz9'; // theirs, nobody else in it: goes
const G_DEL = 'ddddddddddddddddddd4'; // Ana's, which she deletes
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const ids = (prefix: string, n = N) => range(n).map((i) => `${prefix}-${String(i).padStart(2, '0')}`);

const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({
  data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const data = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

const KEPT_FILES = [
  ...ids('ana').map((id) => `checklists/${GONE}/${id}.png`), // on Ana's events in their group
  ...ids('mine').map((id) => `events/${GONE}/${id}.png`), // their events in Bob's group, which Bob inherits
  ...ids('left').map((id) => `events/${GONE}/${id}.png`), // their events in a group they had left
  ...ids('gift').map((id) => `assets/${GONE}/${id}.png`), // cards they gave Bob
];
const GONE_FILES = [
  ...ids('personal').map((id) => `events/${GONE}/${id}.png`),
  `assets/${GONE}/card.png`,
  `events/${GONE}/secret.png`, // their event in Bob's group, hidden from Bob: nobody inherits it
];

async function seedAccount() {
  await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
  for (const uid of [ANA, BOB]) await admin.auth().createUser({ uid });
  // Their own documents, and a friend's, are read one at a time and whole on purpose: no pad there.
  const docs: Array<[string, Record<string, unknown>]> = [
    [`users/${GONE}`, { name: 'Gina', email: EMAIL, friends: [{ uid: ANA, name: 'Ana' }] }],
    [`profiles/${GONE}`, { name: 'Gina' }],
    [`users/${ANA}`, { name: 'Ana', friends: [{ uid: GONE, name: 'Gina' }] }],
    [`groups/${G_OWNED}`, { name: 'Family', ownerId: GONE, members: [GONE, ANA], ...PAD }],
    [`groups/${G_MEMBER}`, { name: 'Friends', ownerId: BOB, members: [BOB, GONE], ...PAD }],
    [`groups/${G_LEFT}`, { name: 'Old club', ownerId: BOB, members: [BOB], ...PAD }],
    [`groups/${G_ALONE}`, { name: 'Mine', ownerId: GONE, members: [GONE], ...PAD }],
  ];
  for (const id of ids('ana')) {
    docs.push([`events/${id}`, {
      ownerId: ANA, groupId: G_OWNED, title: id, assigneeIds: [GONE, ANA], assigneeId: GONE,
      rsvps: { [GONE]: 'yes', [ANA]: 'no' },
      checklistItems: [{ id: 'i', text: 'x', isCompleted: false, assetUrl: url(`checklists/${GONE}/${id}.png`) }], ...PAD,
    }]);
  }
  for (const id of ids('mine')) docs.push([`events/${id}`, { ownerId: GONE, groupId: G_MEMBER, title: id, imageUrl: url(`events/${GONE}/${id}.png`), ...PAD }]);
  for (const id of ids('left')) docs.push([`events/${id}`, { ownerId: GONE, groupId: G_LEFT, title: id, imageUrl: url(`events/${GONE}/${id}.png`), ...PAD }]);
  for (const id of ids('personal')) docs.push([`events/${id}`, { ownerId: GONE, groupId: null, title: id, imageUrl: url(`events/${GONE}/${id}.png`), ...PAD }]);
  for (const id of ids('alone')) docs.push([`events/${id}`, { ownerId: GONE, groupId: G_ALONE, title: id, ...PAD }]);
  docs.push(['events/secret', { ownerId: GONE, groupId: G_MEMBER, title: 'surprise', hiddenFrom: [BOB], imageUrl: url(`events/${GONE}/secret.png`), ...PAD }]);
  // The older single field only: the next one in the list takes it.
  for (const id of ids('legacy')) docs.push([`events/${id}`, { ownerId: BOB, groupId: G_MEMBER, title: id, assigneeId: GONE, assigneeIds: [BOB], ...PAD }]);
  for (const id of ids('gift')) docs.push([`assets/${id}`, { ownerId: BOB, transferredFrom: GONE, name: id, imageUrl: url(`assets/${GONE}/${id}.png`), ...PAD }]);
  for (const id of ids('card')) docs.push([`assets/${id}`, { ownerId: GONE, name: id, imageUrl: url(`assets/${GONE}/card.png`), ...PAD }]);
  // What a stranger can send anybody, with nothing in it typed by the rules.
  for (const id of ids('fr-to')) docs.push([`friend_requests/${id}`, { fromId: STRANGER, toId: GONE, status: 'pending', ...PAD }]);
  for (const id of ids('fr-mail')) docs.push([`friend_requests/${id}`, { fromId: STRANGER, toEmail: EMAIL, status: 'pending', ...PAD }]);
  for (const id of ids('fr-from')) docs.push([`friend_requests/${id}`, { fromId: GONE, toId: BOB, status: 'pending', ...PAD }]);
  for (const id of ids('gi-to')) docs.push([`group_invites/${id}`, { fromId: STRANGER, toId: GONE, toEmail: 'x@example.test', groupId: null, status: 'pending', ...PAD }]);
  for (const id of ids('gi-mail')) docs.push([`group_invites/${id}`, { fromId: STRANGER, toEmail: EMAIL, groupId: null, status: 'pending', ...PAD }]);
  for (const id of ids('gi-from')) docs.push([`group_invites/${id}`, { fromId: GONE, toEmail: 'y@example.test', groupId: G_OWNED, status: 'pending', ...PAD }]);
  for (const id of ids('chat')) docs.push([`chats/${id}`, { members: [GONE, `uid-peer-${id}`], lastMessageText: 'hi', ...PAD }]);
  for (const id of ids('link')) docs.push([`invite_links/${id}`, { groupId: G_OWNED, createdBy: GONE, createdByName: 'Gina', revoked: false, ...PAD }]);
  for (const id of ids('game')) docs.push([`games/${id}`, { createdBy: GONE, groupId: G_OWNED, ...PAD }]);
  for (const id of ids('expense')) docs.push([`expenses/${id}`, { ownerId: GONE, groupId: G_OWNED, amount: 1, ...PAD }]);
  for (const id of ids('notif')) docs.push([`notifications/${id}`, { userId: GONE, createdBy: ANA, ...PAD }]);
  for (const id of ids('deploy')) docs.push([`warlordDeploys/${id}`, { challengerUid: GONE, ...PAD }]);
  for (const id of ids('ledger')) docs.push([`aiLedger/${id}`, { uid: GONE, feature: 'digest', costUsd: 0.01, ...PAD }]);
  for (const id of ids('error')) docs.push([`errorLogs/${id}`, { uid: GONE, message: 'm', ...PAD }]);
  await writeAll(docs);
  await Promise.all([...KEPT_FILES, ...GONE_FILES].map((p) => bucket.file(p).save(Buffer.from('x'))));
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'the Storage emulator must be running').toBeTruthy();
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const index = (await import('../src/index')) as unknown as Record<string, Callable>;
  deleteMine = index.deleteMyAccount;
  deleteGroup = index.deleteGroupCascade;
  db = admin.firestore();
  bucket = admin.storage().bucket();
  expect(bucket.name.startsWith('demo-'), `bucket "${bucket.name}" is not a demo bucket`).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await bucket.deleteFiles({ force: true });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting an account', () => {
  it('reads no field it does not use, and no more than ten documents a page of fields', async () => {
    await seedAccount();
    const reads = await watchReads(() => deleteMine.run(asGone()));
    expect(reads.pads).toEqual([]);
    expect(reads.largestFieldPage).toBeLessThanOrEqual(MOST_PER_FIELD_PAGE);
    // Both kinds of page happened: the watch saw the reads it is about.
    expect(reads.fieldPages).toBeGreaterThan(0);
    expect(reads.refPages).toBeGreaterThan(0);
  });

  it('and still does all of it, past the first page of each kind', async () => {
    await seedAccount();
    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true });

    // The files: what stays still shows them; the rest of their folders goes.
    for (const p of KEPT_FILES) expect(await fileExists(p), p).toBe(true);
    for (const p of GONE_FILES) expect(await fileExists(p), p).toBe(false);
    expect(r.files).toEqual({ deleted: GONE_FILES.length, kept: KEPT_FILES.length });

    // Off other people's events: every assignee list, every older single field, every answer.
    for (const id of ids('ana')) {
      const ev = await data(`events/${id}`);
      expect(ev, id).toMatchObject({ assigneeIds: [ANA], assigneeId: ANA, rsvps: { [ANA]: 'no' } });
      expect(ev?.rsvps, id).not.toHaveProperty(GONE);
    }
    for (const id of ids('legacy')) expect(await data(`events/${id}`), id).toMatchObject({ assigneeId: BOB });

    // Their groups and their events.
    expect(await data(`groups/${G_OWNED}`)).toMatchObject({ ownerId: ANA, members: [ANA] });
    expect(await data(`groups/${G_MEMBER}`)).toMatchObject({ ownerId: BOB, members: [BOB] });
    expect(await exists(`groups/${G_ALONE}`)).toBe(false);
    for (const id of [...ids('mine'), ...ids('left')]) expect(await data(`events/${id}`), id).toMatchObject({ ownerId: BOB });
    for (const id of [...ids('personal'), ...ids('alone'), 'secret']) expect(await exists(`events/${id}`), id).toBe(false);

    // Their conversations keep their name; their links are revoked and lose it.
    for (const id of ids('chat')) expect((await data(`chats/${id}`))?.formerMembers?.[GONE]?.name, id).toBe('Gina');
    for (const id of ids('link')) expect(await data(`invite_links/${id}`), id).toMatchObject({ revoked: true, createdByName: null });

    // Everything else that was theirs, or sent to them.
    for (const id of [
      ...ids('fr-to'), ...ids('fr-mail'), ...ids('fr-from'),
    ]) expect(await exists(`friend_requests/${id}`), id).toBe(false);
    for (const id of [...ids('gi-to'), ...ids('gi-mail'), ...ids('gi-from')]) expect(await exists(`group_invites/${id}`), id).toBe(false);
    for (const [c, prefix] of [['assets', 'card'], ['games', 'game'], ['expenses', 'expense'], ['notifications', 'notif'],
      ['warlordDeploys', 'deploy'], ['errorLogs', 'error']]) {
      for (const id of ids(prefix)) expect(await exists(`${c}/${id}`), `${c}/${id}`).toBe(false);
    }
    for (const id of ids('gift')) expect(await data(`assets/${id}`), id).toMatchObject({ ownerId: BOB });
    for (const id of ids('ledger')) expect(await data(`aiLedger/${id}`), id).toMatchObject({ uid: null, costUsd: 0.01 });
    expect(r.counts).toMatchObject({
      eventsUnassigned: N, rsvpsRemoved: N, eventsHandedOver: 2 * N, eventsDeleted: N + 1, chatsMarked: N, linksRevoked: N,
      invites: 3 * N, friendRequests: 3 * N, assets: N, games: N, expenses: N, notifications: N, warlordDeploys: N,
      aiLedgerRows: N, errorLogs: N,
    });
  });
});

describe('a page of fields holds fewer documents than one of references', () => {
  // 200 pages was the bound when a page held 300. At ten a page it would have stopped a person with
  // more than 2,000 such documents at every run; the bound is in documents now, the 60,000 it was.
  it('a run still goes past 2,000 documents read with their fields', async () => {
    const MANY = 2001;
    await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
    await db.doc(`users/${GONE}`).set({ name: 'Gina', email: EMAIL });
    // The older single field only, which is drained with the list it falls back to.
    await writeAll(range(MANY).map((i) => [`events/many-${i}`, { ownerId: BOB, groupId: null, assigneeId: GONE, assigneeIds: [BOB] }]));
    expect(await deleteMine.run(asGone())).toMatchObject({ ok: true, authDeleted: true });
    expect((await db.collection('events').where('assigneeId', '==', GONE).count().get()).data().count).toBe(0);
    expect((await db.collection('events').where('assigneeId', '==', BOB).count().get()).data().count).toBe(MANY);
  }, 180_000);
});

describe('deleting a group', () => {
  const KEEP = ids('own').slice(0, 3);

  async function seedGroup() {
    const docs: Array<[string, Record<string, unknown>]> = [
      [`groups/${G_DEL}`, { name: 'Family', ownerId: ANA, members: [ANA, BOB], ...PAD }],
    ];
    for (const id of ids('own')) docs.push([`events/${id}`, { ownerId: ANA, groupId: G_DEL, title: id, sharedWithFamily: true, ...PAD }]);
    for (const id of ids('bobs')) docs.push([`events/${id}`, { ownerId: BOB, groupId: G_DEL, title: id, sharedWithFamily: true, ...PAD }]);
    for (const id of ids('glink')) docs.push([`invite_links/${id}`, { groupId: G_DEL, createdBy: ANA, revoked: false, ...PAD }]);
    docs.push(['invite_links/glink-revoked', { groupId: G_DEL, createdBy: ANA, revoked: true, ...PAD }]);
    for (const id of ids('ginv')) docs.push([`group_invites/${id}`, { fromId: ANA, toEmail: 'z@example.test', groupId: G_DEL, status: 'pending', ...PAD }]);
    await writeAll(docs);
  }
  const asAna = () => deleteGroup.run({
    data: { groupId: G_DEL, keepEventIds: KEEP }, auth: { uid: ANA, token: { uid: ANA } }, rawRequest: {},
  } as unknown as CallableRequest<unknown>);

  it('reads no field it does not use, and no more than ten documents a page of fields', async () => {
    await seedGroup();
    const reads = await watchReads(asAna);
    expect(reads.pads).toEqual([]);
    expect(reads.largestFieldPage).toBeLessThanOrEqual(MOST_PER_FIELD_PAGE);
    expect(reads.refPages).toBeGreaterThan(0);
  });

  it('and still does all of it, past the first page of each kind', async () => {
    await seedGroup();
    const r = await asAna();
    expect(r).toMatchObject({ deleted: N - KEEP.length, freed: N + KEEP.length, invites: N, links: N });
    expect(await exists(`groups/${G_DEL}`)).toBe(false);
    for (const id of ids('own')) {
      if (KEEP.includes(id)) expect(await data(`events/${id}`), id).toMatchObject({ ownerId: ANA, groupId: null, sharedWithFamily: false });
      else expect(await exists(`events/${id}`), id).toBe(false);
    }
    for (const id of ids('bobs')) expect(await data(`events/${id}`), id).toMatchObject({ ownerId: BOB, groupId: null, sharedWithFamily: false });
    for (const id of ids('glink')) expect(await data(`invite_links/${id}`), id).toMatchObject({ revoked: true });
    for (const id of ids('ginv')) expect(await exists(`group_invites/${id}`), id).toBe(false);
  });
});
