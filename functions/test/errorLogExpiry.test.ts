// functions/test/errorLogExpiry.test.ts
//
// Every error row carries a Timestamp `expireAt`, RETENTION days out — through the real handler for
// client rows, and through the one writer for server rows. The TTL policy deletes on that field and
// silently ignores any other type, so "a string that looks like a date" would mean rows for ever.
// Until 25.09.2026 no row had one. See functions/src/errorRetention.ts.

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const DAYS = 90;
const DAY = 86_400_000;

let logClientError: { run: (req: CallableRequest<unknown>) => Promise<any> };
let logServerError: (m: string, w: string, x?: unknown) => Promise<void>;
let db: admin.firestore.Firestore;

const rows = async () => (await db.collection('errorLogs').get()).docs.map((d) => d.data());

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  logClientError = ((await import('../src/index')) as any).logClientError;
  logServerError = (await import('../src/errorLog')).logServerError;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
});

function expectExpiry(row: Record<string, any>, before: number, after: number) {
  const e = row.expireAt;
  expect(e).toBeInstanceOf(admin.firestore.Timestamp);
  expect(e.toMillis()).toBeGreaterThanOrEqual(before + DAYS * DAY);
  expect(e.toMillis()).toBeLessThanOrEqual(after + DAYS * DAY);
  // And it is measured from when the row was written, not from some other clock.
  expect(Math.abs(e.toMillis() - row.createdAt.toMillis() - DAYS * DAY)).toBeLessThan(60_000);
}

describe('a client error report', () => {
  it('is kept for RETENTION days, and otherwise exactly as before', async () => {
    const before = Date.now();
    const r = await logClientError.run({
      data: { message: 'boom', stack: 'at x', url: '/calendar', context: 'window.onerror' },
      auth: { uid: 'uid-a', token: { uid: 'uid-a', email: 'a@example.test' } },
      rawRequest: { headers: { 'user-agent': 'UA/1' } },
    } as unknown as CallableRequest<unknown>);
    const after = Date.now();
    expect(r).toEqual({ ok: true });
    const all = await rows();
    expect(all).toHaveLength(1);
    expectExpiry(all[0], before, after);
    expect(all[0]).toMatchObject({
      message: 'boom', stack: 'at x', url: '/calendar', context: 'window.onerror',
      uid: 'uid-a', email: 'a@example.test', userAgent: 'UA/1', source: 'client',
    });
  });

  it('over the daily quota writes nothing at all', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db.doc('error_usage/uid-a').set({ date: today, count: 200 });
    const r = await logClientError.run({
      data: { message: 'boom' }, auth: { uid: 'uid-a', token: { uid: 'uid-a' } }, rawRequest: {},
    } as unknown as CallableRequest<unknown>);
    expect(r).toEqual({ ok: false, throttled: true });
    expect(await rows()).toHaveLength(0);
  });
});

describe('a server error row', () => {
  it('carries the same expiry', async () => {
    const before = Date.now();
    await logServerError('server boom', 'ai:test', { uid: 'uid-a', stack: 's' });
    const after = Date.now();
    const all = await rows();
    expect(all).toHaveLength(1);
    expectExpiry(all[0], before, after);
    expect(all[0]).toMatchObject({ message: 'server boom', context: 'ai:test', source: 'server', uid: 'uid-a' });
  });
});
