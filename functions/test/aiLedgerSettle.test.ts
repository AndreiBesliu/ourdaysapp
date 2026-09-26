// functions/test/aiLedgerSettle.test.ts
//
// What a paid call is CHARGED, on the emulator, through the real `withLedger` (26.09.2026, with the
// move from Gemini to Claude). The failures this pins are the silent ones:
//   * a reply whose usage cannot be read used to be priced at $0 — every hold refunded in full, the
//     budgets bounding nothing, the admin panel showing $0. It must keep the pessimistic estimate;
//   * a reply served by a server-side FALLBACK is billed at the fallback model's rate, not the one
//     asked for;
//   * a reply that was billed but is no answer (refused, cut off) must say so in the ledger;
//   * the per-model rollup ships with the second model, or mixed history cannot be separated.

import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import { withLedger, usageOf, unfinishedReason, priceUsd } from '../src/aiLedger';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const UID = 'uid-ledger';
const DAY = () => new Date().toISOString().slice(0, 10);
const micro = (usd: number) => Math.max(0, Math.round(usd * 1_000_000));

let db: admin.firestore.Firestore;

beforeAll(() => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
});

const reply = (over: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'ok' }],
  usage: { input_tokens: 1_000, output_tokens: 500 },
  ...over,
});

async function charge(result: unknown, estimate = 0.05) {
  await withLedger(
    { feature: 'test', model: 'claude-opus-5-5', uid: UID },
    estimate,
    async () => result,
    usageOf,
    100,
    unfinishedReason,
  );
  const rows = await db.collection('aiLedger').get();
  expect(rows.size).toBe(1);
  const budget = (await db.doc(`ai_budget/${UID}`).get()).data();
  return { row: rows.docs[0].data(), spentMicro: budget?.microUsd as number };
}

describe('what a paid call is charged', () => {
  it('a readable reply: its tokens, at the model that served it', async () => {
    const { row, spentMicro } = await charge(reply());
    const expected = priceUsd('claude-opus-5-5', 1_000, 500);          // $0.014
    expect(row).toMatchObject({ ok: true, errorCode: null, promptTokens: 1_000, completionTokens: 500 });
    expect(row.costUsd).toBeCloseTo(expected, 10);
    expect(row.servedModel).toBeUndefined();
    expect(spentMicro).toBe(micro(expected));
  });

  it('an UNREADABLE usage keeps the estimate — never $0', async () => {
    const { row, spentMicro } = await charge({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }, 0.05);
    expect(row).toMatchObject({ ok: true, errorCode: 'usage-unreadable' });
    expect(row.costUsd).toBe(0.05);
    expect(spentMicro).toBe(micro(0.05));
  });

  it('a fallback-served reply is billed at the fallback model\'s rate, and says which model ran', async () => {
    const { row, spentMicro } = await charge(reply({ model: 'claude-opus-5' }));
    const expected = priceUsd('claude-opus-5', 1_000, 500);            // $0.0175, not $0.014
    expect(row.costUsd).toBeCloseTo(expected, 10);
    expect(row.servedModel).toBe('claude-opus-5');
    expect(spentMicro).toBe(micro(expected));
  });

  it('a fallback turn is charged EVERY attempt at its own rate — the declined one too', async () => {
    const r = reply({
      model: 'claude-opus-5',
      usage: {
        input_tokens: 1_000, output_tokens: 500,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ],
      },
    });
    const { row, spentMicro } = await charge(r);
    const expected = priceUsd('claude-opus-5-5', 1_000, 800) + priceUsd('claude-opus-5', 1_000, 500);
    expect(row.costUsd).toBeCloseTo(expected, 10);
    expect(row.servedModel).toBe('claude-opus-5');
    expect(spentMicro).toBe(micro(expected));
    // Each model's rollup carries its own attempt; the call is counted once, where it was answered.
    const date = DAY();
    const declined = (await db.doc(`aiSpendDaily/${date}/models/claude-opus-5-5`).get()).data();
    const answered = (await db.doc(`aiSpendDaily/${date}/models/claude-opus-5`).get()).data();
    expect(declined).toMatchObject({ calls: 0, completionTokens: 800, microUsd: micro(priceUsd('claude-opus-5-5', 1_000, 800)) });
    expect(answered).toMatchObject({ calls: 1, completionTokens: 500, microUsd: micro(priceUsd('claude-opus-5', 1_000, 500)) });
  });

  it('a served model the table does not know is priced at the dearest rate, and named', async () => {
    const { row } = await charge(reply({ model: 'claude-opus-4-7' }));
    expect(row.servedModel).toBe('claude-opus-4-7');
    expect(row.costUsd).toBeCloseTo(priceUsd('claude-something-unknown', 1_000, 500), 10);
    expect(row.costUsd).toBeGreaterThan(priceUsd('claude-opus-5-5', 1_000, 500));
  });

  it('a billed reply that is no answer is priced, and marked', async () => {
    const { row } = await charge(reply({ stop_reason: 'refusal', content: [] }));
    expect(row).toMatchObject({ ok: false, errorCode: 'refusal' });
    expect(row.costUsd).toBeCloseTo(priceUsd('claude-opus-5-5', 1_000, 500), 10);
    const cut = await (async () => {
      await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
      return charge(reply({ stop_reason: 'max_tokens' }));
    })();
    expect(cut.row).toMatchObject({ ok: false, errorCode: 'max-tokens' });
  });

  it('a call that threw produced nothing: refunded in full', async () => {
    await expect(withLedger(
      { feature: 'test', model: 'claude-opus-5-5', uid: UID }, 0.05,
      async () => { throw Object.assign(new Error('Overloaded'), { status: 529 }); },
      usageOf, 100, unfinishedReason,
    )).rejects.toThrow('Overloaded');
    const row = (await db.collection('aiLedger').get()).docs[0].data();
    expect(row).toMatchObject({ ok: false, errorCode: 'http-529' });
    expect((await db.doc(`ai_budget/${UID}`).get()).data()?.microUsd).toBe(0);
  });

  it('rolls the spend up per model too, under the model it was priced at', async () => {
    await charge(reply());
    const date = DAY();
    const m = (await db.doc(`aiSpendDaily/${date}/models/claude-opus-5-5`).get()).data();
    expect(m).toMatchObject({ date, model: 'claude-opus-5-5', calls: 1 });
    expect(m?.microUsd).toBe(micro(priceUsd('claude-opus-5-5', 1_000, 500)));
  });
});
