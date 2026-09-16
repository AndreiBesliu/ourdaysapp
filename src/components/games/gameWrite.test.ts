// src/components/games/gameWrite.test.ts
//
// That every arcade write really carries the moment — RUN, not read.
//
// `arcadeWrites.test.ts` checks the source: that nothing bypasses this helper, and that the stamp
// is written after the caller's fields. Both are text checks, and text checks answer a weaker
// question than the one that matters. An audit of the live database on 16.09.2026 made the gap
// concrete: eighteen games, NONE carrying `lastMoveAt`, because nobody had played since the
// deploy. The whole expiry feature rests on this one function and there was no evidence it does
// what it says — only evidence that the file looks right.
//
// So the module is loaded for real, with the SDK mocked, and the payload it hands to Firestore is
// inspected.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDoc = vi.fn(() => Promise.resolve());
const doc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const SENTINEL = Symbol('serverTimestamp');

vi.mock('firebase/firestore', () => ({
  updateDoc: (...args: unknown[]) => updateDoc(...args),
  doc: (...args: unknown[]) => doc(...(args as [unknown, ...string[]])),
  serverTimestamp: () => SENTINEL,
}));

// The real module initialises Firebase — App Check, persistence, network — at import time.
vi.mock('../../firebase', () => ({ db: { fake: true } }));

const { writeGame } = await import('./gameWrite');

beforeEach(() => {
  updateDoc.mockClear();
  doc.mockClear();
});

/** The payload handed to Firestore by the last call. */
const payload = () => updateDoc.mock.calls[0][1] as Record<string, unknown>;

describe('every write carries the moment it happened', () => {
  it('stamps a move', async () => {
    await writeGame('g1', { 'state.board': [1, 2, 3] });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(payload()['state.board']).toEqual([1, 2, 3]);
    expect(payload().lastMoveAt).toBe(SENTINEL);
  });

  it('writes to the right document', async () => {
    await writeGame('abc123', { status: 'playing' });
    expect(doc).toHaveBeenCalledWith({ fake: true }, 'games', 'abc123');
  });

  it('keeps dotted paths as dotted paths', async () => {
    // `{ 'state.flippedIndices': [] }` updates that leaf alone. Nesting it under an object would
    // replace the whole of `state` and take the board with it.
    await writeGame('g1', { 'state.flippedIndices': [], 'state.scores': { P1: 1 } });
    expect(Object.keys(payload()).sort()).toEqual(['lastMoveAt', 'state.flippedIndices', 'state.scores']);
    expect(payload()).not.toHaveProperty('state');
  });

  it('stamps even a write that carries nothing else', async () => {
    await writeGame('g1', {});
    expect(payload()).toEqual({ lastMoveAt: SENTINEL });
  });

  it('OVERRULES a caller that tries to supply its own timestamp', async () => {
    // The rule `arcadeWrites.test.ts` can only check by string position, asked here as a result:
    // no caller gets to claim a game was touched at some other moment.
    await writeGame('g1', { lastMoveAt: 'yesterday', status: 'playing' });
    expect(payload().lastMoveAt).toBe(SENTINEL);
    expect(payload().status).toBe('playing');
  });

  it('lets a failure reach the caller instead of swallowing it', async () => {
    // The games catch their own write errors; a helper that resolved on failure would turn a
    // refused move into a silent no-op, and the board would simply not change with no reason given.
    updateDoc.mockImplementationOnce(() => Promise.reject(new Error('permission-denied')));
    await expect(writeGame('g1', { status: 'playing' })).rejects.toThrow('permission-denied');
  });
});
