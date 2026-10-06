// src/utils/liveQuery.test.ts
//
// liveQuery gained liveDoc's shape on 28.09.2026 (the offline card copy stamps its freshness on the
// server confirming a cached answer). Existing callers must see exactly what they saw before.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const onSnapshot = vi.fn();
vi.mock('firebase/firestore', () => ({ onSnapshot: (...a: unknown[]) => onSnapshot(...a) }));
const reportError = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { liveDoc, liveQuery } from './liveQuery';

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

  it('pendingIds (03.10): which documents carry a local write — and the option never reaches the SDK', () => {
    const onNext = vi.fn();
    liveQuery({} as never, 'ctx', onNext, () => {}, { includeMetadataChanges: true, pendingIds: true });
    expect(onSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    onSnapshot.mock.calls[0][2]({
      docs: [
        { id: 'a', data: () => ({}), metadata: { hasPendingWrites: true } },
        { id: 'b', data: () => ({}), metadata: { hasPendingWrites: false } },
      ],
      metadata: { fromCache: false, hasPendingWrites: true },
    });
    expect(onNext.mock.calls[0][1]).toEqual({ fromCache: false, hasPendingWrites: true, pendingIds: ['a'] });
  });

  it('without pendingIds the meta is exactly what it was', () => {
    const onNext = vi.fn();
    liveQuery({} as never, 'ctx', onNext, () => {}, { includeMetadataChanges: true });
    onSnapshot.mock.calls[0][2](snap(false));
    expect(Object.keys(onNext.mock.calls[0][1]).sort()).toEqual(['fromCache', 'hasPendingWrites']);
  });
});

// ── 06.10.2026: the id is the document's, and a throw in onNext is a failure ────────────────
describe('a document cannot name itself, and onNext cannot fail in silence', () => {
  it('a stored `id` never replaces the document id, in a query or a single document', () => {
    const onNext = vi.fn();
    liveQuery({} as never, 'ctx', onNext, () => {});
    onSnapshot.mock.calls[0][1]({
      docs: [{ id: 'real', data: () => ({ id: 'another-game', name: 'A' }) }],
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    expect(onNext.mock.calls[0][0]).toEqual([{ id: 'real', name: 'A' }]);

    const onDoc = vi.fn();
    liveDoc({} as never, 'ctx', onDoc, () => {});
    onSnapshot.mock.calls[1][1]({
      exists: () => true, id: 'real', data: () => ({ id: { toString: 0 } }),
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    expect(onDoc.mock.calls[0][0]).toEqual({ id: 'real' });
  });

  it('a throw in onNext is reported under the listener and reaches onError; the next snapshot still arrives', () => {
    const onError = vi.fn();
    let calls = 0;
    const onNext = vi.fn(() => { if (++calls === 1) throw new TypeError('a.createdAt?.toMillis is not a function'); });
    liveQuery({} as never, 'GamesHubModal.activeGames', onNext, onError);
    const next = onSnapshot.mock.calls[0][1];
    expect(() => next(snap(false))).not.toThrow();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('a.createdAt?.toMillis is not a function');
    expect(reportError.mock.calls[0][1].context).toBe('GamesHubModal.activeGames');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);
    next(snap(false));
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('the same for a single document', () => {
    const onError = vi.fn();
    liveDoc({} as never, 'Profile.me', () => { throw 'not an Error'; }, onError);
    expect(() => onSnapshot.mock.calls[0][1]({
      exists: () => false, id: 'x', data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false },
    })).not.toThrow();
    expect(reportError).toHaveBeenCalledWith('not an Error', expect.objectContaining({ context: 'Profile.me' }));
    expect(onError).toHaveBeenCalledWith('not an Error');
  });

  it('when nothing throws, nothing is reported', () => {
    const onError = vi.fn();
    liveQuery({} as never, 'ctx', () => {}, onError);
    onSnapshot.mock.calls[0][1](snap(false));
    expect(reportError).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
