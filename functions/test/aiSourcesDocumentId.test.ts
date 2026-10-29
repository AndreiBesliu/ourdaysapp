// functions/test/aiSourcesDocumentId.test.ts
//
// The assistant's event sources carry each event under its DOCUMENT's id (29.10.2026). They built
// `{ id: doc.id, ...data }`, so a stored field named `id` replaced it: the item said it was another
// event, and the expansion, which orders a day's events by that id (18.10.2026), ordered them by a
// value any member can write. Measured on live that day: no event has the field. The scan that keeps
// the order everywhere is src/utils/documentIdFirst.test.ts; this is the behaviour behind it.

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import { fetchEvents } from '../src/aiSources';
import { deriveScope } from '../src/aiScope';
import { dayRangePeriod } from '../src/period';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-alice';
const G = 'g-family';

let db: admin.firestore.Firestore;

beforeAll(() => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
});

describe('an event the assistant reads is the document it came from', () => {
  it('a stored `id` field changes neither its id nor its place in the day', async () => {
    const day = (d: string) => `${d}T00:00:00.000Z`;
    const b = db.batch();
    b.set(db.doc(`groups/${G}`), { name: 'Family', ownerId: ALICE, members: [ALICE] });
    // Each claims another id: `evt-b` the id of `evt-a`, `evt-a` one that sorts after everything.
    b.set(db.doc('events/evt-b'), { ownerId: ALICE, groupId: G, title: 'B', date: day('2026-10-20'), id: 'evt-a' });
    b.set(db.doc('events/evt-a'), { ownerId: ALICE, groupId: G, title: 'A', date: day('2026-10-20'), id: 'zzz' });
    // A weekly series whose occurrence that day is a virtual item, named from the series' id.
    b.set(db.doc('events/evt-s'), {
      ownerId: ALICE, groupId: G, title: 'S', date: day('2026-10-13'), recurrenceRule: { frequency: 'weekly' }, id: 'other',
    });
    await b.commit();

    const scope = await deriveScope(ALICE);
    const period = dayRangePeriod('2026-10-20', '2026-10-20')!;
    const r = await fetchEvents(scope, period, 200);

    expect(r.complete).toBe(true);
    expect(r.items.map((i) => [i.id, i.title])).toEqual([
      ['evt-a', 'A'],
      ['evt-b', 'B'],
      ['evt-s_2026-10-20', 'S'],
    ]);
  });
});
