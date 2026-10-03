// src/utils/pendingWrite.test.ts — the bounded wait for a write's answer (pendingWrite.ts).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitBound, settleWithin, handOverFailure, SAVE_WAIT_MS, TRANSFER_WAIT_MS } from './pendingWrite';

afterEach(() => { vi.useRealTimers(); });

describe('waitBound', () => {
  it('no wait at all when the browser says it is offline — the one signal that can be trusted', () => {
    expect(waitBound(false, 'save')).toBe(0);
    expect(waitBound(false, 'transfer')).toBe(0);
  });
  it('"online" (or unknown) proves nothing, so it never makes a wait longer than the bound', () => {
    expect(waitBound(true, 'save')).toBe(SAVE_WAIT_MS);
    expect(waitBound(undefined, 'save')).toBe(SAVE_WAIT_MS);
    expect(waitBound(true, 'transfer')).toBe(TRANSFER_WAIT_MS);
    expect(SAVE_WAIT_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('settleWithin', () => {
  it('an answer in time: acked with the value, or refused with the error', async () => {
    await expect(settleWithin(Promise.resolve(7), 1000)).resolves.toEqual({ kind: 'acked', value: 7 });
    const err = new Error('no');
    await expect(settleWithin(Promise.reject(err), 1000)).resolves.toEqual({ kind: 'refused', error: err });
  });

  it('no answer in time: noAnswer, and the write is not abandoned', async () => {
    vi.useFakeTimers();
    let resolveWrite!: (v: string) => void;
    const write = new Promise<string>((r) => { resolveWrite = r; });
    const p = settleWithin(write, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toEqual({ kind: 'noAnswer' });
    resolveWrite('later');
    await expect(write).resolves.toBe('later');
  });

  it('a write already refused (a synchronous validation error) wins even with no wait', async () => {
    vi.useFakeTimers();
    const p = settleWithin(Promise.reject(new Error('Unsupported field value: undefined')), 0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toMatchObject({ kind: 'refused' });
  });

  it('a refusal after the bound never becomes an unhandled rejection', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let rejectWrite!: (e: unknown) => void;
    const write = new Promise((_, r) => { rejectWrite = r; });
    const p = settleWithin(write, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toEqual({ kind: 'noAnswer' });
    rejectWrite(new Error('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('handOverFailure', () => {
  it('the server said no', () => {
    for (const c of ['permission-denied', 'functions/not-found', 'functions/invalid-argument', 'unauthenticated', 'failed-precondition']) {
      expect(handOverFailure(c)).toBe('refused');
    }
  });
  it('no answer, or an unknown one: it may have happened', () => {
    for (const c of ['functions/internal', 'deadline-exceeded', 'functions/unavailable', 'unknown', undefined, 42]) {
      expect(handOverFailure(c)).toBe('unconfirmed');
    }
  });
});
