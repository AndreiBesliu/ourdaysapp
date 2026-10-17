// functions/test/metadataServerQuiet.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// metadataServerQuiet.test.ts — an emulator run asks nothing of Google's metadata server.
//
// Written by the m-series mutation run of 17.10.2026 (commit c60463e). scripts/test-rules.mjs sets
// METADATA_SERVER_DETECTION=none for every emulator run: without it, the Admin SDK's first calls make
// gcp-metadata ask 169.254.169.254 and metadata.google.internal whether this is one of Google's machines,
// through node's http (gaxios), where no test's fetch stub sees it. Nothing ran on that line: removed, every
// file stayed green. Here a net on http, https, http2 and fetch refuses — and records — every host that is
// not this machine, before anything can leave, and the Admin SDK is put through its first calls.
//
// Run against the emulators through `npm run test:rules`, like the files beside it.

import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
/** What the script handed this run, read before anything in this file could set it. */
const DETECTION = process.env.METADATA_SERVER_DETECTION;

// ── the net, installed before the Admin SDK's first call ─────────────────────────────────────────
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const asked: string[] = [];
const REAL_FETCH = globalThis.fetch;
function hostOf(a: unknown): string {
  try {
    if (typeof a === 'string') return new URL(a).hostname;
    if (a instanceof URL) return a.hostname;
    const o = a as { hostname?: unknown; host?: unknown; url?: unknown } | null;
    if (o && typeof o.url === 'string') return new URL(o.url).hostname;
    return String(o?.hostname ?? o?.host ?? '').replace(/:\d+$/, '');
  } catch { return '?'; }
}
function guard(h: string) {
  if (h !== '' && !LOCAL.has(h)) { asked.push(h); throw new Error(`net: refused ${h}`); }
}
const connect = http2.connect;
vi.spyOn(http2, 'connect').mockImplementation(((authority: unknown, ...rest: unknown[]) => {
  guard(hostOf(authority));
  return (connect as (...a: unknown[]) => unknown).call(http2, authority, ...rest);
}) as never);
for (const m of [http, https]) {
  for (const name of ['request', 'get'] as const) {
    const real = m[name];
    vi.spyOn(m, name).mockImplementation(((...a: unknown[]) => {
      guard(hostOf(a[0]));
      return (real as (...x: unknown[]) => unknown).apply(m, a);
    }) as never);
  }
}
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  guard(hostOf(input));
  return REAL_FETCH(input as never, init as never);
}) as typeof fetch;

const METADATA = /^(169\.254\.169\.254|metadata\.google\.internal\.?|metadata)$/i;

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  await import('../src/index');
  const db = admin.firestore();
  // The Admin SDK's first calls: a read, a write, a transaction.
  await db.collection('events').limit(1).get();
  await db.doc('probe/metadata').set({ at: Date.now() });
  await db.runTransaction(async (tx) => { await tx.get(db.doc('probe/metadata')); });
  // gcp-metadata's question is asynchronous; give a refused one time to be recorded.
  await new Promise((r) => setTimeout(r, 2_000));
  console.log(`METADATA_PROBE detection=${String(DETECTION)} asked=${JSON.stringify(asked)}`);
}, 60_000);
afterAll(() => { globalThis.fetch = REAL_FETCH; vi.restoreAllMocks(); });

it('the run is told there is no metadata server to ask (METADATA_SERVER_DETECTION=none)', () => {
  expect(DETECTION).toBe('none');
});

it('the Admin SDK asks no metadata server, through any of node’s clients', () => {
  expect(asked.filter((h) => METADATA.test(h))).toEqual([]);
});
