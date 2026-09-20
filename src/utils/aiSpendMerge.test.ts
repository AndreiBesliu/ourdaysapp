// src/utils/aiSpendMerge.test.ts
//
// The one piece of new arithmetic in the AI Center, and the one that can be wrong while looking
// entirely right. The headline case is the third describe block: a ranking built from thirty
// truncated top-tens puts the wrong person first, and nothing about the resulting table looks
// broken.

import { describe, it, expect } from 'vitest';
import { mergeRollups, type RollupRow } from '../../functions/src/aiSpendMerge';

const day = (...rows: Array<[string, number, number?, number?]>): RollupRow[] =>
  rows.map(([id, microUsd, calls, failures]) => ({ id, microUsd, calls: calls ?? 1, failures: failures ?? 0 }));

describe('adding up the days', () => {
  it('sums one id across the window', () => {
    const out = mergeRollups([day(['group-digest', 1_000_000, 2]), day(['group-digest', 500_000, 1])]);
    expect(out).toEqual([{ id: 'group-digest', calls: 3, failures: 0, usd: 1.5 }]);
  });

  it('converts micro-USD to USD ONCE, after summing', () => {
    // Three thirds of a cent. Converting per day and then adding accumulates float error; adding
    // the integers first does not. The stored unit is an integer precisely for this reason.
    const out = mergeRollups([day(['f', 3_333]), day(['f', 3_333]), day(['f', 3_334])]);
    expect(out[0].usd).toBe(0.01);
  });

  it('keeps failures separate from calls', () => {
    const out = mergeRollups([day(['f', 10, 5, 2]), day(['f', 10, 3, 3])]);
    expect(out[0]).toMatchObject({ calls: 8, failures: 5 });
  });

  it('returns nothing for an empty window rather than a row of zeroes', () => {
    expect(mergeRollups([])).toEqual([]);
    expect(mergeRollups([[], [], []])).toEqual([]);
  });
});

describe('a day that could not be read is absent, not zero', () => {
  it('skips a null day without contributing to any total', () => {
    // The callable turns a failed subcollection read into `null` and reports `complete: false`.
    // Treating it as an empty day would understate the spend and say nothing about it.
    const out = mergeRollups([day(['f', 1_000_000]), null, undefined, day(['f', 1_000_000])]);
    expect(out[0].usd).toBe(2);
  });

  it('ignores a row with no usable id', () => {
    const junk = [{ id: '' }, { id: null }, null, undefined] as unknown as RollupRow[];
    expect(mergeRollups([junk, day(['real', 5])])).toEqual([
      { id: 'real', calls: 1, failures: 0, usd: 0.000005 },
    ]);
  });

  it('contributes nothing — never NaN — for a corrupt count', () => {
    // One malformed document must not poison the whole column. `undefined + 1` is NaN, and a NaN
    // total sorts unpredictably and renders as "NaN" on the screen.
    const bad = [{ id: 'f', microUsd: 'lots', calls: null, failures: undefined }] as unknown as RollupRow[];
    const out = mergeRollups([bad, day(['f', 2_000_000, 1])]);
    expect(out[0]).toEqual({ id: 'f', calls: 1, failures: 0, usd: 2 });
  });
});

describe('the ranking a per-day top-ten would have got wrong', () => {
  it('ranks the steady spender above the one-day spike', () => {
    // THE case. Thirty days. `steady` is ELEVENTH every single day, so a per-day
    // `.orderBy(microUsd desc).limit(10)` never returns them even once — they would be absent
    // from the merged table entirely. `spike` is first, once.
    //
    //   steady: 30 days x 5.00  = 150.00
    //   spike :  1 day  x 90.00 =  90.00
    //
    // The cheap merge shows `spike` at the top and no `steady` at all. Both statements are wrong,
    // and a table that omits the biggest spender is worse than no table.
    const days: RollupRow[][] = [];
    for (let d = 0; d < 30; d++) {
      const rows: RollupRow[] = [];
      // A DIFFERENT ten every day. My first attempt reused `top-0..9` across all thirty, so each
      // of them accumulated 180 and outranked `steady` — the fixture, not the code, was wrong,
      // and it would have "proved" the shortcut correct.
      for (let i = 0; i < 10; i++) rows.push({ id: `d${d}-top-${i}`, microUsd: 6_000_000, calls: 1 });
      rows.push({ id: 'steady', microUsd: 5_000_000, calls: 1 });        // always 11th
      if (d === 0) rows.push({ id: 'spike', microUsd: 90_000_000, calls: 1 }); // 1st, once
      days.push(rows);
    }

    const out = mergeRollups(days);
    expect(out[0].id).toBe('steady');
    expect(out[0].usd).toBe(150);
    expect(out.find((r) => r.id === 'spike')?.usd).toBe(90);

    // ...and the control: the shortcut really does get it wrong, so the assertion above is not
    // agreeing with a broken alternative by accident.
    const truncated = mergeRollups(days.map((rows) =>
      [...rows].sort((a, b) => (b.microUsd as number) - (a.microUsd as number)).slice(0, 10)));
    expect(truncated[0].id).not.toBe('steady');
    expect(truncated.some((r) => r.id === 'steady')).toBe(false);
  });
});

describe('the order is total, not incidental', () => {
  it('sorts by spend descending', () => {
    const out = mergeRollups([day(['a', 1], ['b', 300], ['c', 20])]);
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie by id, so two renders of the same data cannot disagree', () => {
    // Without a tiebreak the order falls out of Map insertion, which follows whichever day was
    // read first — and `Promise.all` does not guarantee that between two calls.
    const one = mergeRollups([day(['zebra', 100], ['alpha', 100])]);
    const two = mergeRollups([day(['alpha', 100], ['zebra', 100])]);
    expect(one.map((r) => r.id)).toEqual(['alpha', 'zebra']);
    expect(two.map((r) => r.id)).toEqual(one.map((r) => r.id));
  });
});
