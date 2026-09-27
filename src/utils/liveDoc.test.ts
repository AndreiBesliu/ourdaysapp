// src/utils/liveDoc.test.ts
//
// `liveDoc` tells its caller where the data came from (cache or server), and subscribes to metadata
// changes only when asked. The birthday banner (utils/ownUserDoc.ts) depends on both: it may only
// ask on the server's word, and a cached snapshot being confirmed raises no event without them.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: unknown[][] = [];
vi.mock('firebase/firestore', () => ({
  onSnapshot: (...args: unknown[]) => { calls.push(args); return () => {}; },
}));
const reported: unknown[][] = [];
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => { reported.push(a); } }));

const { liveDoc } = await import('./liveQuery');

const REF = { path: 'users/u1' } as never;
const snap = (exists: boolean, fromCache: boolean, hasPendingWrites = false) => ({
  id: 'u1', exists: () => exists, data: () => ({ birthday: '1990-04-12' }),
  metadata: { fromCache, hasPendingWrites },
});

beforeEach(() => { calls.length = 0; reported.length = 0; });

describe('liveDoc', () => {
  it('without options: the plain (ref, next, error) listener, as every existing caller had', () => {
    liveDoc(REF, 'ctx', () => {}, () => {});
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(REF);
    expect(typeof calls[0][1]).toBe('function');
    expect(typeof calls[0][2]).toBe('function');
  });

  it('with includeMetadataChanges: the options go to the SDK', () => {
    liveDoc(REF, 'ctx', () => {}, () => {}, { includeMetadataChanges: true });
    expect(calls[0][1]).toEqual({ includeMetadataChanges: true });
    expect(typeof calls[0][2]).toBe('function');
  });

  it('hands over the data and where it came from', () => {
    const seen: unknown[][] = [];
    liveDoc(REF, 'ctx', (d, m) => { seen.push([d, m]); }, () => {}, { includeMetadataChanges: true });
    const next = calls[0][2] as (s: unknown) => void;
    next(snap(true, true));
    next(snap(true, false, true));
    next(snap(false, false));
    expect(seen).toEqual([
      [{ id: 'u1', birthday: '1990-04-12' }, { fromCache: true, hasPendingWrites: false }],
      [{ id: 'u1', birthday: '1990-04-12' }, { fromCache: false, hasPendingWrites: true }],
      [null, { fromCache: false, hasPendingWrites: false }],
    ]);
  });

  it('still reports a failure and hands it to the caller', () => {
    const errs: unknown[] = [];
    liveDoc(REF, 'CalendarHome.userDoc', () => {}, (e) => { errs.push(e); }, { includeMetadataChanges: true });
    const error = calls[0][3] as (e: unknown) => void;
    error({ message: 'Missing or insufficient permissions.', code: 'permission-denied' });
    expect(errs).toHaveLength(1);
    expect(reported[0]).toEqual(['Missing or insufficient permissions.', { context: 'CalendarHome.userDoc', stack: 'code=permission-denied' }]);
  });
});
