// src/utils/aiLimits.test.ts
//
// The limits are the only thing standing between this app and an unbounded Gemini bill, and until
// today they were `Number(process.env.X || default)` consumed as `spent + held > toMicro(LIMIT)`.
//
// Every test below asserts the RESULTING NUMBER, never merely that nothing threw. That distinction
// is the whole point: the original bug threw nothing, logged nothing and looked no different — it
// produced `NaN`, and `anything > NaN` is `false`, so the ceiling silently stopped existing.

import { describe, it, expect } from 'vitest';
import {
  clampAiLimits, DEFAULT_GLOBAL_DAILY_USD, DEFAULT_USER_DAILY_USD, MAX_GLOBAL_DAILY_USD,
} from '../../functions/src/aiLimits';

describe('a value that is not a number never becomes a limit', () => {
  it('falls back to the default instead of producing NaN', () => {
    // This is the shipped bug, in one line. `Number('5 USD')` is NaN, and NaN as a ceiling is
    // not a low ceiling or a high one — it is the absence of one.
    const r = clampAiLimits({ globalDailyUsd: '5 USD' });
    expect(r.globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
    expect(Number.isFinite(r.globalDailyUsd)).toBe(true);
    expect(r.clamped).toContain('globalDailyUsd: not a number');
  });

  it('refuses every shape that Number() would have turned into something plausible', () => {
    // Number('') === 0, Number(null) === 0, Number([]) === 0, Number([5]) === 5. Each of those is
    // a mistake upstream, and each would have become a budget.
    for (const bad of [NaN, Infinity, -Infinity, 'abc', '  ', [], [5], {}, true, '1e3', '0x10']) {
      const r = clampAiLimits({ globalDailyUsd: bad as unknown });
      expect(r.globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
    }
  });

  it('treats absent and empty as "not configured", not as zero', () => {
    // An empty string is what a declared-but-unset environment variable looks like. Reading it as
    // "spend nothing today" would switch the feature off by accident rather than by decision.
    for (const absent of [undefined, null, '']) {
      const r = clampAiLimits({ globalDailyUsd: absent as unknown });
      expect(r.globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
      expect(r.clamped).toEqual([]); // ...and says nothing was rejected, because nothing was
    }
    expect(clampAiLimits(null).globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
    expect(clampAiLimits(undefined).userDailyUsd).toBe(DEFAULT_USER_DAILY_USD);
  });

  it('refuses a run of digits long enough to overflow to Infinity', () => {
    // Found by mutation, not by design: four hundred nines PASS the digits check, and `Number()`
    // turns them into `Infinity`. An infinite ceiling is the same defect as a NaN one wearing a
    // different face — every comparison against it says the call is affordable.
    const huge = '9'.repeat(400);
    expect(Number(huge)).toBe(Infinity);                       // the premise, pinned
    expect(clampAiLimits({ globalDailyUsd: huge }).globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
  });

  it('refuses a negative limit rather than letting it through', () => {
    expect(clampAiLimits({ globalDailyUsd: -1 }).globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
    expect(clampAiLimits({ globalDailyUsd: '-1' }).globalDailyUsd).toBe(DEFAULT_GLOBAL_DAILY_USD);
  });
});

describe('the values that ARE accepted', () => {
  it('takes a number, and a string that is only digits', () => {
    expect(clampAiLimits({ globalDailyUsd: 12 }).globalDailyUsd).toBe(12);
    expect(clampAiLimits({ globalDailyUsd: '12' }).globalDailyUsd).toBe(12);
    expect(clampAiLimits({ globalDailyUsd: '12.50' }).globalDailyUsd).toBe(12.5);
  });

  it('accepts ZERO, which the old code could not express at all', () => {
    // `Number(process.env.X || 5)` turned 0 into 5, so "no paid AI today" was the one setting the
    // ceiling could not be given. It is a legitimate thing to want.
    const r = clampAiLimits({ globalDailyUsd: 0, userDailyUsd: 0 });
    expect(r.globalDailyUsd).toBe(0);
    expect(r.userDailyUsd).toBe(0);
    expect(r.clamped).toEqual([]);
  });
});

describe('the ceiling the server owns', () => {
  it('caps the global limit however large the request', () => {
    // Phase 2 puts this field in front of a keyboard. An extra zero is a hundredfold bill and
    // there is no other brake, so the bound lives on the server, not in the form.
    const r = clampAiLimits({ globalDailyUsd: 1e9 });
    expect(r.globalDailyUsd).toBe(MAX_GLOBAL_DAILY_USD);
    expect(r.clamped).toContain(`globalDailyUsd: capped at ${MAX_GLOBAL_DAILY_USD}`);
  });

  it('never lets the per-user limit exceed the whole-app one', () => {
    // A per-account ceiling above the app-wide ceiling cannot bind, so accepting one would
    // display a limit that does nothing — the exact appearance of protection without it.
    const r = clampAiLimits({ globalDailyUsd: 5, userDailyUsd: 40 });
    expect(r.userDailyUsd).toBe(5);
    expect(r.clamped).toContain('userDailyUsd: capped at the global limit');
  });

  it('caps the user limit against the CLAMPED global, not the requested one', () => {
    // Order matters: clamp the global first, or asking for 1e9/1e9 yields a user limit of 1e9.
    const r = clampAiLimits({ globalDailyUsd: 1e9, userDailyUsd: 1e9 });
    expect(r.globalDailyUsd).toBe(MAX_GLOBAL_DAILY_USD);
    expect(r.userDailyUsd).toBe(MAX_GLOBAL_DAILY_USD);
  });
});

describe('the kill switch', () => {
  it('is on only for an explicit true', () => {
    expect(clampAiLimits({ killSwitch: true }).killSwitch).toBe(true);
    expect(clampAiLimits({ killSwitch: 'true' }).killSwitch).toBe(true);
  });

  it('is off for everything else, including the truthy string "false"', () => {
    // `Boolean('false')` is true. A switch that turns the whole feature off must not be flipped
    // by a value that was plainly meant to leave it on.
    for (const off of ['false', 'TRUE', '1', 1, 'yes', {}, [], undefined, null, '']) {
      expect(clampAiLimits({ killSwitch: off as unknown }).killSwitch).toBe(false);
    }
  });
});
