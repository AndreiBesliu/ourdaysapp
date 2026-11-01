// functions/test/checklistOnce.test.ts
//
// One creation, one checklist, one paid call (review of 31.10.2026, hardened after the review of
// 01.11.2026).
//
// Eventarc delivers a Firestore trigger "at least once", and every delivery of one creation carries
// the same snapshot: the event as it was created, with `ai_assistant` still among the assignees.
// Judged on that alone, a second delivery took another of the owner's fifty, paid for another Claude
// call and appended a second checklist. The trigger now claims the work on the event as it is NOW,
// in a transaction, before the quota, under a token of its own; and both endings write only while
// the work is still that delivery's.
//
// The real handler on the emulator, with the network stubbed: the Google token, the exchange, and a
// Messages reply. What is counted is what costs and what shows: Messages requests, quota units, the
// items that land on the event, the note, the assistant, the error panel.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { WriteBatch } from '@google-cloud/firestore';
import { resetClaudeClientForTests } from '../src/claude';
import { checklistHoldMs } from '../src/aiChecklistOutcome';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-alice';
// The trigger's own timeout, read from its deploy description, and the hold derived from it.
let TIMEOUT_MS = 0;
let HOLD_MS = 0;

const FEDERATION: Record<string, string> = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
};
const saved: Record<string, string | undefined> = {};

let trigger: { run: (event: unknown) => Promise<unknown> };
let db: admin.firestore.Firestore;

/**
 * Every Messages request, answered with `reply` (a two-item checklist unless told otherwise); everything
 * else outbound refused. `gate` holds the FIRST reply until released; `firstCall` resolves when that
 * request has arrived, which is after the claim and the quota.
 */
function stubClaude(opts: { gate?: Promise<void>; reply?: string } = {}) {
  const messages: string[] = [];
  let arrived!: () => void;
  const firstCall = new Promise<void>((r) => { arrived = r; });
  const real = globalThis.fetch;
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://metadata.google.internal/')) return new Response('google.signed.jwt\n', { status: 200 });
    if (url.includes('/v1/oauth/token')) return json({ access_token: 'sk-ant-oat01-test', expires_in: 600 });
    if (url.includes('/v1/messages')) {
      messages.push(url);
      if (messages.length === 1) {
        arrived();
        // Only the first waits: a second call (a claim that holds nothing) answers at once and fails fast.
        if (opts.gate) await opts.gate;
      }
      return json({
        id: `msg_${messages.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: opts.reply ?? '{"items":["Milk","Bread"]}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }
    if (/anthropic|metadata\.google\.internal|127\.0\.0\.1:9/.test(url)) {
      return new Response('unexpected', { status: 500 });
    }
    return real(input as never, init);
  }) as typeof fetch);
  return { messages, firstCall };
}

function gated() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release };
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  const mod = (await import('../src/index')) as unknown as Record<string, unknown>;
  trigger = mod.autoSuggestChecklist as never;
  TIMEOUT_MS = (trigger as unknown as { __endpoint: { timeoutSeconds: number } }).__endpoint.timeoutSeconds * 1000;
  expect(TIMEOUT_MS).toBeGreaterThan(0);
  HOLD_MS = checklistHoldMs(TIMEOUT_MS / 1000);
  db = admin.firestore();
});

beforeEach(async () => {
  for (const [k, v] of Object.entries(FEDERATION)) { saved[k] = process.env[k]; process.env[k] = v; }
  resetClaudeClientForTests();
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  vi.restoreAllMocks();
  resetClaudeClientForTests();
});

const EVENT = { ownerId: ALICE, title: 'Groceries', assigneeIds: ['ai_assistant'], checklistItems: [] };
const ref = () => db.doc('events/e1');

/** Creates the event and returns the snapshot every delivery of that creation carries. */
async function create(data: Record<string, unknown> = EVENT) {
  await ref().set(data);
  return ref().get();
}
const deliver = (snap: admin.firestore.DocumentSnapshot) => trigger.run({ data: snap, params: { eventId: 'e1' } });

async function unitsUsed(): Promise<number> {
  return ((await db.doc(`ai_usage/${ALICE}`).get()).data()?.count as number | undefined) ?? 0;
}
const now = async () => (await ref().get()).data()!;
const errorRows = async () => (await db.collection('errorLogs').get()).size;
const otherClaim = (msAgo = 1_000) => ({ status: 'running', at: new Date(Date.now() - msAgo).toISOString(), by: 'another-delivery' });

describe('one creation, delivered more than once', () => {
  it('found the trigger and its timeout, so an empty pass cannot be a silent pass', () => {
    expect(typeof trigger?.run).toBe('function');
    expect(HOLD_MS).toBeGreaterThan(TIMEOUT_MS);
  });

  it('a second delivery after the first finished: no call, no unit, no second checklist', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    await deliver(snap);
    // The first did the work, as before.
    expect(messages).toHaveLength(1);
    expect(await unitsUsed()).toBe(1);
    const after = await now();
    expect(after.checklistItems.map((i: { text: string }) => i.text)).toEqual(['Milk', 'Bread']);
    expect(after.assigneeIds).not.toContain('ai_assistant');
    // The claim went with the work.
    expect(after.aiChecklist).toBeUndefined();

    await deliver(snap);
    expect(messages).toHaveLength(1);
    expect(await unitsUsed()).toBe(1);
    expect((await now()).checklistItems).toHaveLength(2);
  });

  it('two deliveries at once: one runs, the other leaves without a trace', async () => {
    const { gate, release } = gated();
    const { messages } = stubClaude({ gate });
    const logs = vi.spyOn(console, 'log');
    const snap = await create();
    const runs = [deliver(snap), deliver(snap)];
    // The winner is held inside its Messages call, so the first delivery to settle is the loser.
    await Promise.race(runs);
    const mid = await now();
    // While the winner works: still the skeleton, still its claim, no failure shown, nothing logged.
    expect(mid.assigneeIds).toContain('ai_assistant');
    expect(mid.aiChecklist?.status).toBe('running');
    expect(await errorRows()).toBe(0);
    expect(logs.mock.calls.filter(([m]) => String(m).startsWith('auto-checklist: already taken or done'))).toHaveLength(1);
    release();
    await Promise.all(runs);
    expect(messages).toHaveLength(1);
    expect(await unitsUsed()).toBe(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.assigneeIds).not.toContain('ai_assistant');
    expect(after.aiChecklist).toBeUndefined();
    expect(await errorRows()).toBe(0);
  });

  it('a delivery that finds another one working leaves it alone, at no cost', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    const claim = otherClaim(5_000);
    await ref().update({ aiChecklist: claim });
    await deliver(snap);
    expect(messages).toHaveLength(0);
    expect(await unitsUsed()).toBe(0);
    const after = await now();
    expect(after.aiChecklist).toEqual(claim);
    expect(after.assigneeIds).toContain('ai_assistant');
  });

  it('a claim as old as the function timeout is still honoured: that delivery may still be working', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    const claim = otherClaim(TIMEOUT_MS);
    await ref().update({ aiChecklist: claim });
    await deliver(snap);
    expect(messages).toHaveLength(0);
    expect(await unitsUsed()).toBe(0);
    expect((await now()).aiChecklist).toEqual(claim);
  });
});

describe('a delivery knows its own claim', () => {
  it('a claim whose commit landed but whose answer was lost is still ours: the work runs', async () => {
    // The library runs the transaction again after a retryable error on commit, and the commit may
    // have landed. The retried attempt then reads its own claim; read as another's, the event kept the
    // assistant and a claim nobody would ever finish.
    const { messages } = stubClaude();
    const snap = await create();
    const proto = WriteBatch.prototype as unknown as { _commit: (o?: { transactionId?: unknown }) => Promise<unknown> };
    const orig = proto._commit;
    let injected = 0;
    proto._commit = async function (this: unknown, o?: { transactionId?: unknown }) {
      const res = await orig.call(this, o);
      // The first transactional commit of the delivery is its claim.
      if (!injected && o?.transactionId) {
        injected++;
        throw Object.assign(new Error('4 DEADLINE_EXCEEDED: injected after the commit landed'), { code: 4 });
      }
      return res;
    };
    try {
      await deliver(snap);
    } finally {
      proto._commit = orig;
    }
    expect(injected).toBe(1);
    expect(messages).toHaveLength(1);
    expect(await unitsUsed()).toBe(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.assigneeIds).not.toContain('ai_assistant');
    expect(after.aiChecklist).toBeUndefined();
  });

  it('taken over while it worked (its hold ran out): its checklist is dropped, the other claim kept', async () => {
    const { gate, release } = gated();
    const { messages, firstCall } = stubClaude({ gate });
    const snap = await create();
    const run = deliver(snap);
    await firstCall;
    // Another delivery found this one's claim stale and took the work.
    const claim = otherClaim(0);
    await ref().update({ aiChecklist: claim });
    release();
    await run;
    expect(messages).toHaveLength(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(0);
    expect(after.aiChecklist).toEqual(claim);
    expect(after.assigneeIds).toContain('ai_assistant');
  });

  it('taken over, then failing: no "failed" written over the other delivery’s work', async () => {
    const { gate, release } = gated();
    const { firstCall } = stubClaude({ gate, reply: 'not a checklist' });
    const snap = await create();
    const run = deliver(snap);
    await firstCall;
    const claim = otherClaim(0);
    await ref().update({ aiChecklist: claim });
    release();
    await run;
    const after = await now();
    expect(after.aiChecklist).toEqual(claim);
    expect(after.assigneeIds).toContain('ai_assistant');
    // The unusable reply is still a defect worth a row.
    expect(await errorRows()).toBe(1);
  });

  it('outlived its hold, and the delivery that took over failed: the paid list lands over the failure', async () => {
    const { gate, release } = gated();
    const { firstCall } = stubClaude({ gate });
    const snap = await create();
    const run = deliver(snap);
    await firstCall;
    // What the other delivery's failure leaves (its quota spent by this one, say).
    await ref().update({
      aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: new Date().toISOString() },
      assigneeIds: FieldValue.arrayRemove('ai_assistant'),
    });
    release();
    await run;
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.aiChecklist).toBeUndefined();
  });

  it('a success commit that landed with its answer lost: one list, told as a success', async () => {
    const { messages } = stubClaude();
    const logs = vi.spyOn(console, 'log');
    const warns = vi.spyOn(console, 'warn');
    const snap = await create();
    const proto = WriteBatch.prototype as unknown as {
      _commit: (o?: { transactionId?: unknown }) => Promise<unknown>;
    };
    const orig = proto._commit;
    let eventCommits = 0;
    let injected = 0;
    proto._commit = async function (this: { _ops?: { docPath: string }[] }, o?: { transactionId?: unknown }) {
      const touchesEvent = !!o?.transactionId && (this._ops || []).some((op) => op.docPath === 'events/e1');
      const res = await orig.call(this, o);
      // The claim is the first transactional write to the event; the success write is the second.
      if (touchesEvent && ++eventCommits === 2) {
        injected++;
        throw Object.assign(new Error('14 UNAVAILABLE: injected after the commit landed'), { code: 14 });
      }
      return res;
    };
    try {
      await deliver(snap);
    } finally {
      proto._commit = orig;
    }
    expect(injected).toBe(1);
    expect(messages).toHaveLength(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.aiChecklist).toBeUndefined();
    expect(await errorRows()).toBe(0);
    expect(logs.mock.calls.filter(([m]) => String(m).startsWith('Successfully generated checklist'))).toHaveLength(1);
    expect(warns.mock.calls.filter(([m]) => String(m).includes('result dropped'))).toHaveLength(0);
  });

  it('the event deleted while it worked: nothing written, nothing in the error panel', async () => {
    const { gate, release } = gated();
    const { firstCall } = stubClaude({ gate });
    const logs = vi.spyOn(console, 'log');
    const warns = vi.spyOn(console, 'warn');
    const snap = await create();
    const run = deliver(snap);
    await firstCall;
    await ref().delete();
    release();
    await run;
    expect((await ref().get()).exists).toBe(false);
    expect(await errorRows()).toBe(0);
    // Told as what it is, not as a takeover by a delivery that does not exist.
    expect(logs.mock.calls.filter(([m]) => String(m).includes('the event was deleted meanwhile'))).toHaveLength(1);
    expect(warns.mock.calls.filter(([m]) => String(m).includes('another delivery has this work'))).toHaveLength(0);
  });

  it('its claim taken off by a move into a group: the work it paid for still lands', async () => {
    const { gate, release } = gated();
    const { firstCall } = stubClaude({ gate });
    const snap = await create();
    const run = deliver(snap);
    await firstCall;
    // The edit form deletes the note on every move into a group (AddEventModal planMove).
    await ref().update({ aiChecklist: FieldValue.delete() });
    release();
    await run;
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.assigneeIds).not.toContain('ai_assistant');
    expect(after.aiChecklist).toBeUndefined();
  });
});

describe('a claim that cannot be written', () => {
  it('ends with its reason, not a skeleton', async () => {
    // The claim is the delivery's first transaction, ahead of the quota's. FAILED_PRECONDITION is not
    // retried by the library, so it reaches the trigger as it is.
    const { messages } = stubClaude();
    const snap = await create();
    const tx = vi.spyOn(db, 'runTransaction')
      .mockRejectedValueOnce(Object.assign(new Error('9 FAILED_PRECONDITION: injected'), { code: 9 }));
    await deliver(snap); // a claim outside the try rejects here
    expect(tx).toHaveBeenCalled();
    expect(messages).toHaveLength(0);
    expect(await unitsUsed()).toBe(0);
    const after = await now();
    // A claim that swallows its own failure as "not my job" leaves no note at all.
    expect(after.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-checklist/error' });
    expect(after.assigneeIds).not.toContain('ai_assistant');
  });

  it('on work another delivery already finished: the checklist stays, with no "failed" over it', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    await deliver(snap);
    expect((await now()).checklistItems).toHaveLength(2);
    vi.spyOn(db, 'runTransaction')
      .mockRejectedValueOnce(Object.assign(new Error('9 FAILED_PRECONDITION: injected'), { code: 9 }));
    await deliver(snap);
    expect(messages).toHaveLength(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.aiChecklist).toBeUndefined();
  });
});

describe('what a claim does not stop', () => {
  it('a claim older than the hold: that delivery is gone, so this one does the work', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    await ref().update({ aiChecklist: otherClaim(HOLD_MS + 1_000) });
    await deliver(snap);
    expect(messages).toHaveLength(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.aiChecklist).toBeUndefined();
  });

  it('a running note the event was CREATED with is not a claim', async () => {
    // A personal event's create is open: a copied or planted note must not hold the work off forever.
    const { messages } = stubClaude();
    const snap = await create({ ...EVENT, aiChecklist: { status: 'running', at: new Date().toISOString(), by: 'x' } });
    await deliver(snap);
    expect(messages).toHaveLength(1);
    const after = await now();
    expect(after.checklistItems).toHaveLength(2);
    expect(after.aiChecklist).toBeUndefined();
  });

  it('a failure still ends with its reason, over the claim', async () => {
    // Without the federation IDs: "unconfigured", recorded where the claim was.
    for (const k of Object.keys(FEDERATION)) delete process.env[k];
    resetClaudeClientForTests();
    const { messages } = stubClaude();
    await deliver(await create());
    expect(messages).toHaveLength(0);
    const after = await now();
    expect(after.aiChecklist).toMatchObject({ status: 'failed', reason: 'ai-checklist/unconfigured' });
    expect(after.assigneeIds).not.toContain('ai_assistant');
  });
});

describe('the event as it is now, not as it was created', () => {
  it('the assistant taken off before the delivery: nothing is asked, nothing is charged', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    await ref().update({ assigneeIds: [] });
    await deliver(snap);
    expect(messages).toHaveLength(0);
    expect(await unitsUsed()).toBe(0);
    expect((await now()).aiChecklist).toBeUndefined();
  });

  it('an event deleted before the delivery: nothing is asked, nothing is written', async () => {
    const { messages } = stubClaude();
    const snap = await create();
    await ref().delete();
    await deliver(snap);
    expect(messages).toHaveLength(0);
    expect(await unitsUsed()).toBe(0);
    expect((await ref().get()).exists).toBe(false);
  });
});
