// functions/test/remindersClaimRetry.test.ts
//
// Written by the review of 17.10.2026.
//
// claim() in functions/src/reminders.ts must recognise its OWN claim when the Firestore SDK resends
// a write whose first attempt was applied and whose answer was lost.
//
// The fault is injected BELOW the SDK's retry loop, on the gRPC stub's own `commit`, which GAX calls
// once per attempt: the first matching commit reaches the emulator and is APPLIED, and its answer is
// replaced by an error, as a connection lost on the way back would. Whether that attempt is resent
// (GAX: Commit on ABORTED/RESOURCE_EXHAUSTED/UNAVAILABLE for a batch, RESOURCE_EXHAUSTED/UNAVAILABLE
// for a transaction's commit) or the whole transaction is re-run (runTransaction: ABORTED, CANCELLED,
// UNKNOWN, DEADLINE_EXCEEDED, INTERNAL, UNAVAILABLE, UNAUTHENTICATED, RESOURCE_EXHAUSTED), and what the
// emulator answers the resend, is left to the real SDK (@google-cloud/firestore 7.11.6, google-gax
// 4.6.1) and the real emulator.
//
// Red on the snapshot (C14, T13, T4: the reminder, at its last sighting, reaches nobody and the run
// is green with "already sent 1"); green with work/v-claimretry/reminders.patched.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as admin from 'firebase-admin';

const req = createRequire(import.meta.url);
const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-vcr-alice';
const MIN = 60_000;

let db: admin.firestore.Firestore;
let mod: typeof import('../src/reminders');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
/** A timed event whose "at the time" reminder lands at `atMs` (a whole minute). */
const eventAt = (owner: string, atMs: number) => ({
  ownerId: owner, groupId: null, title: 'Dentist', date: `${dayOf(atMs)}T00:00:00.000Z`, time: clockOf(atMs),
  timezone: 'UTC', reminderMinutes: 0, assigneeIds: [owner],
});
const rowOf = (id: string, atMs: number) => db.doc(`reminder_log/${id}__${dayOf(atMs)}`);
const bellsFor = async (uid: string) => (await db.collection('notifications').where('userId', '==', uid).get()).size;
const show = (label: string, v: unknown) => console.log(`PROBE ${label} ${JSON.stringify(v)}`);
const pick = (c: Record<string, number>) => ({ due: c.due, sent: c.sent, dupes: c.dupes, failed: c.failed, deferred: c.deferred, dropped: c.dropped, retried: c.retried });

type Commit = { transaction?: unknown; writes?: Array<{ update?: { name?: string }; currentDocument?: { exists?: boolean } }> };
type Cb = (err: unknown, res?: unknown) => void;
const restores: Array<() => void> = [];

/** The claim: a non-transactional commit creating a reminder_log row (precondition exists: false). */
const isClaimCreate = (r: Commit) => !r.transaction && (r.writes || [])
  .some((w) => String(w.update?.name || '').includes('/reminder_log/') && w.currentDocument?.exists === false);
/** The takeover: a transaction's commit writing a reminder_log row. */
const isTakeover = (r: Commit) => !!r.transaction && (r.writes || [])
  .some((w) => String(w.update?.name || '').includes('/reminder_log/'));

const TEXT: Record<number, string> = {
  4: 'DEADLINE_EXCEEDED: Deadline exceeded',
  13: 'INTERNAL: Internal error encountered.',
  14: 'UNAVAILABLE: Connection dropped',
};
const lostAnswer = (code: number) => {
  const { grpc } = req('google-gax');
  return Object.assign(new Error(`${code} ${TEXT[code]}`), { code, details: TEXT[code].split(': ')[1], metadata: new grpc.Metadata() });
};

/**
 * The first commit matching `which` is applied, and answered with `code` instead of its result. Every
 * resend of that very request object (what GAX's retry does) is passed through, and its answer noted.
 */
async function appliedThenLost(which: (r: Commit) => boolean, code: number) {
  const pool = (db as unknown as { _clientPool: { _activeClients: Map<Record<string, unknown>, unknown> } })._clientPool;
  const clients = [...pool._activeClients.keys()];
  expect(clients.length, 'a gRPC client already open (the seed opened it)').toBeGreaterThan(0);
  const stubs = await Promise.all(clients.map((c) => c.firestoreStub as Promise<Record<string, unknown>>));
  const log = { hits: 0, resent: [] as Array<{ code: number | null; details: string | null }> };
  let first: Commit | null = null;
  for (const stub of stubs) {
    const own = Object.prototype.hasOwnProperty.call(stub, 'commit');
    const real = stub.commit as (...a: unknown[]) => unknown;
    stub.commit = function (this: unknown, r: Commit, md: unknown, opts: unknown, cb: Cb) {
      if (log.hits === 0 && which(r)) {
        log.hits += 1;
        first = r;
        return real.call(this, r, md, opts, (err: unknown, res: unknown) => {
          if (err) { cb(err, res); return; } // a real failure: not the case modelled
          cb(lostAnswer(code));
        });
      }
      if (first !== null && r === first) {
        return real.call(this, r, md, opts, (err: { code?: number; details?: string } | null, res: unknown) => {
          log.resent.push({ code: err?.code ?? null, details: err?.details ?? null });
          cb(err, res);
        });
      }
      return real.call(this, r, md, opts, cb);
    };
    restores.push(() => { if (own) stub.commit = real; else delete stub.commit; });
  }
  return log;
}

beforeAll(async () => {
  expect(HOST, 'run through test:rules').not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  await import('../src/index');
  mod = await import('../src/reminders');
  db = admin.firestore();
});
beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});
afterEach(() => { while (restores.length) restores.pop()!(); vi.restoreAllMocks(); });

async function seed(docs: Record<string, Record<string, unknown>>) {
  const b = db.batch();
  for (const [id, data] of Object.entries(docs)) b.set(db.doc(`events/${id}`), data);
  await b.commit();
}

/**
 * A reminder at minute(T − 11 min): the run at T is the last that sees it (the next one, at T + 5 min,
 * looks back to T − 10 min). With `staleRow`, a claim left "sending" six minutes ago by a run that
 * died, so the run at T takes it over.
 */
async function lastSighting(label: string, which: (r: Commit) => boolean, code: number, staleRow: boolean) {
  const T = Date.now();
  const at = minute(T - 11 * MIN);
  await seed({ dentist: eventAt(ALICE, at) });
  if (staleRow) {
    await rowOf('dentist', at).set({ eventId: 'dentist', day: dayOf(at), at, state: 'sending', claimId: 'a-run-that-died', claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 6 * MIN) });
  }
  const log = await appliedThenLost(which, code);
  const run = mod.emptyCounts();
  await mod.remindDue(db, T, run);
  while (restores.length) restores.pop()!();
  const row = (await rowOf('dentist', at).get()).data();
  const next = mod.emptyCounts();
  await mod.remindDue(db, T + 5 * MIN, next);
  const out = {
    ...log, run: pick(run), outcome: mod.reminderOutcome(run),
    row: { state: row?.state ?? null, retries: row?.retries ?? null, claimIsNew: typeof row?.claimId === 'string' && row.claimId !== 'a-run-that-died' },
    next: pick(next), bells: await bellsFor(ALICE),
  };
  show(label, out);
  return out;
}

describe('a claim the SDK resent is still this claim', () => {
  it('C14: the create applied, its answer lost as UNAVAILABLE and resent by GAX: sent once', async () => {
    const r = await lastSighting('C14', isClaimCreate, 14, false);
    expect(r.hits).toBe(1);
    // The real SDK resent the very same request, and the emulator answered it ALREADY_EXISTS.
    expect(r.resent.map((x) => x.code)).toEqual([6]);
    expect(r.run).toMatchObject({ due: 1, sent: 1, dupes: 0, failed: 0, retried: 0 });
    expect(r.outcome.detail).toContain('already sent 0');
    expect(r.row.state).toBe('sent');
    expect(r.next.due).toBe(0);
    expect(r.bells).toBe(1);
  }, 120_000);

  it('T13: the takeover applied, its answer lost as INTERNAL, the transaction re-run: sent once, counted as taken over', async () => {
    const r = await lastSighting('T13', isTakeover, 13, true);
    expect(r.hits).toBe(1);
    // GAX does not resend a commit on INTERNAL: runTransaction re-ran the whole transaction.
    expect(r.resent).toEqual([]);
    expect(r.run).toMatchObject({ due: 1, sent: 1, dupes: 0, failed: 0, retried: 1 });
    expect(r.row).toMatchObject({ state: 'sent', retries: 1 });
    expect(r.next.due).toBe(0);
    expect(r.bells).toBe(1);
  }, 120_000);

  it('T4: the same with DEADLINE_EXCEEDED', async () => {
    const r = await lastSighting('T4', isTakeover, 4, true);
    expect(r.hits).toBe(1);
    expect(r.resent).toEqual([]);
    expect(r.run).toMatchObject({ due: 1, sent: 1, dupes: 0, failed: 0, retried: 1 });
    expect(r.row).toMatchObject({ state: 'sent', retries: 1 });
    expect(r.bells).toBe(1);
  }, 120_000);
});

describe('controls: the same on the snapshot and with the patch', () => {
  it('C13: the create applied, its answer lost as INTERNAL: not resent, so counted failed and red (not silent)', async () => {
    const r = await lastSighting('C13', isClaimCreate, 13, false);
    expect(r.hits).toBe(1);
    expect(r.resent).toEqual([]);
    expect(r.run).toMatchObject({ sent: 0, failed: 1 });
    expect(r.outcome.failed).toBeGreaterThan(0);
  }, 120_000);

  it('T14: the takeover applied, its answer lost as UNAVAILABLE: GAX resends the commit, the emulator refuses it, red', async () => {
    const r = await lastSighting('T14', isTakeover, 14, true);
    expect(r.hits).toBe(1);
    // The emulator's answer to a committed transaction's resent commit. Production's may differ: if it
    // is one runTransaction retries (ABORTED, or "...transaction has expired..."), this is the silent
    // case of T13, which the patch also covers.
    expect(r.resent.map((x) => x.code)).toEqual([3]);
    expect(r.run).toMatchObject({ sent: 0, failed: 1 });
  }, 120_000);

  it('G1: two runs at the same time still send it once', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    await seed({ dentist: eventAt(ALICE, at) });
    const a = mod.emptyCounts();
    const b = mod.emptyCounts();
    await Promise.all([mod.remindDue(db, T, a), mod.remindDue(db, T, b)]);
    show('G1', { a: pick(a), b: pick(b), bells: await bellsFor(ALICE) });
    expect(a.sent + b.sent).toBe(1);
    expect(a.dupes + b.dupes).toBe(1);
    expect(await bellsFor(ALICE)).toBe(1);
  }, 120_000);

  it('G2: another run’s young claim is not this one’s: skipped, not taken over', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    await seed({ dentist: eventAt(ALICE, at) });
    await rowOf('dentist', at).set({ eventId: 'dentist', day: dayOf(at), at, state: 'sending', claimId: 'another-run', claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - MIN) });
    const run = mod.emptyCounts();
    await mod.remindDue(db, T, run);
    const row = (await rowOf('dentist', at).get()).data();
    show('G2', { run: pick(run), row: { state: row?.state, claimId: row?.claimId, retries: row?.retries ?? null } });
    expect(run).toMatchObject({ sent: 0, dupes: 1, retried: 0 });
    expect(row).toMatchObject({ state: 'sending', claimId: 'another-run' });
    expect(await bellsFor(ALICE)).toBe(0);
  }, 120_000);

  it('G3: another run’s stale claim is taken over and sent once', async () => {
    const T = Date.now();
    const at = minute(T - 2 * MIN);
    await seed({ dentist: eventAt(ALICE, at) });
    await rowOf('dentist', at).set({ eventId: 'dentist', day: dayOf(at), at, state: 'sending', claimId: 'a-run-that-died', claimedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 6 * MIN) });
    const run = mod.emptyCounts();
    await mod.remindDue(db, T, run);
    const row = (await rowOf('dentist', at).get()).data();
    show('G3', { run: pick(run), row: { state: row?.state, retries: row?.retries ?? null } });
    expect(run).toMatchObject({ sent: 1, dupes: 0, retried: 1 });
    expect(row).toMatchObject({ state: 'sent', retries: 1 });
    expect(await bellsFor(ALICE)).toBe(1);
  }, 120_000);
});
