// src/utils/uploadWatch.test.ts
//
// Slow is not stuck.

import { describe, it, expect } from 'vitest';
import { startWatch, watchTick, hasStalled, percentOf, STALL_MS } from './uploadWatch';

const T0 = 1_000_000;

describe('the defect: a duration was used to answer a question about movement', () => {
  it('lets a slow upload run as long as it keeps moving', () => {
    // The old code gave up at fifteen seconds whatever was happening. The rules allow 10 MB, and
    // four files on live are over 2 MB: on a phone that is a healthy upload past fifteen seconds.
    let w = startWatch(T0);
    for (let i = 1; i <= 12; i++) {
      w = watchTick(w, i * 100_000, T0 + i * 5_000); // a minute, moving all the way
      expect(hasStalled(w, T0 + i * 5_000)).toBe(false);
    }
    expect(w.transferred).toBe(1_200_000);
  });

  it('calls it stuck when nothing has moved for twenty seconds', () => {
    let w = startWatch(T0);
    w = watchTick(w, 500_000, T0 + 3_000);
    expect(hasStalled(w, T0 + 3_000 + STALL_MS - 1)).toBe(false);
    expect(hasStalled(w, T0 + 3_000 + STALL_MS)).toBe(true);
  });

  it('counts from the last time bytes INCREASED, not from the last event', () => {
    // A stalled connection still delivers progress events; they just all say the same number.
    // Treating those as progress would stop the watchdog firing at all.
    let w = startWatch(T0);
    w = watchTick(w, 500_000, T0 + 1_000);
    for (let i = 2; i < 40; i++) w = watchTick(w, 500_000, T0 + i * 1_000);
    expect(w.lastProgressAt).toBe(T0 + 1_000);
    expect(hasStalled(w, T0 + 1_000 + STALL_MS)).toBe(true);
  });

  it('starts the clock at the start, so an upload that never begins is caught', () => {
    const w = startWatch(T0);
    expect(hasStalled(w, T0 + STALL_MS)).toBe(true);
  });
});

describe('progress reports that are not the shape anybody expects', () => {
  it('ignores a report that goes backwards or repeats', () => {
    let w = startWatch(T0);
    w = watchTick(w, 800_000, T0 + 1_000);
    const back = watchTick(w, 10, T0 + 2_000);
    expect(back).toEqual(w);
    expect(watchTick(w, 800_000, T0 + 3_000)).toEqual(w);
  });

  it('ignores NaN, Infinity and negatives rather than freezing on them', () => {
    let w = startWatch(T0);
    w = watchTick(w, 100, T0 + 500);
    for (const bad of [NaN, Infinity, -1, -0]) {
      expect(watchTick(w, bad as number, T0 + 1_000)).toEqual(w);
    }
  });
});

describe('what the person sees while it runs', () => {
  it('is a percentage once the total is known', () => {
    expect(percentOf(0, 1000)).toBe(0);
    expect(percentOf(500, 1000)).toBe(50);
    expect(percentOf(1000, 1000)).toBe(100);
  });

  it('is nothing at all until the total is known', () => {
    expect(percentOf(500, 0)).toBe(null);
    expect(percentOf(500, NaN)).toBe(null);
    expect(percentOf(500, -1)).toBe(null);
  });

  it('never goes over 100 or under 0', () => {
    expect(percentOf(2000, 1000)).toBe(100);
    expect(percentOf(-5, 1000)).toBe(0);
  });
});
