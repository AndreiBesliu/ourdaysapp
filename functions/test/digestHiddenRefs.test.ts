// functions/test/digestHiddenRefs.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// digestHiddenRefs.test.ts (mutation testing of 14d2d7d, m-digest)
//
// Two promises of the read of references (functions/src/digestRead.ts) that no test held:
//   7. it asks which of THIS GROUP's events hide from the caller: another group's events hiding from her
//      take nothing of its cap (killed mutant R12: the query on the whole `events` collection);
//   8. its cap is DIGEST_HIDDEN_SCAN, 5000, the test's own number: exactly that many is the whole of it,
//      one more holds back what does not name her and says the digest is cut (killed mutants E04, 5000 ->
//      500, and E05, 5000 -> 50000).
// Written to live in functions/test (imports as from there); run through emu-run.mjs.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';
import { digestEventLines, digestWindow } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const G = 'g-digest';
const OTHER = 'g-other';
/** The test's own number, not the code's: a cap changed in the code must turn this red. */
const HIDDEN_SCAN = 5000;
const DAY_MS = 86_400_000;
const dayFrom = (n: number) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;
let db: admin.firestore.Firestore;

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  db = admin.firestore();
});

beforeEach(async () => {
  // The test computes days itself, the code reads its own clock: not across the day's edge.
  await awayFromEdge(0);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

describe('the read of what hides from the caller', () => {
  it('7. asks only this group\'s events: another group\'s, hiding from the caller, take nothing of its cap', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [
      [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB] }],
      [`groups/${OTHER}`, { name: 'Other', ownerId: BOB, members: [ALICE, BOB] }],
      ['events/open', { ownerId: BOB, groupId: G, title: 'Open', date: at(dayFrom(1)) }],
      ['events/hid', { ownerId: BOB, groupId: G, title: 'Hidden', date: at(dayFrom(2)), hiddenFrom: [ALICE] }],
    ];
    // Another group's events, hiding from Alice as well: more of them than the cap below.
    for (let i = 0; i < 3; i++) docs.push([`events/other-${i}`, { ownerId: BOB, groupId: OTHER, title: `Other ${i}`, date: at(dayFrom(3)), hiddenFrom: [ALICE] }]);
    await writeAll(docs);
    const w = digestWindow(new Date().toISOString())!;
    // Exactly this group's one: every event of the group hiding from her is known.
    const read = await readDigestEvents(db, G, w, { viewer: ALICE, hiddenScan: 1 });
    expect([...read.hidden].sort()).toEqual(['hid']);
    expect(read.truncated).toBe(false);
    expect(digestEventLines(read.docs, G, w, undefined, read.hidden).lines).toEqual([`- Open on ${dayFrom(1)}`]);
  });

  it('8. holds 5000: exactly that many is the whole of it; one more holds back what does not name her, and cuts', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [
      [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB] }],
      // Bob's, naming nobody: visible to Alice only while every event hiding from her is known.
      ['events/open', { ownerId: BOB, groupId: G, title: 'Open', date: at(dayFrom(1)) }],
    ];
    // Long past and no series: only the read of references brings these, as references.
    const hiding = (i: number): [string, Record<string, unknown>] =>
      [`events/h${String(i).padStart(5, '0')}`, { ownerId: BOB, groupId: G, title: `H${i}`, date: at(dayFrom(-400)), hiddenFrom: [ALICE] }];
    for (let i = 0; i < HIDDEN_SCAN; i++) docs.push(hiding(i));
    await writeAll(docs);
    const w = digestWindow(new Date().toISOString())!;
    const exact = await readDigestEvents(db, G, w, { viewer: ALICE });
    expect(exact.truncated, 'exactly the cap').toBe(false);
    expect([...exact.hidden]).toEqual([]);
    expect(digestEventLines(exact.docs, G, w, undefined, exact.hidden).lines).toEqual([`- Open on ${dayFrom(1)}`]);
    await writeAll([hiding(HIDDEN_SCAN)]);
    const past = await readDigestEvents(db, G, w, { viewer: ALICE });
    expect(past.truncated, 'one past the cap').toBe(true);
    expect([...past.hidden]).toEqual(['open']);
    expect(digestEventLines(past.docs, G, w, undefined, past.hidden).lines).toEqual([]);
  }, 180_000);
});
