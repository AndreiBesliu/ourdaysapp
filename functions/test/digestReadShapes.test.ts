// functions/test/digestReadShapes.test.ts
//
// What the digest's reads must keep doing, each held by one case that a plausible change of
// functions/src/digestRead.ts turns red (review of 17.10.2026: each of these survived the earlier tests).
// No callable and no model: only the reader (readDigestEvents) and the pure selection, so no network.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Query } from 'firebase-admin/firestore';
import { digestEventLines, digestWindow } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';
import { watchReads } from './watchReads';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const G = 'g-probe';
const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const dayFrom = (n: number) => new Date(Date.parse(`${today()}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;
let db: admin.firestore.Firestore;

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  const b = db.batch();
  for (const [p, d] of docs) b.set(db.doc(p), d);
  await b.commit();
}

/** Every events/* document any query fetched, with the keys it came with (and the rule's keys). */
async function fetchedKeys(call: () => Promise<unknown>) {
  const rows: Array<{ path: string; keys: string[]; ruleKeys: string[] }> = [];
  const realGet = Query.prototype.get;
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query, ...args: unknown[]) {
    const snap = await (realGet as (...a: unknown[]) => Promise<admin.firestore.QuerySnapshot>).apply(this, args);
    for (const d of snap.docs) {
      const data = d.data() || {};
      const rule = data.recurrenceRule;
      rows.push({ path: d.ref.path, keys: Object.keys(data).sort(), ruleKeys: rule && typeof rule === 'object' ? Object.keys(rule).sort() : [] });
    }
    return snap;
  } as never);
  try { await call(); } finally { vi.restoreAllMocks(); }
  return rows.filter((r) => r.path.startsWith('events/'));
}

beforeAll(async () => {
  expect(HOST).not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  await import('../src/index');
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('the digest reads what it is about, and only that', () => {
  it('a group event dated after the window is not read, and so cuts nothing', async () => {
    // Three of the group's events a month ahead, none in the window: with the window's upper bound they
    // are not read; without it they fill a cap of two and the digest says it is cut.
    await writeAll(['f1', 'f2', 'f3'].map((id) => [`events/${id}`, { ownerId: 'uid-a', groupId: G, title: id, date: at(dayFrom(30)) }]));
    const w = digestWindow(new Date().toISOString())!;
    const read = await readDigestEvents(db, G, w, { eventScan: 2, recurringScan: 2, page: 2 });
    expect(read.truncated).toBe(false);
    expect(read.docs.map((d) => d.id)).toEqual([]);
  });

  it('an occurrence deleted from a series of the group does not come back in the digest', async () => {
    // Weekly, begun ten weeks before a day of the window; that day's occurrence was deleted.
    const target = dayFrom(2);
    const start = new Date(Date.parse(at(target)) - 70 * DAY_MS).toISOString().slice(0, 10);
    await writeAll([[`events/weekly`, {
      ownerId: 'uid-a', groupId: G, title: 'Weekly', date: at(start), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [target],
    }]]);
    const w = digestWindow(new Date().toISOString())!;
    const read = await readDigestEvents(db, G, w);
    const lines = digestEventLines(read.docs, G, w).lines;
    expect(lines).not.toContain(`- Weekly on ${target}`);
    // Not vacuous: the series itself was read and is in the window on its other days, if any.
    expect(read.docs.map((d) => d.id)).toEqual(['weekly']);
  });

  it('every event is fetched with the digest fields only, and of its rule only two parts', async () => {
    const pad = 'x'.repeat(64);
    await writeAll([
      ['events/in-window', { ownerId: 'uid-a', groupId: G, title: 'Soon', date: at(dayFrom(1)), checklistItems: [{ id: 'c', text: pad }], description: pad, hiddenFrom: ['u'], imageUrl: pad, assigneeIds: ['uid-a'] }],
      ['events/series', { ownerId: 'uid-a', groupId: G, title: 'Series', date: '2022-01-04T00:00:00.000Z', recurrenceRule: { frequency: 'weekly', pad }, assigneeIds: ['uid-a'] }],
    ]);
    const w = digestWindow(new Date().toISOString())!;
    const rows = await fetchedKeys(() => readDigestEvents(db, G, w));
    // The fields the lines are made from, and those that say who may see the event (never hiddenFrom).
    const allowed = ['date', 'recurrenceRule', 'recurrenceExceptions', 'overrideOfParent', 'overrideDate', 'ownerId', 'groupId', 'endDayOffset', 'title',
      'assigneeIds', 'assigneeId', 'inviteeId', 'inviteStatus'];
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.keys.filter((k) => !allowed.includes(k)), r.path).toEqual([]);
      expect(r.ruleKeys.filter((k) => !['frequency', 'onlyOn'].includes(k)), r.path).toEqual([]);
    }
  });

  it('a monthly series of the group, begun months ago, reaches the digest', async () => {
    // A day of the window whose day of the month every month has, and the series begun two months before it.
    let target = '';
    for (let n = 1; n <= 7 && !target; n++) if (Number(dayFrom(n).slice(8)) <= 28) target = dayFrom(n);
    const [y, m, d] = target.split('-').map(Number);
    const startMonth = new Date(Date.UTC(y, m - 1 - 2, d)).toISOString().slice(0, 10);
    await writeAll([[`events/rent`, { ownerId: 'uid-a', groupId: G, title: 'Rent', date: at(startMonth), recurrenceRule: { frequency: 'monthly' } }]]);
    const w = digestWindow(new Date().toISOString())!;
    const read = await readDigestEvents(db, G, w);
    expect(digestEventLines(read.docs, G, w).lines).toContain(`- Rent on ${target}`);
  });
  it('a member\'s events with a rule that is no series are not read, and do not push the series out', async () => {
    // The rules let a member write any map as a group event's recurrenceRule (`d.recurrenceRule is map`).
    const b = db.batch();
    for (let i = 0; i < 3; i++) {
      b.set(db.doc(`events/junk-${i}`), { ownerId: 'uid-m', groupId: G, title: `junk-${i}`, date: '2020-01-01T00:00:00.000Z', recurrenceRule: i === 0 ? {} : { frequency: i === 1 ? 'hourly' : 'never' } });
    }
    // The group's one real series: yearly, begun four years before a day of the window.
    const target = dayFrom(2);
    b.set(db.doc('events/real'), { ownerId: 'uid-a', groupId: G, title: 'Real', date: `${Number(target.slice(0, 4)) - 4}${target.slice(4)}T00:00:00.000Z`, recurrenceRule: { frequency: 'yearly' } });
    await b.commit();
    const w = digestWindow(new Date().toISOString())!;
    let read: Awaited<ReturnType<typeof readDigestEvents>> | null = null;
    const reads = await watchReads(async () => { read = await readDigestEvents(db, G, w, { recurringScan: 1, page: 2 }); });
    expect(reads.paths.filter((p) => p.startsWith('events/junk'))).toEqual([]);
    expect(read!.truncated).toBe(false);
    expect(digestEventLines(read!.docs, G, w).lines).toEqual([`- Real on ${target}`]);
  });
});
