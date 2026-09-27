// functions/test/aiSpendByModel.test.ts
//
// The AI Center's per-model split, through the REAL `adminGetAiSpend` on the emulator: the model
// rows of every day in the window, the rate each was priced at, the model in use — and the part of
// the window from before the per-model record began, reported beside them rather than left out.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const ADMIN = 'uid-spend-admin';
const DAY = 86_400_000;
const dayKey = (i: number) => new Date(Date.now() - i * DAY).toISOString().slice(0, 10);

let adminGetAiSpend: { run: (req: CallableRequest<unknown>) => Promise<any> };
let db: admin.firestore.Firestore;

const ask = (days: 7 | 30 = 7, uid = ADMIN) => adminGetAiSpend.run({
  data: { days }, auth: { uid, token: { uid } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  adminGetAiSpend = ((await import('../src/index')) as any).adminGetAiSpend;
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  await db.doc(`admins/${ADMIN}`).set({ email: 'admin@example.test' });
});

describe('adminGetAiSpend · by model', () => {
  it('splits the Claude day by model and reports the Gemini day beside it, as unsplit', async () => {
    // Today: three Claude calls, the rollup written by the ledger since 27.09.
    await db.doc(`aiSpendDaily/${dayKey(0)}`).set({ date: dayKey(0), calls: 3, failures: 0, microUsd: 8_096 });
    await db.doc(`aiSpendDaily/${dayKey(0)}/models/claude-opus-5-5`).set({
      date: dayKey(0), model: 'claude-opus-5-5', calls: 3, failures: 0, promptTokens: 1_459, completionTokens: 113, microUsd: 8_096,
    });
    // Two days ago: two Gemini calls, from before the per-model record — a total and nothing else.
    await db.doc(`aiSpendDaily/${dayKey(2)}`).set({ date: dayKey(2), calls: 2, failures: 0, microUsd: 1_173 });

    const r = await ask(7);
    expect(r.byModel).toEqual([{
      model: 'claude-opus-5-5', calls: 3, failures: 0, promptTokens: 1_459, completionTokens: 113, usd: 0.008096,
      pricing: { inPerM: 4, outPerM: 20 }, current: true,
    }]);
    expect(r.modelUnsplit).toEqual({ calls: 2, usd: 0.001173, days: 1 });
    expect(r.complete).toBe(true);
    // The split and the unsplit part add up to the window's total.
    expect(r.byModel[0].usd + r.modelUnsplit.usd).toBeCloseTo(r.totals.week, 9);
  });

  it('a model missing from the price table says so, and is not "in use"', async () => {
    await db.doc(`aiSpendDaily/${dayKey(0)}`).set({ date: dayKey(0), calls: 1, microUsd: 5_000 });
    await db.doc(`aiSpendDaily/${dayKey(0)}/models/some-new-model`).set({ calls: 1, microUsd: 5_000 });
    const r = await ask(7);
    expect(r.byModel).toHaveLength(1);
    expect(r.byModel[0]).toMatchObject({ model: 'some-new-model', pricing: null, current: false });
  });

  it('an empty window: no rows, nothing unsplit', async () => {
    const r = await ask(30);
    expect(r.byModel).toEqual([]);
    expect(r.modelUnsplit).toEqual({ calls: 0, usd: 0, days: 0 });
  });

  it('is still admin-only', async () => {
    await expect(ask(7, 'uid-nobody')).rejects.toThrow(/Admin access required/);
  });
});
