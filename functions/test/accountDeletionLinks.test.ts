// functions/test/accountDeletionLinks.test.ts
//
// Deleting an account revokes the person's invite links, step 6 (review of 17.10.2026).
//
// One awaited write per link, read ten a page since 4602596 (500 a page before; the write per link is
// older). The links are the person's own, at most 20 a day. Pinned here, through the real callable:
// the writes are batches of at most 400, every link the person made ends revoked and without the
// name, and nobody else's link is touched. Red on the code of 15.10.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentReference, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';
const PER_BATCH = 400;

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let deleteMine: Callable;
let db: admin.firestore.Firestore;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const EMAIL = 'gone@example.test';
const pad = (i: number) => String(i).padStart(5, '0');
const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({
  data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

const link = (createdBy: string, i: number, revoked: boolean, createdByName: string | null): Record<string, unknown> => ({
  groupId: i % 4 ? 'aaaaaaaaaaaaaaaaaaa1' : null, groupName: i % 4 ? 'Family' : null, createdBy, createdByName,
  createdAt: Timestamp.fromMillis(Date.now() - i * 60_000), expiresAt: Timestamp.fromMillis(Date.now() - 86_400_000),
  maxUses: 1, uses: 1, redeemedBy: [`uid-x${i}`], revoked,
});

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 450) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 450)) b.set(db.doc(path), d);
    await b.commit();
  }
}

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  deleteMine = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteMyAccount;
  db = admin.firestore();
  expect(admin.storage().bucket().name.startsWith('demo-')).toBe(true);
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  await admin.storage().bucket().deleteFiles({ force: true });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting an account revokes the links the person made', () => {
  it('in batches of at most 400, every one of them, and nobody else\'s', async () => {
    await admin.auth().createUser({ uid: GONE, email: EMAIL, emailVerified: true });
    await db.doc(`users/${GONE}`).set({ name: 'Gina', email: EMAIL });
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < 700; i++) docs.push([`invite_links/open-${pad(i)}`, link(GONE, i, false, 'Gina')]);
    for (let i = 0; i < 200; i++) docs.push([`invite_links/named-${pad(i)}`, link(GONE, i, true, 'Gina')]); // withdrawn by her
    for (let i = 0; i < 100; i++) docs.push([`invite_links/done-${pad(i)}`, link(GONE, i, true, null)]); // a stopped run's
    docs.push(['invite_links/ana-open', link(ANA, 1, false, 'Ana')]);
    await writeAll(docs);

    const realCommit = WriteBatch.prototype.commit;
    const realUpdate = WriteBatch.prototype.update;
    const touchesLinks = new WeakSet<WriteBatch>();
    const out = { linkWrites: 0, linkCommits: 0 };
    vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
      if (ref?.path?.startsWith('invite_links/')) { touchesLinks.add(this); out.linkWrites++; }
      return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
    } as never);
    vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(function (this: WriteBatch, ...a: unknown[]) {
      if (touchesLinks.has(this)) out.linkCommits++;
      return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
    } as never);
    const t0 = Date.now();
    const r = await deleteMine.run(asGone());
    vi.restoreAllMocks();
    console.log(`V-LINKS account ${JSON.stringify({ ...out, ms: Date.now() - t0, linksRevoked: r?.counts?.linksRevoked })}`);

    expect(r).toMatchObject({ ok: true, authDeleted: true });
    expect(r.counts.linksRevoked).toBe(900);
    const mine = await db.collection('invite_links').where('createdBy', '==', GONE).get();
    expect(mine.size).toBe(1000);
    for (const d of mine.docs) expect(d.data(), d.id).toMatchObject({ revoked: true, createdByName: null });
    expect((await db.doc('invite_links/ana-open').get()).data()).toMatchObject({ revoked: false, createdByName: 'Ana' });
    expect(out.linkWrites).toBe(900);
    expect(out.linkCommits).toBeLessThanOrEqual(Math.ceil(900 / PER_BATCH));
  }, 300_000);
});
