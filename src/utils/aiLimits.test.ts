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
  clampAiLimits, DEFAULT_GLOBAL_DAILY_USD, DEFAULT_USER_DAILY_USD,
  MAX_GLOBAL_DAILY_USD, MAX_USER_DAILY_USD, configChangeAllowed,
} from '../../functions/src/aiLimits';

describe('the numbers themselves', () => {
  it('pins every money constant to a LITERAL', () => {
    // Everything else in this file asserts against the constant imported from the module under
    // test, so it follows the code anywhere: change 50 to 5000 and fourteen assertions stay
    // green. Measured by an adversarial review — four one-token edits to the money, all silent.
    //
    // These four lines are the only place the VALUES are stated. Changing a limit should require
    // changing this file, which is the point: it is a decision, not a refactor.
    expect(MAX_GLOBAL_DAILY_USD).toBe(50);
    expect(MAX_USER_DAILY_USD).toBe(5);
    expect(DEFAULT_GLOBAL_DAILY_USD).toBe(5);
    expect(DEFAULT_USER_DAILY_USD).toBe(0.25);
  });

  it('keeps the defaults inside the ceilings', () => {
    // A default above its own ceiling would be clamped on every read, so the app would run on a
    // figure nobody wrote down.
    expect(DEFAULT_GLOBAL_DAILY_USD).toBeLessThanOrEqual(MAX_GLOBAL_DAILY_USD);
    expect(DEFAULT_USER_DAILY_USD).toBeLessThanOrEqual(MAX_USER_DAILY_USD);
    expect(DEFAULT_USER_DAILY_USD).toBeLessThanOrEqual(DEFAULT_GLOBAL_DAILY_USD);
  });

  it('leaves the per-person ceiling well below the app-wide one', () => {
    // If they were equal, one account could be entitled to the whole day's budget.
    expect(MAX_USER_DAILY_USD).toBeLessThan(MAX_GLOBAL_DAILY_USD);
  });
});

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

  it('caps ONE account well below the whole-app ceiling', () => {
    // Tightened when the config became writable. Without a separate per-user ceiling, an admin
    // could set the per-person limit equal to the app-wide one, and a single account would be
    // entitled to the entire day's budget — a limit that exists and bounds nothing.
    const r = clampAiLimits({ globalDailyUsd: 50, userDailyUsd: 50 });
    expect(r.userDailyUsd).toBe(MAX_USER_DAILY_USD);
    expect(r.clamped).toContain(`userDailyUsd: capped at ${MAX_USER_DAILY_USD}`);
  });

  it('never lets the per-user limit exceed the whole-app one either', () => {
    // The other bound, which binds when the global is set BELOW the per-user ceiling.
    const r = clampAiLimits({ globalDailyUsd: 1, userDailyUsd: 4 });
    expect(r.userDailyUsd).toBe(1);
    expect(r.clamped).toContain('userDailyUsd: capped at the global limit');
  });

  it('caps the user limit against the CLAMPED global, not the requested one', () => {
    // Order matters: clamp the global first, or asking for 1e9/1e9 yields a user limit of 1e9.
    const r = clampAiLimits({ globalDailyUsd: 1e9, userDailyUsd: 1e9 });
    expect(r.globalDailyUsd).toBe(MAX_GLOBAL_DAILY_USD);
    expect(r.userDailyUsd).toBe(MAX_USER_DAILY_USD);
  });
});

describe('the kill switch', () => {
  it('is on only for an explicit true', () => {
    expect(clampAiLimits({ killSwitch: true }).killSwitch).toBe(true);
    expect(clampAiLimits({ killSwitch: 'true' }).killSwitch).toBe(true);
  });

  it('accepts the spellings somebody types into an environment variable', () => {
    // Tightened the other way on 20.09. Strict `=== "true"` meant `AI_KILL_SWITCH=1` and `=yes`
    // silently did NOTHING — an emergency stop that ignores a reasonable spelling in silence is
    // worse than one that is hard to set. The value also reaches this function from the
    // environment, where those are the obvious things to reach for.
    for (const on of ['TRUE', 'True', ' true ', '1', 'yes', 'on', 'ON']) {
      expect(clampAiLimits({ killSwitch: on }).killSwitch, String(on)).toBe(true);
    }
  });

  it('is off for the spellings that plainly mean off', () => {
    // `Boolean('false')` is TRUE, which is why this is a named list and not truthiness.
    for (const off of ['false', 'FALSE', '0', 'no', 'off', '', undefined, null, false]) {
      const r = clampAiLimits({ killSwitch: off as unknown });
      expect(r.killSwitch, String(off)).toBe(false);
      expect(r.clamped, String(off)).toEqual([]);   // ...and nothing to report
    }
  });

  it('REPORTS a value it does not understand instead of assuming off', () => {
    // The dangerous direction is a switch somebody believes is on. Anything outside both lists
    // is surfaced on the admin screen rather than read as “keep spending” in silence.
    for (const junk of [1, 'maybe', {}, [], 'tru']) {
      const r = clampAiLimits({ killSwitch: junk as unknown });
      expect(r.killSwitch, String(junk)).toBe(false);
      expect(r.clamped, String(junk)).toContain('killSwitch: not recognised, treated as off');
    }
  });
});

describe('who may move the limits, and in which direction', () => {
  const at = (g: number, u: number, k = false) =>
    ({ globalDailyUsd: g, userDailyUsd: u, killSwitch: k });

  it('lets ANY admin make things safer', () => {
    // The safe direction stays with whoever is holding the phone when the bill starts moving.
    expect(configChangeAllowed('admin', at(5, 0.25), at(1, 0.1)).allowed).toBe(true);
    expect(configChangeAllowed('admin', at(5, 0.25, false), at(5, 0.25, true)).allowed).toBe(true);
  });

  it('refuses a plain admin RAISING either limit', () => {
    // `adminSetAdmin` is gated by `assertAdmin` alone, so any admin can mint another admin.
    // CLAUDE.md records that as the reason this app was excluded from publish-to-live. A money
    // control behind that same door would re-create exactly what was excluded.
    expect(configChangeAllowed('admin', at(5, 0.25), at(50, 0.25)).allowed).toBe(false);
    expect(configChangeAllowed('admin', at(5, 0.25), at(5, 1)).allowed).toBe(false);
  });

  it('refuses a plain admin turning the kill switch OFF', () => {
    expect(configChangeAllowed('admin', at(5, 0.25, true), at(5, 0.25, false)).allowed).toBe(false);
  });

  it('lets the owner do any of it', () => {
    expect(configChangeAllowed('owner', at(5, 0.25, true), at(50, 5, false)).allowed).toBe(true);
  });

  it('gives a reason a person can act on, not a code', () => {
    const v = configChangeAllowed('admin', at(5, 0.25), at(50, 0.25));
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/owner/i);
  });

  it('allows a no-op change by anyone', () => {
    // Saving the form unchanged must not be refused: it is the shape of pressing Save twice.
    expect(configChangeAllowed('admin', at(5, 0.25), at(5, 0.25)).allowed).toBe(true);
  });
});
