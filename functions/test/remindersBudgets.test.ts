// functions/test/remindersBudgets.test.ts
//
// Written by the review of 17.10.2026.
// and no test holds: the send budget fits inside the 150 s timeout with the reads ("With the reads'
// 2 x 15 s, inside the 150 s timeout"), and a claim left by a dead run is stale by the time the NEXT
// run looks at it, but never while its own run may still be delivering it.
import { beforeAll, describe, expect, it } from 'vitest';

let mod: typeof import('../src/reminders');
const RUN_EVERY_MS = 5 * 60_000; // the job's cron, */5

beforeAll(async () => {
  await import('../src/index');
  mod = await import('../src/reminders');
});

const timeoutMs = () => ((mod.sendDueReminders as unknown as { __endpoint: { timeoutSeconds: number } }).__endpoint.timeoutSeconds) * 1000;

describe('the budgets against the schedule', () => {
  it('the reads and the send budget fit in the timeout, with room for the last send', () => {
    expect(timeoutMs()).toBeGreaterThanOrEqual(2 * mod.READ_BUDGET_MS + mod.SEND_BUDGET_MS + 30_000);
  });

  it('a claim is never taken from a run still alive', () => {
    expect(mod.STALE_CLAIM_MS).toBeGreaterThan(timeoutMs());
  });

  it('a claim made as late as a run can make one is stale when the next run starts', () => {
    // A claim is made at most 2 x READ_BUDGET_MS + SEND_BUDGET_MS into a run; the next run starts
    // RUN_EVERY_MS after it and looks at last-chance claims first.
    expect(mod.STALE_CLAIM_MS).toBeLessThanOrEqual(RUN_EVERY_MS - 2 * mod.READ_BUDGET_MS - mod.SEND_BUDGET_MS);
  });
});
