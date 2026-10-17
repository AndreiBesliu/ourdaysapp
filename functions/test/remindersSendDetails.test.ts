// functions/test/remindersSendDetails.test.ts
//
// Written by the review of 17.10.2026.
// Through the real remindDue on the Firestore emulator. FCM is replaced by a recorder for the whole of each test
// (it is not emulated), and a net refuses every non-local host on http2/http/https/fetch, so nothing can leave
// the machine even if the recorder were lost.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
// The Admin SDK's first Firestore call makes google-auth-library ping the GCE metadata server
// (gcp-metadata isAvailable(): 169.254.169.254, metadata.google.internal), in every emulator test of the
// project. Read at call time; "none" skips the ping. Nothing under test depends on it.
process.env.METADATA_SERVER_DETECTION = 'none';
const ALICE = 'uid-vsm-alice';
const MALLORY = 'uid-vsm-mallory';
const MIN = 60_000;

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
/** A timed event starting at `startMs` (a whole minute), reminded `lead` minutes before. */
const eventStarting = (owner: string, startMs: number, lead: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(startMs)}T00:00:00.000Z`, time: clockOf(startMs),
  timezone: 'UTC', reminderMinutes: lead, assigneeIds: [owner],
});
const rowOf = (id: string, startMs: number) => db.doc(`reminder_log/${id}__${dayOf(startMs)}`);
const bellsFor = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).size;
const ticking = () => { let t = 0; return () => t++; };
const show = (label: string, v: unknown) => console.log(`VPROBE ${label} ${JSON.stringify(v)}`);
const pick = (c: Record<string, number>) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed, deferred: c.deferred, dropped: c.dropped, retried: c.retried });
async function seed(docs: Record<string, Record<string, unknown>>) {
  const b = db.batch();
  for (const [id, data] of Object.entries(docs)) b.set(db.doc(`events/${id}`), data);
  await b.commit();
}

// ── the net ──────────────────────────────────────────────────────────────────────────────────────
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const refused: string[] = [];
const REAL_FETCH = globalThis.fetch;
function hostOf(a: unknown): string {
  try {
    if (typeof a === 'string') return new URL(a).hostname;
    if (a instanceof URL) return a.hostname;
    const o = a as { hostname?: unknown; host?: unknown; url?: unknown } | null;
    if (o && typeof o.url === 'string') return new URL(o.url).hostname;
    return String(o?.hostname ?? o?.host ?? '').replace(/:\d+$/, '');
  } catch { return '?'; }
}
function guard(h: string) {
  if (h !== '' && !LOCAL.has(h)) { refused.push(h); throw new Error(`net: refused ${h}`); }
}
function installNet() {
  const connect = http2.connect;
  vi.spyOn(http2, 'connect').mockImplementation(((authority: unknown, ...rest: unknown[]) => {
    guard(hostOf(authority));
    return (connect as (...a: unknown[]) => unknown).call(http2, authority, ...rest);
  }) as never);
  for (const m of [http, https]) {
    for (const name of ['request', 'get'] as const) {
      const real = m[name];
      vi.spyOn(m, name).mockImplementation(((...a: unknown[]) => {
        guard(hostOf(a[0]));
        return (real as (...x: unknown[]) => unknown).apply(m, a);
      }) as never);
    }
  }
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    guard(hostOf(input));
    return REAL_FETCH(input as never, init as never);
  }) as typeof fetch;
}

// ── FCM, recorded ────────────────────────────────────────────────────────────────────────────────
let pushes: Array<{ tokens: string[]; tag?: string }>;
function recordPushes() {
  pushes = [];
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'sendEachForMulticast').mockImplementation((async (msg: { tokens: string[]; data?: Record<string, string> }) => {
    pushes.push({ tokens: [...msg.tokens], tag: msg.data?.tag });
    return { successCount: msg.tokens.length, failureCount: 0, responses: msg.tokens.map(() => ({ success: true })) };
  }) as never);
}

type Req = {
  transaction?: unknown;
  writes?: Array<{ update?: { name?: string; fields?: Record<string, { stringValue?: string }> }; currentDocument?: { exists?: boolean } }>;
};
/**
 * The first commit matching `which` is APPLIED and then answers `error` (mode "applied"), or answers `error`
 * without being applied (mode "refused"). Intercepted at Firestore.request, under which GAX retries: an error
 * thrown here is one the retry layer did not absorb. Only this spy is restored by `restore`.
 */
function onCommit(which: (req: Req) => boolean, mode: 'applied' | 'refused', error: () => Error) {
  const real = (db as unknown as { request: (...a: unknown[]) => Promise<unknown> }).request.bind(db);
  const state = { hits: 0 };
  const spy = vi.spyOn(db as never, 'request' as never).mockImplementation((async (method: string, req: Req, tag: string, codes: unknown) => {
    if (method === 'commit' && state.hits === 0 && which(req)) {
      state.hits += 1;
      if (mode === 'applied') await real(method, req, tag, codes);
      throw error();
    }
    return real(method, req, tag, codes);
  }) as never);
  return { state, restore: () => (spy as unknown as { mockRestore: () => void }).mockRestore() };
}
const writesTo = (req: Req, part: string) => (req.writes || []).some((w) => String(w.update?.name || '').includes(part));
const marksSent = (req: Req) => (req.writes || [])
  .some((w) => String(w.update?.name || '').includes('/reminder_log/') && w.update?.fields?.state?.stringValue === 'sent');
const deadline = () => Object.assign(new Error('4 DEADLINE_EXCEEDED: Deadline exceeded'), { code: 4 });

beforeAll(async () => {
  expect(HOST, 'run through test:rules').not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  refused.length = 0;
  installNet();
  recordPushes();
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = REAL_FETCH;
  expect(refused, 'something tried to leave the machine').toEqual([]);
});

// ── D ────────────────────────────────────────────────────────────────────────────────────────────
describe('sending-4 (D): "dropped" holds the slack band', () => {
  it('Dslack: counted dropped and red at T; the on-time run at T+5 delivers it', async () => {
    const T = Date.now();
    const start = minute(T) + 60 * MIN;
    await seed({ slack: eventStarting(ALICE, start, 69) }); // at = minute(T) - 9 min, in (T-10, T-8]
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1, { sendBudgetMs: 0 });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2);
    show('Dslack', { atMinusT: (start - 69 * MIN - T) / MIN, r1: pick(r1), r1red: mod.reminderOutcome(r1).failed, r2: pick(r2), bells: await bellsFor(ALICE) });
    expect(r1.dropped).toBe(1);
    expect(mod.reminderOutcome(r1).failed).toBeGreaterThan(0);
    expect(r2.sent).toBe(1);
    expect(await bellsFor(ALICE)).toBe(1);
  }, 120_000);

  it('Dlate: the same, with the next run 70 s late (inside the 2-min slack): lost, and T’s "dropped" is its only trace', async () => {
    const T = Date.now();
    const start = minute(T) + 60 * MIN;
    await seed({ slack: eventStarting(ALICE, start, 69) });
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1, { sendBudgetMs: 0 });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN + 70_000, r2);
    const r3 = mod.emptyCounts();
    await mod.remindDue(db, T + 10 * MIN, r3);
    show('Dlate', { r1: pick(r1), r1red: mod.reminderOutcome(r1).failed, r2: pick(r2), r3: pick(r3), bells: await bellsFor(ALICE) });
    expect(r1.dropped).toBe(1);
    expect(r2.due).toBe(0);
    expect(r3.due).toBe(0);
    expect(await bellsFor(ALICE)).toBe(0);
  }, 120_000);

  it('Dtwice: out of time in two runs in a row: one reminder, lost once, counted dropped twice', async () => {
    const T = Date.now();
    const start = minute(T) + 60 * MIN;
    await seed({ slack: eventStarting(ALICE, start, 69) });
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1, { sendBudgetMs: 0 });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2, { sendBudgetMs: 0 });
    const r3 = mod.emptyCounts();
    await mod.remindDue(db, T + 10 * MIN, r3);
    show('Dtwice', { r1: pick(r1), r2: pick(r2), r3: pick(r3), bells: await bellsFor(ALICE) });
    expect(r1.dropped + r2.dropped).toBe(2);
    expect(r3.due).toBe(0);
    expect(await bellsFor(ALICE)).toBe(0);
  }, 120_000);
});

// ── G ────────────────────────────────────────────────────────────────────────────────────────────
describe('sending-5 (G): oldest first inside the last-chance part', () => {
  it('Gorder: one owner; out of time after one send, the one no later run sees goes first, and both arrive', async () => {
    const T = Date.now();
    const start = minute(T) + 60 * MIN; // same start: same date, the ids decide the read's order
    await seed({
      a: eventStarting(ALICE, start, 69), // minute(T) - 9: an on-time next run still sees it
      b: eventStarting(ALICE, start, 74), // minute(T) - 14: no later run sees it
    });
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1, { clock: ticking(), sendBudgetMs: 2 }); // one claim's time
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2);
    const a = (await rowOf('a', start).get()).data()?.state ?? null;
    const b = (await rowOf('b', start).get()).data()?.state ?? null;
    show('Gorder', { r1: pick(r1), r2: pick(r2), a, b, bells: await bellsFor(ALICE) });
    expect(b).toBe('sent');
    expect(a).toBe('sent');
  }, 120_000);

  it('Gcross: two owners; the read puts Mallory’s slack-band one first, Alice’s is the one no later run sees', async () => {
    const T = Date.now();
    const start = minute(T) + 60 * MIN;
    await seed({
      aa: eventStarting(MALLORY, start, 69), // id sorts first; minute(T) - 9
      zz: eventStarting(ALICE, start, 74), // minute(T) - 14
    });
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1, { clock: ticking(), sendBudgetMs: 2 });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2);
    const aa = (await rowOf('aa', start).get()).data()?.state ?? null;
    const zz = (await rowOf('zz', start).get()).data()?.state ?? null;
    show('Gcross', { r1: pick(r1), r2: pick(r2), aa, zz, aliceBells: await bellsFor(ALICE), malloryBells: await bellsFor(MALLORY) });
    expect(zz).toBe('sent');
    expect(aa).toBe('sent');
  }, 120_000);
});

// ── E ────────────────────────────────────────────────────────────────────────────────────────────
describe('sending-6 (E): sent again after the bell batch was applied', () => {
  it('Ebell: the bell commit applied, answered DEADLINE_EXCEEDED; the next run takes over: one bell row, one push', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN); // fresh: two more runs see it
    await db.doc(`users/${ALICE}`).set({ language: 'en-US', fcmTokens: ['tok-alice'] });
    await seed({ dentist: eventStarting(ALICE, at, 0) });
    const hit = onCommit((r) => !r.transaction && writesTo(r, '/notifications/'), 'applied', deadline);
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1);
    hit.restore();
    const bellsAfterR1 = await bellsFor(ALICE);
    const pushesAfterR1 = pushes.length;
    const stateAfterR1 = (await rowOf('dentist', at).get()).data()?.state;
    // The next run, five minutes later: the claim is five minutes old.
    await rowOf('dentist', at).update({ claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * MIN) });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2);
    const bellIds = (await db.collection('notifications').where('userId', '==', ALICE).get()).docs.map((d) => d.id);
    show('Ebell', { hits: hit.state.hits, r1: pick(r1), bellsAfterR1, pushesAfterR1, stateAfterR1, r2: pick(r2), bellsEnd: bellIds.length, bellIds, pushesEnd: pushes.length, tags: pushes.map((p) => p.tag) });
    expect(hit.state.hits).toBe(1);
    expect(r1).toMatchObject({ sent: 0, failed: 1 });
    expect(pushesAfterR1).toBe(0); // the first notify threw before its push
    expect(r2).toMatchObject({ sent: 1, retried: 1 });
    expect(pushes.length).toBe(1);
    expect(bellIds.length).toBe(1);
  }, 120_000);

  it('Etwo: two recipients of one reminder keep a bell row each (the row id holds the recipient)', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    await seed({ dentist: { ...eventStarting(ALICE, at, 0), assigneeIds: [ALICE, MALLORY] } });
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1);
    show('Etwo', { r1: pick(r1), rows: r1.rows, alice: await bellsFor(ALICE), mallory: await bellsFor(MALLORY) });
    expect(r1).toMatchObject({ sent: 1, rows: 2 });
    expect(await bellsFor(ALICE)).toBe(1);
    expect(await bellsFor(MALLORY)).toBe(1);
  }, 120_000);

  it('Emark (the documented path): delivered, the mark refused; the next run sends again: one bell row, two pushes', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    await db.doc(`users/${ALICE}`).set({ language: 'en-US', fcmTokens: ['tok-alice'] });
    await seed({ dentist: eventStarting(ALICE, at, 0) });
    const hit = onCommit((r) => !r.transaction && marksSent(r), 'refused', deadline);
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T, r1);
    hit.restore();
    const stateAfterR1 = (await rowOf('dentist', at).get()).data()?.state;
    await rowOf('dentist', at).update({ claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * MIN) });
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r2);
    show('Emark', { hits: hit.state.hits, r1: pick(r1), stateAfterR1, r2: pick(r2), bellsEnd: await bellsFor(ALICE), pushesEnd: pushes.length, tags: pushes.map((p) => p.tag) });
    expect(hit.state.hits).toBe(1);
    expect(r1).toMatchObject({ sent: 1, failed: 0 });
    expect(stateAfterR1).toBe('sending');
    expect(r2).toMatchObject({ sent: 1, retried: 1 });
    expect(pushes.length).toBe(2);
    expect(await bellsFor(ALICE)).toBe(1);
  }, 120_000);
});
