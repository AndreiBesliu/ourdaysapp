// functions/test/geminiKey.test.ts
//
// Where the Gemini key comes from, in the state Andrei chose on 25.09.2026: the plain variable
// GEMINI_API_KEY_LOCAL that the live functions already carry; the Secret Manager move is postponed
// (functions/src/geminiKey.ts, BACKLOG.md).
//
// Two halves, because each is blind where the other sees:
//   * The deploy description, read off the COMPILED lib in the CLI's own discovery mode in a child
//     process: no function declares a secret. One that did would make the deploy demand a secret
//     that does not exist — and a declared param counts as a dotenv, which would replace the live
//     environment and drop the key.
//   * WHICH NAME the handlers read, proved by running them: with only GEMINI_KEY set they answer
//     "not configured"; with GEMINI_API_KEY_LOCAL set they get past the key and stop at the kill
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
  it('declares no secret on any function — the deploy needs none, and keeps the live environment', () => {
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
    const declared = Object.entries(secrets).flatMap(([n, keys]) => keys.map((k) => `${n}:${k}`));
    expect(declared).toEqual([]);
    // Every AI function is still exported, so the check above is about them too.
    for (const n of AI_FUNCTIONS) expect(secrets, n).toHaveProperty(n);
  });
});

// ── The handlers, on the emulator ────────────────────────────────────────────────────────────

type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let fns: Record<string, Callable>;
let trigger: { run: (event: unknown) => Promise<unknown> };
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';
// The postponed name, and the abandoned one from May: neither may be read.
const OTHER_NAMES = ['GEMINI_KEY', 'GEMINI_API_KEY'];
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
  for (const k of ['GEMINI_API_KEY_LOCAL', ...OTHER_NAMES]) saved[k] = process.env[k];
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE], name: 'Family' });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function onlyOtherNames() {
  delete process.env.GEMINI_API_KEY_LOCAL;
  for (const k of OTHER_NAMES) process.env[k] = 'other-name-must-not-be-read';
}

async function realNameAndKillSwitch() {
  for (const k of OTHER_NAMES) delete process.env[k];
  process.env.GEMINI_API_KEY_LOCAL = 'test-not-a-real-key';
  await db.doc('aiConfig/live').set({ killSwitch: true });
}

async function usedToday(): Promise<number> {
  const snap = await db.doc(`ai_usage/${ALICE}`).get();
  return (snap.data()?.count as number | undefined) ?? 0;
}

describe('the callables read GEMINI_API_KEY_LOCAL, and only that', () => {
  it.each(Object.keys(INPUTS))('%s: the other names alone mean "not configured", and cost nothing', async (name) => {
    onlyOtherNames();
    // Exactly the refusal the handler throws: until 25.09 its own outer catch re-wrapped it as
    // `internal: AI Error: …` and filed a server-error row on every call.
    await expect(call(name, INPUTS[name])).rejects.toMatchObject({
      code: 'failed-precondition', message: 'AI is not configured on the server.',
    });
    expect(await usedToday()).toBe(0);
    // A missing key is a configuration answer, not a bug: nothing lands in the error panel.
    expect((await db.collection('errorLogs').get()).size).toBe(0);
  });

  it.each(Object.keys(INPUTS))('%s: with GEMINI_API_KEY_LOCAL it gets past the key, to the kill switch', async (name) => {
    // The pair that must differ from the case above — and it stops before any call to Google.
    await realNameAndKillSwitch();
    await expect(call(name, INPUTS[name])).rejects.toMatchObject({
      code: 'resource-exhausted', message: 'ai-budget/kill-switch',
    });
    // Nothing reached the model, so the caller's daily unit is given back.
    expect(await usedToday()).toBe(0);
  });
});

describe('the trigger reads GEMINI_API_KEY_LOCAL, and only that', () => {
  async function fire() {
    await db.doc('events/e1').set({ title: 'Groceries', ownerId: ALICE, assigneeIds: ['ai_assistant'] });
    await trigger.run({ data: await db.doc('events/e1').get(), params: { eventId: 'e1' } });
    return (await db.doc('events/e1').get()).data();
  }

  it('the other names alone: stamped "unconfigured", and the assistant taken off', async () => {
    onlyOtherNames();
    const ev = await fire();
    expect(ev?.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-checklist/unconfigured' });
    expect(ev?.assigneeIds).toEqual([]);
  });

  it('with GEMINI_API_KEY_LOCAL: past the key, stopped by the kill switch', async () => {
    await realNameAndKillSwitch();
    const ev = await fire();
    expect(ev?.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-budget/kill-switch' });
  });
});
