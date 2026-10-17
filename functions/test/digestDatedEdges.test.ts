// functions/test/digestDatedEdges.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// digestDatedEdges.test.ts (mutation testing of 14d2d7d, m-digest)
//
// The two dated reads of functions/src/digestRead.ts take `date >= from`, and both lower bounds are edges a
// stored date can sit on exactly (firestore.rules: a date is a day, with or without its time):
//   * the split, `window.fromDay`, a bare day: an event stored as the bare day TODAY is read by the read of
//     the days asked about, and by nothing else. Moved to an instant (`${fromDay}T00:00:00.000Z`), it falls
//     between the two reads and is lost (mutant R22, which every earlier test let through);
//   * the look-back's first instant, thirty days ago at midnight UTC (the shape the web writes): an event
//     begun exactly then and still running is a line. Mutant R09 (">=" -> ">") loses it; groupDigestRead's
//     crowd-out test kills R09 only by the count (ten of its events sit on that instant), so this pins the
//     line itself.
// Written to live in functions/test (imports as from there); run through emu-run.mjs.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';
import { DIGEST_SPAN_LOOKBACK_DAYS, digestEventLines, digestWindow } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const G = 'g-probe';
const DAY_MS = 86_400_000;
const dayFrom = (n: number) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;
let db: admin.firestore.Firestore;

beforeAll(async () => {
  expect(HOST).not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  await import('../src/index');
  db = admin.firestore();
});

beforeEach(async () => {
  // The test computes days itself, the code reads its own clock: not across the day's edge.
  await awayFromEdge(0);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

describe('the edges of the dated reads', () => {
  it('an event stored as a bare day is read on either side of the split, today included', async () => {
    // `window.fromDay` is a bare day, so the split falls exactly on an event dated the bare day today: the
    // read of the days asked about takes it (>=), the look-back read does not (<), and nothing is lost.
    const w = digestWindow(new Date().toISOString())!;
    const b = db.batch();
    b.set(db.doc('events/bare-yesterday'), { ownerId: 'uid-a', groupId: G, title: 'bare-yesterday', date: dayFrom(-1), endDayOffset: 1 });
    b.set(db.doc('events/bare-today'), { ownerId: 'uid-a', groupId: G, title: 'bare-today', date: w.fromDay });
    b.set(db.doc('events/bare-last'), { ownerId: 'uid-a', groupId: G, title: 'bare-last', date: w.toDay });
    await b.commit();
    const read = await readDigestEvents(db, G, w);
    expect(read.docs.map((d) => d.id).sort()).toEqual(['bare-last', 'bare-today', 'bare-yesterday']);
    expect(read.truncated).toBe(false);
    expect(digestEventLines(read.docs, G, w).lines).toEqual([
      `- bare-yesterday on ${dayFrom(-1)}`, `- bare-today on ${w.fromDay}`, `- bare-last on ${w.toDay}`,
    ]);
  });

  it('an event begun exactly thirty days ago at midnight, and still running, is read and listed', async () => {
    const w = digestWindow(new Date().toISOString())!;
    const first = dayFrom(-DIGEST_SPAN_LOOKBACK_DAYS);
    // Not vacuous: that instant is the look-back's lower bound itself.
    expect(w.scanFrom).toBe(at(first));
    const b = db.batch();
    // A trip of 32 days begun then: it runs until tomorrow.
    b.set(db.doc('events/trip'), { ownerId: 'uid-a', groupId: G, title: 'Trip', date: at(first), endDayOffset: DIGEST_SPAN_LOOKBACK_DAYS + 1 });
    // A day earlier, outside the look-back: missed, as DIGEST_SPAN_LOOKBACK_DAYS decides (the other side of the edge).
    b.set(db.doc('events/older'), { ownerId: 'uid-a', groupId: G, title: 'Older', date: at(dayFrom(-DIGEST_SPAN_LOOKBACK_DAYS - 1)), endDayOffset: DIGEST_SPAN_LOOKBACK_DAYS + 2 });
    await b.commit();
    const read = await readDigestEvents(db, G, w);
    expect(read.docs.map((d) => d.id)).toEqual(['trip']);
    expect(read.truncated).toBe(false);
    expect(digestEventLines(read.docs, G, w).lines).toEqual([`- Trip on ${first}`]);
  });
});
