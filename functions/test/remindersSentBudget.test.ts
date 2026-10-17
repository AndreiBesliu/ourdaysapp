// functions/test/remindersSentBudget.test.ts
//
// Written by the review of 17.10.2026.
//
// A reminder is due in three runs, five minutes apart. Once one of them has sent it, the other two
// must not spend their send time on it, nor count it as lost when that time runs out. Run against the
// emulators through `npm run test:rules`, through the real `remindDue`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-sb-alice';
const MALLORY = 'uid-sb-mallory';
const MIN = 60_000;

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');
type Counts = ReturnType<typeof import('../src/reminders')['emptyCounts']>;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
/** A timed event whose "at the time" reminder lands at `atMs` (a whole minute). */
const eventAt = (owner: string, atMs: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
  timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
});
const rowOf = (id: string, atMs: number) => db.doc(`reminder_log/${id}__${dayOf(atMs)}`);
const stateOf = async (id: string, atMs: number) => (await rowOf(id, atMs).get()).data()?.state as string | undefined;
const bellsFor = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).size;
/** A clock that moves one tick a look: the send budget is then a number of claims. */
const ticking = () => { let t = 0; return () => t++; };
/** Every due reminder ends in exactly one of these. */
const accounted = (c: Counts) => c.sent + c.dupes + c.failed + c.deferred + c.dropped;
const pick = (c: Counts) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed, deferred: c.deferred, dropped: c.dropped, retried: c.retried });
const show = (label: string, v: unknown) => console.log(`PROBE_SB ${label} ${JSON.stringify(v)}`);

async function seed(docs: Record<string, Record<string, unknown>>) {
  const entries = Object.entries(docs);
  for (let i = 0; i < entries.length; i += 450) {
    const b = db.batch();
    for (const [id, data] of entries.slice(i, i + 450)) b.set(db.doc(`events/${id}`), data);
    await b.commit();
  }
}
const many = (prefix: string, n: number, make: (i: number) => Record<string, unknown>) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(3, '0')}`, make(i)]));

type Req = {
  writes?: Array<{ update?: { name?: string }; delete?: string }>;
  transaction?: unknown; newTransaction?: unknown; documents?: string[];
};
/** Every request the SDK sends, by kind: spied at `request`/`requestStream`, where all of them go. */
function watchRpcs(): Record<string, number> {
  const seen: Record<string, number> = {};
  const add = (k: string) => { seen[k] = (seen[k] ?? 0) + 1; };
  const onLog = (names: string[]) => names.some((n) => n.includes('/reminder_log/'));
  const kind = (method: string, req: Req): string => {
    if (method === 'commit') {
      const names = (req.writes ?? []).map((w) => String(w.update?.name ?? w.delete ?? ''));
      if (req.transaction) return names.length === 0 ? 'commit, transaction, no writes' : `commit, transaction, ${onLog(names) ? 'reminder_log' : 'other'}`;
      return `commit, ${onLog(names) ? 'reminder_log' : 'other'}`;
    }
    if (method === 'batchGetDocuments') {
      const where = onLog(req.documents ?? []) ? 'reminder_log' : 'other';
      return req.transaction || req.newTransaction ? `batchGet, transaction, ${where}` : `batchGet, ${where}`;
    }
    return method;
  };
  const target = db as unknown as Record<string, (...a: unknown[]) => unknown>;
  const realRequest = target.request.bind(db);
  const realStream = target.requestStream.bind(db);
  vi.spyOn(target, 'request').mockImplementation(((method: string, req: Req, ...rest: unknown[]) => {
    add(kind(method, req));
    return realRequest(method, req, ...rest);
  }) as never);
  vi.spyOn(target, 'requestStream').mockImplementation(((method: string, bidi: unknown, req: Req, ...rest: unknown[]) => {
    add(kind(method, req));
    return realStream(method, bidi, req, ...rest);
  }) as never);
  return seen;
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => vi.restoreAllMocks());

describe('a reminder an earlier run already sent', () => {
  it('is neither dropped nor deferred when the send time runs out, and the run stays green', async () => {
    const T = Date.now();
    const last = minute(T - 11 * MIN); // the run at T sees it for the last time
    const soon = minute(T - 6 * MIN); // the run at T sees it, and the next one will too
    await seed({ late: eventAt(ALICE, last), soon: eventAt(ALICE, soon), old: eventAt(ALICE, last) });
    // 'old' was delivered by the code before 13.10 (still the live code until the deploy): no state.
    await rowOf('old', last).set({ eventId: 'old', day: dayOf(last), at: last, sentAt: admin.firestore.Timestamp.fromMillis(T - 9 * MIN) });
    const before = mod.emptyCounts();
    await mod.remindDue(db, T - 5 * MIN, before);
    expect(before).toMatchObject({ due: 3, sent: 2, dupes: 1 });

    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
    const out = mod.emptyCounts();
    await mod.remindDue(db, T, out, { sendBudgetMs: 0 });
    vi.restoreAllMocks();
    show('A', { before: pick(before), out: pick(out), outcome: mod.reminderOutcome(out), errors });
    expect(accounted(out)).toBe(out.due);
    expect(out).toMatchObject({ due: 3, sent: 0, dupes: 3, deferred: 0, dropped: 0, failed: 0 });
    expect(mod.reminderOutcome(out).failed).toBe(0);
    expect(errors.filter((e) => e.includes('out of time'))).toEqual([]);
    expect(await bellsFor(ALICE)).toBe(2);
  }, 120_000);

  it('does not use the send time of one not sent yet, which would then be lost', async () => {
    const T = Date.now();
    const at = minute(T - 11 * MIN);
    await seed(many('m', 4, () => eventAt(MALLORY, at)));
    // The run before: fresh there, time for two claims. m000 and m001 go out, m002 and m003 wait.
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T - 5 * MIN, r1, { clock: ticking(), sendBudgetMs: 3 });
    expect(r1).toMatchObject({ due: 4, sent: 2, deferred: 2, dropped: 0 });
    // Their last run, with the same time.
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T, r2, { clock: ticking(), sendBudgetMs: 3 });
    const r3 = mod.emptyCounts();
    await mod.remindDue(db, T + 5 * MIN, r3);
    const states = await Promise.all(['m000', 'm001', 'm002', 'm003'].map((id) => stateOf(id, at)));
    show('B', { r1: pick(r1), r2: pick(r2), r2outcome: mod.reminderOutcome(r2), r3due: r3.due, states, bells: await bellsFor(MALLORY) });
    expect(r3.due).toBe(0); // no later run sees them
    expect(accounted(r2)).toBe(r2.due);
    expect(r2).toMatchObject({ due: 4, sent: 2, dupes: 2, dropped: 0 });
    expect(states).toEqual(['sent', 'sent', 'sent', 'sent']);
    expect(await bellsFor(MALLORY)).toBe(4);
  }, 120_000);

  it('costs one read per hundred, and no write and no transaction', async () => {
    const T = Date.now();
    const at = minute(T - 6 * MIN);
    await seed(many('a', 5, () => eventAt(ALICE, at)));
    const before = mod.emptyCounts();
    await mod.remindDue(db, T - 5 * MIN, before);
    expect(before).toMatchObject({ due: 5, sent: 5 });

    const seen = watchRpcs();
    const tx = vi.spyOn(db, 'runTransaction');
    const out = mod.emptyCounts();
    await mod.remindDue(db, T, out);
    const transactions = tx.mock.calls.length;
    vi.restoreAllMocks();
    show('C', { out: pick(out), transactions, rpcs: seen });
    expect(out).toMatchObject({ due: 5, sent: 0, dupes: 5, failed: 0 });
    expect(transactions).toBe(0);
    expect(seen['commit, reminder_log'] ?? 0).toBe(0);
    expect(seen['batchGet, transaction, reminder_log'] ?? 0).toBe(0);
    expect(seen['batchGet, reminder_log'] ?? 0).toBe(1);
  }, 120_000);

  it('past the first hundred, the one not sent is the one kept, in chunks of at most a hundred', async () => {
    const T = Date.now();
    const at = minute(T - 11 * MIN);
    await seed(many('m', 102, () => eventAt(MALLORY, at)));
    // The run before: time for 101 claims, so m101 waits.
    const r1 = mod.emptyCounts();
    await mod.remindDue(db, T - 5 * MIN, r1, { clock: ticking(), sendBudgetMs: 102 });
    expect(r1).toMatchObject({ due: 102, sent: 101, deferred: 1 });
    expect(await stateOf('m101', at)).toBeUndefined();
    // The last run: time for one claim.
    const sizes: number[] = [];
    const realGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation(((...args: unknown[]) => {
      const onLog = args.filter((a) => (a as { path?: unknown })?.path && String((a as { path: string }).path).startsWith('reminder_log/'));
      if (onLog.length) sizes.push(onLog.length);
      return (realGetAll as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const r2 = mod.emptyCounts();
    await mod.remindDue(db, T, r2, { clock: ticking(), sendBudgetMs: 2 });
    vi.restoreAllMocks();
    show('D', { r1: pick(r1), r2: pick(r2), getAllSizes: sizes, m101: await stateOf('m101', at), bells: await bellsFor(MALLORY) });
    expect(accounted(r2)).toBe(r2.due);
    expect(r2).toMatchObject({ due: 102, sent: 1, dupes: 101, dropped: 0 });
    expect(await stateOf('m101', at)).toBe('sent');
    expect(await bellsFor(MALLORY)).toBe(102);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  }, 180_000);
});

describe('what has not been delivered stays as it was (guards: green before and after)', () => {
  it('a claim left "sending" by a run that died is counted lost when the time runs out', async () => {
    const T = Date.now();
    const last = minute(T - 11 * MIN);
    await seed({ stuck: eventAt(ALICE, last) });
    await rowOf('stuck', last).set({ eventId: 'stuck', day: dayOf(last), at: last, state: 'sending', claimedAt: admin.firestore.Timestamp.fromMillis(T - 10 * MIN) });
    const out = mod.emptyCounts();
    await mod.remindDue(db, T, out, { sendBudgetMs: 0 });
    show('E', { out: pick(out) });
    expect(out).toMatchObject({ due: 1, dropped: 1, dupes: 0, sent: 0 });
    expect(mod.reminderOutcome(out).failed).toBe(1);
    // With the time, it is taken over and sent.
    const again = mod.emptyCounts();
    await mod.remindDue(db, T, again);
    expect(again).toMatchObject({ sent: 1, retried: 1 });
  }, 120_000);

  it('a read of the rows that fails costs only its price: each reminder is claimed, as before', async () => {
    const T = Date.now();
    const at = minute(T - 6 * MIN);
    await seed({ sent: eventAt(ALICE, at) });
    await mod.remindDue(db, T - 5 * MIN, mod.emptyCounts());
    await seed({ fresh: eventAt(ALICE, at) });
    const realGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation(((...args: unknown[]) => {
      if (args.some((a) => String((a as { path?: unknown })?.path ?? '').startsWith('reminder_log/'))) {
        return Promise.reject(Object.assign(new Error('14 UNAVAILABLE: injected'), { code: 14 }));
      }
      return (realGetAll as (...a: unknown[]) => unknown)(...args);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = mod.emptyCounts();
    await mod.remindDue(db, T, out);
    vi.restoreAllMocks();
    show('F', { out: pick(out) });
    expect(out).toMatchObject({ due: 2, sent: 1, dupes: 1, failed: 0 });
    expect(await stateOf('fresh', at)).toBe('sent');
    expect(await bellsFor(ALICE)).toBe(2);
  }, 120_000);
});
