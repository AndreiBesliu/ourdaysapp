// functions/test/groupDeletionLinks.test.ts
//
// Deleting a group revokes its invite links (review of 17.10.2026).
//
// Since 4602596 the links are read ten a page and revoked with one awaited write each: one round trip
// per link, inside a callable that has the default 60 s. Any member may mint 20 links a day
// (LINK_DAILY_LIMIT) and nothing ever deletes one, so a group's links only grow. Pinned here, on the
// emulators, through the real callable:
//   1. the writes that revoke the links are batches, one per page of at most 400 links;
//   2. a run after one that stopped part way reads only the links still open, not every link again;
//   3. a run stopped part way and run again ends where one clean run ends (green at both);
//   4. a link with no `revoked` field is still revoked, and nothing outside the group is touched (red
//      without the counts' fallback).
// Red on the code of 15.10 (1 and 2).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentReference, Query, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

/** The test's own numbers: a batch holds at most 500 writes, and the fix pages by 400. */
const PER_BATCH = 400;
const N = 1000;

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let cascade: Callable;
let db: admin.firestore.Firestore;

const ANA = 'uid-ana';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
const G = 'aaaaaaaaaaaaaaaaaaa1';
const G2 = 'bbbbbbbbbbbbbbbbbbb2';
const pad = (i: number) => String(i).padStart(5, '0');

const asAna = () => cascade.run({
  data: { groupId: G, keepEventIds: [] }, auth: { uid: ANA, token: { uid: ANA } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

/** What createGroupInviteLink writes (inviteLinks.ts), the only writer of the collection. */
const link = (groupId: string | null, createdBy: string, i: number, revoked = false): Record<string, unknown> => ({
  groupId, groupName: groupId ? 'Family' : null, createdBy, createdByName: 'Bob',
  createdAt: Timestamp.fromMillis(Date.now() - i * 60_000),
  // Used or expired links keep `revoked: false`: both kinds are here.
  expiresAt: Timestamp.fromMillis(Date.now() + (i % 2 ? -1 : 1) * 86_400_000),
  maxUses: 1, uses: i % 3 ? 1 : 0, redeemedBy: i % 3 ? [`uid-x${i}`] : [], revoked,
});

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 450) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 450)) b.set(db.doc(path), d);
    await b.commit();
  }
}

/** Round trips during `call`: queries, counts, commits, and the commits that wrote an invite link. */
async function roundTrips(call: () => Promise<unknown>) {
  const out = { queries: 0, counts: 0, commits: 0, linkCommits: 0, linkWrites: 0, ms: 0 };
  const realGet = Query.prototype.get;
  // AggregateQuery is not a runtime export of firebase-admin/firestore: its prototype, from an instance.
  const aggregate = Object.getPrototypeOf(db.collection('invite_links').count()) as { get: (...a: unknown[]) => Promise<unknown> };
  const realCount = aggregate.get;
  const realCommit = WriteBatch.prototype.commit;
  const realUpdate = WriteBatch.prototype.update;
  const touchesLinks = new WeakSet<WriteBatch>();
  vi.spyOn(Query.prototype, 'get').mockImplementation(function (this: Query, ...a: unknown[]) {
    out.queries++;
    return (realGet as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
  } as never);
  vi.spyOn(aggregate, 'get').mockImplementation(function (this: unknown, ...a: unknown[]) {
    out.counts++;
    return (realCount as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
  } as never);
  // DocumentReference.update is a one-write WriteBatch underneath, so this sees both shapes.
  vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
    if (ref?.path?.startsWith('invite_links/')) { touchesLinks.add(this); out.linkWrites++; }
    return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
  } as never);
  vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(function (this: WriteBatch, ...a: unknown[]) {
    out.commits++;
    if (touchesLinks.has(this)) out.linkCommits++;
    return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
  } as never);
  const t0 = Date.now();
  let result: any;
  try { result = await call(); } finally { out.ms = Date.now() - t0; vi.restoreAllMocks(); }
  console.log(`V-LINKS ${expect.getState().currentTestName} ${JSON.stringify(out)}`);
  return { ...out, result };
}

const linksOf = async (groupId: string | null, revoked: boolean) =>
  (await db.collection('invite_links').where('groupId', '==', groupId).where('revoked', '==', revoked).count().get()).data().count;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  cascade = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteGroupCascade;
  db = admin.firestore();
  expect(admin.storage().bucket().name.startsWith('demo-')).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  await admin.storage().bucket().deleteFiles({ force: true });
  await db.doc(`groups/${G}`).set({ ownerId: ANA, members: [ANA, BOB], name: 'Family' });
  await db.doc(`groups/${G2}`).set({ ownerId: CAROL, members: [CAROL, BOB], name: 'Other' });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting a group revokes its invite links', () => {
  it(`${N} open links: one batch per page of ${PER_BATCH}, a handful of queries`, async () => {
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < N; i++) docs.push([`invite_links/open-${pad(i)}`, link(G, i % 2 ? BOB : ANA, i)]);
    for (let i = 0; i < 7; i++) docs.push([`invite_links/closed-${pad(i)}`, link(G, BOB, i, true)]);
    await writeAll(docs);

    const r = await roundTrips(asAna);
    expect(r.result).toMatchObject({ links: N });
    expect(await linksOf(G, false)).toBe(0);
    expect(await linksOf(G, true)).toBe(N + 7);
    // Every link written once, in batches.
    expect(r.linkWrites).toBe(N);
    expect(r.linkCommits).toBeLessThanOrEqual(Math.ceil(N / PER_BATCH));
    // The events' two passes, the invitations, and the links' pages: not one query per ten links.
    expect(r.queries).toBeLessThanOrEqual(Math.ceil(N / PER_BATCH) + 6);
  }, 300_000);

  it('a run after one that stopped part way reads only the links still open', async () => {
    // What a run stopped after revoking 600 of 1,000 links leaves behind.
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < N; i++) docs.push([`invite_links/l-${pad(i)}`, link(G, BOB, i, i < 600)]);
    await writeAll(docs);

    const r = await roundTrips(asAna);
    expect(r.result).toMatchObject({ links: 400 });
    expect(await linksOf(G, false)).toBe(0);
    expect(await linksOf(G, true)).toBe(N);
    expect(r.linkWrites).toBe(400);
    expect(r.linkCommits).toBeLessThanOrEqual(1);
    expect(r.queries).toBeLessThanOrEqual(Math.ceil(400 / PER_BATCH) + 6);
  }, 300_000);

  it('a run stopped while revoking links, run again, ends where one clean run ends', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < N; i++) docs.push([`invite_links/s-${pad(i)}`, link(G, BOB, i)]);
    await writeAll(docs);
    // The second write that touches a link fails: a batch at the fix, a single update at HEAD.
    const realCommit = WriteBatch.prototype.commit;
    const realUpdate = WriteBatch.prototype.update;
    const touchesLinks = new WeakSet<WriteBatch>();
    let linkCommits = 0;
    vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
      if (ref?.path?.startsWith('invite_links/')) touchesLinks.add(this);
      return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
    } as never);
    vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(function (this: WriteBatch, ...a: unknown[]) {
      if (touchesLinks.has(this) && ++linkCommits === 2) return Promise.reject(new Error('stopped'));
      return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
    } as never);
    await expect(asAna()).rejects.toThrow('stopped');
    vi.restoreAllMocks();
    const left = await linksOf(G, false);
    expect(left).toBeGreaterThan(0);
    expect((await db.doc(`groups/${G}`).get()).exists).toBe(true);

    const r = await asAna();
    expect(r).toMatchObject({ links: left });
    expect(await linksOf(G, false)).toBe(0);
    expect(await linksOf(G, true)).toBe(N);
    expect((await db.doc(`groups/${G}`).get()).exists).toBe(false);
  }, 300_000);

  it('a link with no `revoked` field is revoked too; other groups and personal links are left alone', async () => {
    const odd = link(G, BOB, 1);
    delete odd.revoked;
    await writeAll([
      ['invite_links/g-open-1', link(G, BOB, 1)],
      ['invite_links/g-open-2', link(G, ANA, 2)],
      ['invite_links/g-closed', link(G, BOB, 3, true)],
      ['invite_links/g-no-field-1', odd],
      ['invite_links/g-no-field-2', odd],
      ['invite_links/g2-open', link(G2, BOB, 4)],
      ['invite_links/personal-open', link(null, BOB, 5)],
    ]);

    const r = await roundTrips(asAna);
    expect(r.result).toMatchObject({ links: 4 });
    for (const id of ['g-open-1', 'g-open-2', 'g-closed', 'g-no-field-1', 'g-no-field-2']) {
      expect((await db.doc(`invite_links/${id}`).get()).data()?.revoked, id).toBe(true);
    }
    expect((await db.doc('invite_links/g2-open').get()).data()?.revoked).toBe(false);
    expect((await db.doc('invite_links/personal-open').get()).data()?.revoked).toBe(false);
    // Nothing else on a link changes.
    expect((await db.doc('invite_links/g-open-1').get()).data()).toMatchObject({ createdByName: 'Bob', groupId: G, uses: 1 });
  }, 120_000);
});
