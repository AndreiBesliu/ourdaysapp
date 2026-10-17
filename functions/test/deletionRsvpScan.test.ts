// functions/test/deletionRsvpScan.test.ts
//
// Step 2 of an account deletion takes the person off the RSVP answers of their groups' events. Until
// this test it read EVERY event of every group the person is in, ten a page, on every attempt — even
// when the person had answered none. A co-member can write any number of small events into a shared
// group (the rules type each event, they do not count them, and there is no rate limit), so that scan's
// round trips were in another member's hands: enough small events pushed the victim's own deletion past
// its 540 s timeout at every attempt, from Settings and from Admin. Pinned here: the RSVP pass reads
// only the events that carry the person's own answer.
//
// RED on the snapshot (reads all N+1 events of the group); GREEN with the step-2 query fix.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { Query } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

const N = 120;          // events a co-member wrote into the shared group
const ANSWERED = 3;     // of them, the ones the victim actually answered

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let deleteMine: Callable;
let db: admin.firestore.Firestore;

const VICTIM = 'uid-victim';
const ATTACKER = 'uid-attacker';
const GROUP = 'ggggggggggggggggggg1';
const nowS = () => Math.floor(Date.now() / 1000);
const asVictim = () => ({ data: {}, auth: { uid: VICTIM, token: { uid: VICTIM, auth_time: nowS() } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  const w = db.bulkWriter();
  for (const [p, d] of docs) void w.set(db.doc(p), d);
  await w.close();
}

/**
 * Distinct `events/` docs read by pages whose projection carries NO `ownerId`. The keep scan (step 1)
 * projects `ownerId`; the RSVP pass projects only `rsvps.<uid>`. The victim owns no events and is
 * assigned to none, so the own-events drain and the assignee drains read no events — the no-ownerId
 * event reads are the RSVP pass alone.
 */
async function rsvpPassReads(call: () => Promise<unknown>) {
  const realGet = Query.prototype.get;
  const noOwner = new Set<string>();
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...a: unknown[]) {
    const snap = await (realGet as (...x: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, a);
    const ev = snap.docs.filter((d) => d.ref.path.startsWith('events/'));
    if (ev.length && !ev.some((d) => Object.prototype.hasOwnProperty.call(d.data() || {}, 'ownerId'))) {
      for (const d of ev) noOwner.add(d.id);
    }
    return snap;
  } as never);
  try { await call(); } finally { vi.restoreAllMocks(); }
  return noOwner;
}

beforeAll(async () => {
  expect(FS, 'run through the runner (emulators)').not.toBe('');
  expect(AUTH).not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  deleteMine = ((await import('../src/index')) as unknown as Record<string, Callable>).deleteMyAccount;
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('account deletion: the RSVP pass', () => {
  it(`reads only the events the person answered, not all ${N} of the group`, async () => {
    await admin.auth().createUser({ uid: VICTIM, email: 'v@example.test', emailVerified: true });
    const docs: Array<[string, Record<string, unknown>]> = [
      [`users/${VICTIM}`, { name: 'Vic' }],
      [`profiles/${VICTIM}`, { name: 'Vic' }],
      [`groups/${GROUP}`, { name: 'Family', ownerId: ATTACKER, members: [ATTACKER, VICTIM] }],
    ];
    for (let i = 0; i < N; i++) {
      const answered = i < ANSWERED;
      docs.push([`events/ev-${String(i).padStart(4, '0')}`, {
        ownerId: ATTACKER, groupId: GROUP, title: `n${i}`, date: '2026-10-16T00:00:00.000Z',
        ...(answered ? { rsvps: { [VICTIM]: 'yes', [ATTACKER]: 'no' } } : {}),
      }]);
    }
    await writeAll(docs);

    const read = await rsvpPassReads(() => deleteMine.run(asVictim()));

    // Every answer of the victim's was actually removed (correctness holds).
    const leftWithAnswer = (await db.collection('events').where('groupId', '==', GROUP)
      .where(new admin.firestore.FieldPath('rsvps', VICTIM), 'in', ['yes', 'maybe', 'no']).get()).size;
    expect(leftWithAnswer).toBe(0);

    // The RSVP pass read only the answered events — bounded by the victim's own answers, not by N.
    // RED on the snapshot: it reads all N+1 (N here; no victim-owned event). GREEN with the fix: ANSWERED.
    expect(read.size).toBeLessThanOrEqual(ANSWERED + 1);
  }, 300_000);
});
