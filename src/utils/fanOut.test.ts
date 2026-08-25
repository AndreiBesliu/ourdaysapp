// src/utils/fanOut.test.ts
// The sum that decides how much of your data gets read.
//
// It lives in `functions/src/fanOut.ts` and is tested from here because the app's suite is what
// `npm test` and CI run; `functions/` has no test runner of its own. The helper deliberately
// imports nothing, so this can reach it without a service account.
//
// The defect it exists to prevent, found by an adversarial review on 2026-08-25: the per-query
// FLOOR was applied per group without bounding the fan-out, so 26 queries at a floor of 10 read
// 260 documents against a budget of 150 — 73% over. A budget that is silently exceeded is not a
// budget, and the caller was told the answer was complete either way.

import { describe, it, expect } from 'vitest';
import { planFanOut } from '../../functions/src/fanOut';

const FLOOR = 10;

describe('a fan-out never costs more than its budget', () => {
  const CASES: [number, number][] = [
    [150, 0], [150, 1], [150, 5], [150, 14], [150, 25], [150, 40],
    [600, 25], [600, 100], [10, 5], [10, 0], [45, 9],
  ];

  for (const [budget, groups] of CASES) {
    it(`budget ${budget}, ${groups} group(s): reads at most ${budget}`, () => {
      const p = planFanOut(budget, groups);
      // One query for the caller's own documents, plus one per group actually taken.
      const worstCase = (p.take + 1) * p.perQuery;
      expect(worstCase, `${worstCase} > ${budget}`).toBeLessThanOrEqual(Math.max(budget, FLOOR * 2));
      expect(p.take).toBeLessThanOrEqual(groups);
    });
  }

  it('the old arithmetic really did overrun — this is what was fixed', () => {
    // max(10, floor(150 / 26)) = 10, over 26 queries = 260 against a budget of 150.
    const naivePerQuery = Math.max(FLOOR, Math.floor(150 / 26));
    expect(naivePerQuery * 26).toBe(260);
    const p = planFanOut(150, 25);
    expect((p.take + 1) * p.perQuery).toBeLessThanOrEqual(150);
  });
});

describe('what it gives up, and what it never gives up', () => {
  it('always leaves a query for the caller OWN documents', () => {
    // A member of many groups must not lose sight of their own row.
    for (const groups of [0, 1, 10, 100]) {
      const p = planFanOut(150, groups);
      expect(p.perQuery).toBeGreaterThanOrEqual(FLOOR);
      expect((p.take + 1) * p.perQuery).toBeLessThanOrEqual(150);
    }
  });

  it('never returns a share too small to be worth reading', () => {
    for (const [b, g] of [[10, 50], [30, 50], [600, 500]] as [number, number][]) {
      expect(planFanOut(b, g).perQuery).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('says when it trimmed, and does not when it did not', () => {
    expect(planFanOut(600, 5).trimmed).toBe(false);
    expect(planFanOut(600, 5).take).toBe(5);
    // 150 pays for floor(150/10) − 1 = 14 groups; a member of 40 loses 26 of them and is told.
    const p = planFanOut(150, 40);
    expect(p.take).toBe(14);
    expect(p.trimmed).toBe(true);
  });

  it('survives nonsense rather than returning NaN', () => {
    for (const [b, g] of [[0, 5], [-100, 5], [NaN, 5], [150, -3], [150, NaN]] as [number, number][]) {
      const p = planFanOut(b, g);
      expect(Number.isFinite(p.perQuery)).toBe(true);
      expect(Number.isFinite(p.take)).toBe(true);
      expect(p.take).toBeGreaterThanOrEqual(0);
      expect(p.perQuery).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});
