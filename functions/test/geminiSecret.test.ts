// functions/test/geminiSecret.test.ts
//
// The Gemini key comes from Secret Manager (`GEMINI_KEY`, functions/src/geminiKey.ts), reaches
// exactly the five functions that call the model, and the old environment variable is read by
// nothing. See geminiKey.ts for why this was urgent: with `functions/.env` present, the next
// functions deploy would have dropped the plain variable from every function.
//
// Two halves, because each is blind where the other sees:
//   * WHICH functions receive the secret is read off the COMPILED lib, in the CLI's own discovery
//     mode (FUNCTIONS_CONTROL_API=true), in a child process — the deploy reads that, not the source,
//     and a fresh process is the only way to load it as the CLI does.
//   * WHICH NAME the handlers read is proved by running them: with only the old names set they
//     answer "not configured"; with the new one set they get past the key and stop at the kill
//     switch — before any network call, so no key and no Google endpoint is involved.

import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

const AI_FUNCTIONS = [
  'autoSuggestChecklist', 'generateAIChecklist', 'generateGroupDigest',
  'suggestAssetForText', 'suggestEventCategory',
];

describe('the deploy description', () => {
  it('gives the key to the five functions that call Gemini, and to nothing else', () => {
    const lib = resolve(process.cwd(), 'functions/lib/index.js').split('\\').join('/');
    const script = `
      const mod = require(${JSON.stringify(lib)});
      const out = {};
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn === 'function' && fn.__endpoint) {
          out[name] = (fn.__endpoint.secretEnvironmentVariables || []).map((s) => s.key);
        }
      }
      process.stdout.write(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, FUNCTIONS_CONTROL_API: 'true' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const secrets = JSON.parse(r.stdout) as Record<string, string[]>;
    // A floor, so a load that yielded nothing cannot pass. 51 on 24.09.2026.
    expect(Object.keys(secrets).length).toBeGreaterThanOrEqual(51);
    const withKey = Object.entries(secrets).filter(([, keys]) => keys.includes('GEMINI_KEY')).map(([n]) => n).sort();
    expect(withKey).toEqual(AI_FUNCTIONS);
    // No other secret anywhere — least privilege, and no stale name coming back.
    const others = Object.entries(secrets).flatMap(([n, keys]) => keys.filter((k) => k !== 'GEMINI_KEY').map((k) => `${n}:${k}`));
    expect(others).toEqual([]);
  });
});

// ── The handlers, on the emulator ────────────────────────────────────────────────────────────

type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let fns: Record<string, Callable>;
let trigger: { run: (event: unknown) => Promise<unknown> };
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
const OLD_NAMES = ['GEMINI_API_KEY_LOCAL', 'GEMINI_API_KEY'];
const saved: Record<string, string | undefined> = {};

const call = (name: string, data: Record<string, unknown>) =>
  fns[name].run({ data, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

const INPUTS: Record<string, Record<string, unknown>> = {
  generateAIChecklist: { title: 'Groceries' },
  suggestEventCategory: { title: 'Dentist' },
  generateGroupDigest: { groupId: 'g1' },
  suggestAssetForText: { text: 'Lidl', availableAssets: [] },
};

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const mod = (await import('../src/index')) as unknown as Record<string, Callable>;
  fns = mod;
  trigger = mod.autoSuggestChecklist as never;
  db = admin.firestore();
});

beforeEach(async () => {
  for (const k of ['GEMINI_KEY', ...OLD_NAMES]) saved[k] = process.env[k];
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE], name: 'Family' });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function onlyOldNames() {
  delete process.env.GEMINI_KEY;
  for (const k of OLD_NAMES) process.env[k] = 'old-name-must-not-be-read';
}

async function newNameAndKillSwitch() {
  for (const k of OLD_NAMES) delete process.env[k];
  process.env.GEMINI_KEY = 'test-not-a-real-key';
  await db.doc('aiConfig/live').set({ killSwitch: true });
}

async function usedToday(): Promise<number> {
  const snap = await db.doc(`ai_usage/${ALICE}`).get();
  return (snap.data()?.count as number | undefined) ?? 0;
}

describe('the callables read GEMINI_KEY, and only GEMINI_KEY', () => {
  it.each(Object.keys(INPUTS))('%s: the old names alone mean "not configured", and cost nothing', async (name) => {
    onlyOldNames();
    // The handler throws failed-precondition and its own outer catch re-wraps it as
    // `internal: AI Error: …` — existing behaviour, recorded in BACKLOG, not what this pins.
    // What this pins is the sentence: the handler found no key under the name it reads.
    const err = await call(name, INPUTS[name]).then(() => null, (e: unknown) => e as { message?: string });
    expect(err?.message ?? '').toContain('AI is not configured on the server.');
    expect(await usedToday()).toBe(0);
  });

  it.each(Object.keys(INPUTS))('%s: with GEMINI_KEY it gets past the key, to the kill switch', async (name) => {
    // The pair that must differ from the case above — and it stops before any call to Google.
    await newNameAndKillSwitch();
    await expect(call(name, INPUTS[name])).rejects.toMatchObject({
      code: 'resource-exhausted', message: 'ai-budget/kill-switch',
    });
  });
});

describe('the trigger reads GEMINI_KEY, and only GEMINI_KEY', () => {
  async function fire() {
    await db.doc('events/e1').set({ title: 'Groceries', ownerId: ALICE, assigneeIds: ['ai_assistant'] });
    await trigger.run({ data: await db.doc('events/e1').get(), params: { eventId: 'e1' } });
    return (await db.doc('events/e1').get()).data();
  }

  it('the old names alone: stamped "unconfigured", and the assistant taken off', async () => {
    onlyOldNames();
    const ev = await fire();
    expect(ev?.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-checklist/unconfigured' });
    expect(ev?.assigneeIds).toEqual([]);
  });

  it('with GEMINI_KEY: past the key, stopped by the kill switch', async () => {
    await newNameAndKillSwitch();
    const ev = await fire();
    expect(ev?.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-budget/kill-switch' });
  });
});
