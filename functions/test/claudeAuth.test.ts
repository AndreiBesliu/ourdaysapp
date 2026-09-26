// functions/test/claudeAuth.test.ts
//
// How the five AI functions reach Claude, and what happens when they cannot (26.09.2026: the app
// moved from Gemini to Claude Opus 5.5, authenticated by Workload Identity Federation — no key).
//
// Three halves, because each is blind where the others see:
//   * The DEPLOY DESCRIPTION, read off the compiled lib in the CLI's own discovery mode, in a child
//     process: no secret anywhere, and exactly the five AI functions run as the AI service account.
//   * The HANDLERS, on the emulator: without the federation IDs they answer "not configured" and
//     cost nothing — even with an ANTHROPIC_API_KEY lying in the environment, which the SDK would
//     otherwise pick up and prefer. With them, they get past it and stop at the kill switch, before
//     any network call.
//   * The WIRE, with `fetch` stubbed: the Google identity token, its exchange at Anthropic, and the
//     one message request — model, output cap, fallback opt-in, schema, and no key in any header.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  claudeClient, generate, resetClaudeClientForTests, GOOGLE_IDENTITY_URL, FALLBACK_BETA,
} from '../src/claude';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

const AI_FUNCTIONS = [
  'autoSuggestChecklist', 'generateAIChecklist', 'generateGroupDigest',
  'suggestAssetForText', 'suggestEventCategory',
];
const FEDERATION = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID'];
// What must NOT be used: the SDK's ambient credentials and host, and every Gemini-era name.
const DECOYS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-decoy-must-not-be-used',
  ANTHROPIC_AUTH_TOKEN: 'decoy-token-must-not-be-used',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/decoy-host',
  // Merged into every request by the SDK — it could carry a key; claude.ts drops it.
  ANTHROPIC_CUSTOM_HEADERS: 'x-api-key: sk-ant-decoy-header',
  GEMINI_KEY: 'decoy', GEMINI_API_KEY: 'decoy', GEMINI_API_KEY_LOCAL: 'decoy',
};
const saved: Record<string, string | undefined> = {};

function federate() {
  process.env.ANTHROPIC_FEDERATION_RULE_ID = 'fdrl_test';
  process.env.ANTHROPIC_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';
  process.env.ANTHROPIC_SERVICE_ACCOUNT_ID = 'svac_test';
}

beforeEach(() => {
  for (const k of [...FEDERATION, ...Object.keys(DECOYS)]) saved[k] = process.env[k];
  for (const k of FEDERATION) delete process.env[k];
  Object.assign(process.env, DECOYS);
  resetClaudeClientForTests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  vi.restoreAllMocks();
  resetClaudeClientForTests();
});

// ── The deploy description ───────────────────────────────────────────────────────────────────

describe('the deploy description', () => {
  it('declares no secret, and runs exactly the five AI functions as the AI service account', () => {
    const lib = resolve(process.cwd(), 'functions/lib/index.js').split('\\').join('/');
    const script = `
      const mod = require(${JSON.stringify(lib)});
      const out = {};
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn === 'function' && fn.__endpoint) {
          const e = fn.__endpoint;
          out[name] = {
            secrets: (e.secretEnvironmentVariables || []).map((s) => s.key),
            // DECLARED empty, not merely absent: only an empty list reaches the update mask and
            // clears a binding left from before (see AI_FUNCTION_OPTS in index.ts).
            declaredEmpty: Array.isArray(e.secretEnvironmentVariables) && e.secretEnvironmentVariables.length === 0,
            // As the manifest writes it: a param serialises to its name, the default (ResetValue) to null.
            sa: e.serviceAccountEmail == null ? null : JSON.parse(JSON.stringify(e.serviceAccountEmail)),
            timeout: e.timeoutSeconds == null ? null : e.timeoutSeconds,
          };
        }
      }
      process.stdout.write(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, FUNCTIONS_CONTROL_API: 'true' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const eps = JSON.parse(r.stdout) as Record<string, { secrets: string[]; declaredEmpty: boolean; sa: string | null; timeout: unknown }>;
    // A floor, so a load that yielded nothing cannot pass. 51 on 26.09.2026.
    expect(Object.keys(eps).length).toBeGreaterThanOrEqual(51);

    // No secret anywhere: the functions hold no AI key — they federate.
    expect(Object.entries(eps).flatMap(([n, e]) => e.secrets.map((k) => `${n}:${k}`))).toEqual([]);

    // Exactly the five AI functions run as the AI service account — the only identity the Claude
    // federation rule accepts — so no other function can obtain a Claude token.
    const withSa = Object.entries(eps).filter(([, e]) => e.sa !== null).map(([n]) => n).sort();
    expect(withSa).toEqual(AI_FUNCTIONS);
    for (const n of AI_FUNCTIONS) {
      expect(eps[n].sa, n).toContain('AI_SERVICE_ACCOUNT');
      expect(eps[n].timeout, n).toBe(120);
      // The retired GEMINI_API_KEY v1 binding on autoSuggestChecklist is cleared by this, and must be
      // before the AI service account arrives — or Cloud Run asks that account to read it.
      expect(eps[n].declaredEmpty, n).toBe(true);
    }
  });
});

// ── The handlers, on the emulator ────────────────────────────────────────────────────────────

type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let fns: Record<string, Callable>;
let trigger: { run: (event: unknown) => Promise<unknown> };
let db: admin.firestore.Firestore;

const ALICE = 'uid-alice';

const call = (name: string, data: Record<string, unknown>) =>
  fns[name].run({ data, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

const INPUTS: Record<string, Record<string, unknown>> = {
  generateAIChecklist: { title: 'Groceries' },
  suggestEventCategory: { title: 'Dentist' },
  generateGroupDigest: { groupId: 'g1' },
  // One card: with none, the callable answers "no card" without asking the model at all.
  suggestAssetForText: { text: 'Lidl', availableAssets: [{ id: 'card-1', name: 'Lidl Plus' }] },
};

/** Any request that leaves for Anthropic or Google's metadata server, counted. */
function watchOutbound() {
  const real = globalThis.fetch;
  const outbound: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/anthropic|metadata\.google\.internal|127\.0\.0\.1:9/.test(url)) {
      outbound.push(url);
      return Promise.reject(new Error(`unexpected outbound call: ${url}`));
    }
    return real(input as never, init);
  }) as typeof fetch);
  return outbound;
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const mod = (await import('../src/index')) as unknown as Record<string, Callable>;
  fns = mod;
  trigger = mod.autoSuggestChecklist as never;
  db = admin.firestore();
});

beforeEach(async () => {
  if (!HOST) return;
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await db.doc('groups/g1').set({ ownerId: ALICE, members: [ALICE], name: 'Family' });
});

async function usedToday(): Promise<number> {
  const snap = await db.doc(`ai_usage/${ALICE}`).get();
  return (snap.data()?.count as number | undefined) ?? 0;
}

describe('the callables: federation, or "not configured"', () => {
  it.each(Object.keys(INPUTS))('%s: without the federation IDs — decoy key and all — "not configured", at no cost', async (name) => {
    const outbound = watchOutbound();
    await expect(call(name, INPUTS[name])).rejects.toMatchObject({
      code: 'failed-precondition', message: 'AI is not configured on the server.',
    });
    expect(await usedToday()).toBe(0);
    // A configuration answer, not a bug: nothing lands in the error panel.
    expect((await db.collection('errorLogs').get()).size).toBe(0);
    // And the decoy key was never used to call anybody.
    expect(outbound).toEqual([]);
  });

  it.each(Object.keys(INPUTS))('%s: with them, it gets past that, to the kill switch — and calls nobody', async (name) => {
    federate();
    await db.doc('aiConfig/live').set({ killSwitch: true });
    const outbound = watchOutbound();
    await expect(call(name, INPUTS[name])).rejects.toMatchObject({
      code: 'resource-exhausted', message: 'ai-budget/kill-switch',
    });
    // The kill switch refunds the unit it took at the door.
    expect(await usedToday()).toBe(0);
    expect(outbound).toEqual([]);
  });
});

describe('the trigger: federation, or "not configured"', () => {
  async function created(data: Record<string, unknown>) {
    const ref = db.doc('events/e1');
    await ref.set(data);
    const snap = await ref.get();
    await trigger.run({ data: snap, params: { eventId: 'e1' } });
    return (await ref.get()).data()!;
  }
  const EVENT = { ownerId: ALICE, title: 'Groceries', assigneeIds: ['ai_assistant'] };

  it('without the federation IDs: stamped "unconfigured", and the assistant taken off', async () => {
    const outbound = watchOutbound();
    const after = await created(EVENT);
    expect(after.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-checklist/unconfigured' });
    expect(after.assigneeIds).not.toContain('ai_assistant');
    expect(outbound).toEqual([]);
  });

  it('with them: past it, stopped by the kill switch', async () => {
    federate();
    await db.doc('aiConfig/live').set({ killSwitch: true });
    const outbound = watchOutbound();
    const after = await created(EVENT);
    expect(after.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-budget/kill-switch' });
    expect(outbound).toEqual([]);
  });
});

// ── The wire ────────────────────────────────────────────────────────────────────────────────

describe('the client', () => {
  it('ignores the ambient key, token and host: federation, against api.anthropic.com', () => {
    federate();
    const client = claudeClient();
    // The SDK prefers ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN over `credentials` when it reads
    // them; passed explicitly as null, the decoys above are never used.
    expect(client.apiKey).toBeNull();
    expect(client.authToken).toBeNull();
    expect(client.baseURL).toBe('https://api.anthropic.com');
  });

  it('refuses to exist without the federation IDs', () => {
    expect(() => claudeClient()).toThrow(/not configured/);
  });
});

describe('one generation, end to end, with the network stubbed', () => {
  it('Google token → exchange → one Messages request with the right model, cap, fallback and no key', async () => {
    federate();
    const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers: Record<string, string> = {};
      new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
      seen.push({ url, method: init?.method || 'GET', headers, body: typeof init?.body === 'string' ? init.body : '' });
      if (url.startsWith('http://metadata.google.internal/')) return new Response('google.signed.jwt\n', { status: 200 });
      if (url.includes('/v1/oauth/token')) return json({ access_token: 'sk-ant-oat01-test', expires_in: 600 });
      if (url.includes('/v1/messages')) {
        return json({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"items":["Milk"]}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch);

    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false };
    const reply = await generate({ system: 'the instructions', prompt: 'the user text', effort: 'low', schema });
    expect((reply as { content: { text: string }[] }).content[0].text).toBe('{"items":["Milk"]}');

    // 1. Google: the metadata server, the audience, format=full (the email claim), and its header.
    const meta = seen.find((s) => s.url.startsWith('http://metadata.google.internal/'))!;
    expect(meta.url).toBe(GOOGLE_IDENTITY_URL);
    expect(meta.url).toContain('audience=https%3A%2F%2Fapi.anthropic.com');
    expect(meta.url).toContain('format=full');
    expect(meta.headers['metadata-flavor']).toBe('Google');

    // 2. The exchange: jwt-bearer, the Google token as the assertion, our rule and accounts.
    const exchange = seen.find((s) => s.url.includes('/v1/oauth/token'))!;
    expect(exchange.url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(JSON.parse(exchange.body)).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: 'google.signed.jwt',
      federation_rule_id: 'fdrl_test',
      service_account_id: 'svac_test',
    });

    // 3. The one Messages request.
    const msgs = seen.filter((s) => s.url.includes('/v1/messages'));
    expect(msgs).toHaveLength(1);
    const m = msgs[0];
    expect(m.url.startsWith('https://api.anthropic.com/')).toBe(true);
    expect(m.headers.authorization).toBe('Bearer sk-ant-oat01-test');
    expect(m.headers['x-api-key']).toBeUndefined();
    expect(m.headers['anthropic-beta']).toContain(FALLBACK_BETA);
    expect(JSON.parse(m.body)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      fallbacks: 'default',
      system: 'the instructions',
      messages: [{ role: 'user', content: 'the user text' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });

    // Nothing ever went to the decoy host.
    expect(seen.some((s) => s.url.includes('127.0.0.1:9'))).toBe(false);
  });
});
