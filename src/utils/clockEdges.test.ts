// src/utils/clockEdges.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// clockEdges.unit.test.ts — `awayFromEdge` (functions/test/clockEdges.ts) on a fake clock.
//
// Written by the m-series mutation run of 17.10.2026 (commit c60463e). The five emulator files that call
// it in a beforeEach exercise it only within 20 s of 00:00 or 00:05 UTC, so at any other time of day a
// broken wait passes every one of them. Here the clock is placed where the wait matters, and the wait
// is measured to the millisecond.
//
// Runs in the ordinary suite (no emulator): `npx vitest run <this file>`, from src/utils.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { awayFromEdge } from '../../functions/test/clockEdges';

const DAY = 86_400_000;
const MIDNIGHT = Date.parse('2026-10-18T00:00:00.000Z');
const REMINDER_EDGE = 5 * 60_000; // remindersRead.test.ts waits out 00:05 UTC

/** The time to the next `edgeMs` of the day from `ms`, worked out apart from the code under test. */
const untilNext = (ms: number, edgeMs: number): number => {
  const into = ms - Math.floor(ms / DAY) * DAY;
  return into <= edgeMs ? edgeMs - into : DAY - into + edgeMs;
};

/**
 * How long `awayFromEdge(...args)` waits when called at `nowMs`, on a fake clock: 0 when it resolves
 * without a timer, else the time to the timer it set. Throws if it is still pending after that timer.
 */
async function waitOf(nowMs: number, ...args: number[]): Promise<number> {
  // A second useFakeTimers while faking keeps the old clock (vitest 2): start each measure afresh.
  vi.useRealTimers();
  vi.useFakeTimers({ now: nowMs });
  let done = false;
  const p = (awayFromEdge as (...a: number[]) => Promise<void>)(...args).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(0);
  if (done) return 0;
  const t0 = Date.now();
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersByTimeAsync(0);
  if (!done) throw new Error('still waiting after its timer');
  await p;
  return Date.now() - t0;
}

afterEach(() => { vi.useRealTimers(); });

describe('awayFromEdge waits out the edge, and only near it', () => {
  it('far from the edge it does not wait', async () => {
    expect(await waitOf(MIDNIGHT - 12 * 3_600_000, 0)).toBe(0);
    expect(await waitOf(MIDNIGHT + 17 * 3_600_000, REMINDER_EDGE)).toBe(0);
  });

  it('ten seconds before midnight, as the digest files call it: until a second past it', async () => {
    expect(await waitOf(MIDNIGHT - 10_000, 0)).toBe(11_000);
    expect(Date.now()).toBe(MIDNIGHT + 1_000);
  });

  it('fifteen seconds before 00:05, as remindersRead calls it: until 00:05:01', async () => {
    expect(await waitOf(MIDNIGHT + REMINDER_EDGE - 15_000, REMINDER_EDGE)).toBe(16_000);
    expect(new Date(Date.now()).toISOString()).toBe('2026-10-18T00:05:01.000Z');
  });

  it('the default margin is 20 s: exactly 20 s away is far enough, a millisecond nearer is not', async () => {
    expect(await waitOf(MIDNIGHT - 20_000, 0)).toBe(0);
    expect(await waitOf(MIDNIGHT - 19_999, 0)).toBe(20_999);
    expect(await waitOf(MIDNIGHT - 5_000, 0, 4_000)).toBe(0);
    expect(await waitOf(MIDNIGHT - 3_000, 0, 4_000)).toBe(4_000);
  });

  it('on the edge it waits a second; just past it, not at all', async () => {
    expect(await waitOf(MIDNIGHT, 0)).toBe(1_000);
    expect(await waitOf(MIDNIGHT + 500, 0)).toBe(0);
    expect(await waitOf(MIDNIGHT + REMINDER_EDGE + 500, REMINDER_EDGE)).toBe(0);
  });

  it('after it, the next edge is at least the margin away, and a hook never waits 30 s', async () => {
    for (const edge of [0, REMINDER_EDGE]) {
      for (let before = -2_000; before <= 25_000; before += 250) {
        const start = MIDNIGHT + edge - before;
        const w = await waitOf(start, edge);
        expect(untilNext(Date.now(), edge), `${edge} ${before}`).toBeGreaterThanOrEqual(20_000);
        expect(w, `${edge} ${before}`).toBeLessThan(30_000);
        vi.useRealTimers();
      }
    }
  });
});
