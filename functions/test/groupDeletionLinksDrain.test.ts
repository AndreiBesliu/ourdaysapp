// functions/test/groupDeletionLinksDrain.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// k-grouplinks.test.ts (mutation killers, label m-deletion, commit 5f8f0c2)
//
// Deleting a group drains its open links (`revoked == false`), a batch a page (17.10.2026). The drain
// relies on every write taking the link out of the query; a write that silently does nothing would turn
// it into a spin, and the bound (200 pages, the events' one) turns that into "try again" BEFORE the group
// goes. Pinned here through the real callable, with the link writes dropped.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { DocumentReference, Query, WriteBatch } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let cascade: Callable;
let db: admin.firestore.Firestore;

const ANA = 'uid-ana';
const BOB = 'uid-bob';
const G = 'aaaaaaaaaaaaaaaaaaa1';
/** The test's own ceiling: well past the code's 200 pages, short of a hang. */
const SPIN = 400;

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
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting a group whose link writes silently do nothing', () => {
  it('stops with "try again" after its bound, before the group goes, instead of spinning', async () => {
    await db.doc('invite_links/open-1').set({ groupId: G, createdBy: BOB, createdByName: 'Bob', revoked: false, uses: 0, maxUses: 1 });

    const realUpdate = WriteBatch.prototype.update;
    const realCommit = WriteBatch.prototype.commit;
    const realGet = Query.prototype.get;
    const touchesLinks = new WeakSet<WriteBatch>();
    let linkPages = 0;
    vi.spyOn(WriteBatch.prototype, 'update').mockImplementation(function (this: WriteBatch, ref: DocumentReference, ...a: unknown[]) {
      if (ref?.path?.startsWith('invite_links/')) touchesLinks.add(this);
      return (realUpdate as (...x: unknown[]) => WriteBatch).apply(this, [ref, ...a]) as never;
    } as never);
    // The write that revokes a link "succeeds" without writing anything.
    vi.spyOn(WriteBatch.prototype, 'commit').mockImplementation(function (this: WriteBatch, ...a: unknown[]) {
      if (touchesLinks.has(this)) return Promise.resolve([]) as never;
      return (realCommit as (...x: unknown[]) => Promise<unknown>).apply(this, a) as never;
    } as never);
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...a: unknown[]) {
      const snap = await (realGet as (...x: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, a);
      if (snap.docs.some((d) => d.ref.path.startsWith('invite_links/')) && ++linkPages > SPIN) {
        throw new Error(`spin: ${linkPages} pages of the same open link`);
      }
      return snap;
    } as never);

    await expect(cascade.run({
      data: { groupId: G, keepEventIds: [] }, auth: { uid: ANA, token: { uid: ANA } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>)).rejects.toMatchObject({ code: 'deadline-exceeded' });
    vi.restoreAllMocks();
    console.log(`K-SPIN ${JSON.stringify({ linkPages })}`);
    expect(linkPages).toBeLessThanOrEqual(SPIN);
    // The group is still there, so the owner can try again.
    expect((await db.doc(`groups/${G}`).get()).exists).toBe(true);
  }, 120_000);
});
