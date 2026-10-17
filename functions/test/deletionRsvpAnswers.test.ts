// functions/test/deletionRsvpAnswers.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// k-rsvp.test.ts (mutation killers, label m-deletion, commit 5f8f0c2)
//
// Step 2 of an account deletion reads the person's answers by the answer (rsvps.<uid> in RSVP_ANSWERS,
// 17.10.2026). Every answer the rules let them write goes: yes, maybe AND no. The other tests only ever
// seed "yes" and "maybe"; a list that lost "no" would leave the person's "no" on every event, counted as
// an answer from somebody who no longer exists. Pinned here through the real callable.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let deleteMine: Callable;
let db: admin.firestore.Firestore;

const GONE = 'uid-gone';
const ANA = 'uid-ana';
const G = 'aaaaaaaaaaaaaaaaaaa1';
const nowS = () => Math.floor(Date.now() / 1000);
const asGone = () => ({ data: {}, auth: { uid: GONE, token: { uid: GONE, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator must be running').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  deleteMine = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteMyAccount;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('account deletion: every answer of theirs goes', () => {
  it('yes, maybe and no, in their group; the others\' answers stay', async () => {
    await admin.auth().createUser({ uid: GONE, email: 'gone@example.test', emailVerified: true });
    await admin.auth().createUser({ uid: ANA });
    const b = db.batch();
    b.set(db.doc(`users/${GONE}`), { name: 'Gina' });
    b.set(db.doc(`groups/${G}`), { name: 'Family', ownerId: ANA, members: [ANA, GONE] });
    b.set(db.doc('events/ev-yes'), { ownerId: ANA, groupId: G, title: 'a', rsvps: { [GONE]: 'yes', [ANA]: 'no' } });
    b.set(db.doc('events/ev-maybe'), { ownerId: ANA, groupId: G, title: 'b', rsvps: { [GONE]: 'maybe' } });
    b.set(db.doc('events/ev-no'), { ownerId: ANA, groupId: G, title: 'c', rsvps: { [GONE]: 'no', [ANA]: 'yes' } });
    await b.commit();

    const r = await deleteMine.run(asGone());
    expect(r).toMatchObject({ ok: true, authDeleted: true, counts: { rsvpsRemoved: 3 } });
    for (const id of ['ev-yes', 'ev-maybe', 'ev-no']) {
      expect((await db.doc(`events/${id}`).get()).data()?.rsvps ?? {}, id).not.toHaveProperty(GONE);
    }
    expect((await db.doc('events/ev-yes').get()).data()?.rsvps).toEqual({ [ANA]: 'no' });
    expect((await db.doc('events/ev-no').get()).data()?.rsvps).toEqual({ [ANA]: 'yes' });
  }, 60_000);
});
