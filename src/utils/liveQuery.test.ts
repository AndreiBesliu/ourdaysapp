// src/utils/liveQuery.test.ts
//
// liveQuery gained liveDoc's shape on 28.09.2026 (the offline card copy stamps its freshness on the
// server confirming a cached answer). Existing callers must see exactly what they saw before.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const onSnapshot = vi.fn();
vi.mock('firebase/firestore', () => ({ onSnapshot: (...a: unknown[]) => onSnapshot(...a) }));
const reportError = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { liveQuery } from './liveQuery';

const snap = (fromCache: boolean, hasPendingWrites = false) => ({
  docs: [{ id: 'a', data: () => ({ name: 'A' }) }],
  metadata: { fromCache, hasPendingWrites },
});

beforeEach(() => { onSnapshot.mockReset(); reportError.mockReset(); });

describe('liveQuery', () => {
  it('without options: onSnapshot(q, next, error), as before', () => {
    liveQuery({} as never, 'ctx', () => {}, () => {});
    expect(onSnapshot.mock.calls[0]).toHaveLength(3);
    expect(typeof onSnapshot.mock.calls[0][1]).toBe('function');
  });

  it('with includeMetadataChanges: the option is passed to onSnapshot', () => {
    liveQuery({} as never, 'ctx', () => {}, () => {}, { includeMetadataChanges: true });
    expect(onSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
  });

  it('hands over the documents and, separately, where they came from', () => {
    const onNext = vi.fn();
    liveQuery({} as never, 'ctx', onNext, () => {});
    onSnapshot.mock.calls[0][1](snap(true, true));
    expect(onNext).toHaveBeenCalledWith([{ id: 'a', name: 'A' }], { fromCache: true, hasPendingWrites: true });
  });

  it('a failure is still reported and still reaches onError', () => {
    const onError = vi.fn();
    liveQuery({} as never, 'Wallet.assets', () => {}, onError, { includeMetadataChanges: true });
    const err = { message: 'denied', code: 'permission-denied' };
    onSnapshot.mock.calls[0][3](err);
    expect(reportError).toHaveBeenCalledWith('denied', { context: 'Wallet.assets', stack: 'code=permission-denied' });
    expect(onError).toHaveBeenCalledWith(err);
  });
});
