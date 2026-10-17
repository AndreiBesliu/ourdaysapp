// functions/test/digestHiddenFromCaller.test.ts
//
// Found by the review of 17.10.2026 (pre-existing).
// The group digest is the CALLER's own (GroupChatWidget keeps it in the caller's screen state). The
// calendar does not draw an event hidden from the caller (`hiddenFrom`, src/utils/eventScope.ts) and the
// Period Log does not list it (`maySee` + `isPendingInvite`, functions/src/aiVisibility.ts). Pinned here,
// on the emulators, through the real callable, with the model stubbed so the prompt can be read:
//   1. an event a member hides from the caller, written through the RULES as the app writes it, is not in
//      the caller's digest, and still is in everybody else's;
//   2. named on it (owner, assignee, invitee) the caller still sees it, as `maySee` says; a pending
//      invitation is not shown, as `isPendingInvite` says;
//   3. visibility is decided per OCCURRENCE, by the document it comes from, after the expansion: a hidden
//      edit still stands in for its parent's occurrence (no ghost), a visible edit of a hidden series shows;
//   4. the 20-line cut counts only what the caller may see; the read caps count every document fetched;
//   5. `hiddenFrom` is never read: a long list with the caller last still hides (a query of references
//      asks which events hide from the caller), and nothing of it or of the invitation is kept;
//   6. past the cap of that query, only what is the caller's, or names them, gets a line.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { resetClaudeClientForTests } from '../src/claude';
import { digestWindow } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';
import { watchReads } from './watchReads';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
const G = 'g-digest';
const PAD = { pad: 'x'.repeat(64) };
const EVENT_SCAN = 300;

const ENV = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'];
const saved: Record<string, string | undefined> = {};

type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let digest: Callable;
let db: admin.firestore.Firestore;
let rules: RulesTestEnvironment;

const DAY_MS = 86_400_000;
const dayFrom = (n: number) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;

const as = (uid: string) => digest.run({
  data: { groupId: G }, auth: { uid, token: { uid } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

const REAL_FETCH = globalThis.fetch;
/** Under every stub, for the whole file: a request for Anthropic or Google's metadata server fails the test. */
const refuseOutbound = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/anthropic\.com|metadata\.google\.internal/.test(url)) return Promise.reject(new Error(`outbound call outside the stub: ${url}`));
  return REAL_FETCH(input as never, init);
}) as typeof fetch;

/** The model, stubbed exactly as groupDigestRead.test.ts does. ONE per test, never restored between calls. */
function stubModel(): string[] {
  const prompts: string[] = [];
  const real = globalThis.fetch;
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://metadata.google.internal/')) return new Response('google.signed.jwt\n', { status: 200 });
    if (url.includes('/v1/oauth/token')) return json({ access_token: 'sk-ant-oat01-test', expires_in: 600 });
    if (url.includes('/v1/messages')) {
      prompts.push(String(JSON.parse(String(init?.body)).messages[0].content));
      return json({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'The digest.' }], usage: { input_tokens: 10, output_tokens: 5 },
      });
    }
    if (/anthropic|metadata/.test(url)) return new Response('unexpected', { status: 500 });
    return real(input as never, init);
  }) as typeof fetch);
  return prompts;
}

const eventLines = (prompt: string) => (prompt.split('Upcoming Events (Next 7 days):\n')[1] ?? '')
  .split('\n').filter((l) => l.startsWith('- '));

/** One digest as `uid`: the answer, and the event lines of the prompt it was made from. */
async function digestAs(prompts: string[], uid: string, label: string) {
  const before = prompts.length;
  const r = await as(uid);
  expect(prompts.length, 'one prompt per digest, all through the stub').toBe(before + 1);
  const lines = eventLines(prompts[before]);
  console.log(`VHIDDEN ${label} ${uid}: ${JSON.stringify({ r, lines })}`);
  return { r: r as { digest: string; truncated: boolean }, lines };
}

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

const GROUP: [string, Record<string, unknown>] = [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB, CAROL] }];

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  digest = ((await import('../src/index')) as unknown as Record<string, Callable>).generateGroupDigest;
  db = admin.firestore();
  const [host, port] = [HOST.slice(0, HOST.lastIndexOf(':')), Number(HOST.slice(HOST.lastIndexOf(':') + 1))];
  rules = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8'), host, port },
  });
  globalThis.fetch = refuseOutbound;
});

afterAll(async () => {
  globalThis.fetch = REAL_FETCH;
  await rules?.cleanup();
});

beforeEach(async () => {
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.ANTHROPIC_FEDERATION_RULE_ID = 'fdrl_test';
  process.env.ANTHROPIC_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';
  process.env.ANTHROPIC_SERVICE_ACCOUNT_ID = 'svac_test';
  resetClaudeClientForTests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  vi.restoreAllMocks();
  resetClaudeClientForTests();
});

describe('the digest is the caller\'s: what is hidden from the caller is not in it', () => {
  it('1. a member hides an event from the caller, through the rules, as the app does: gone from the caller\'s digest only', async () => {
    await writeAll([GROUP, ['events/dentist', { ownerId: BOB, groupId: G, title: 'Dentist', date: at(dayFrom(1)) }]]);
    // Bob unticks Alice in "who sees this" (AddEventModal writes `hiddenFrom`); the rules name no such field.
    const asBob = rules.authenticatedContext(BOB).firestore();
    await assertSucceeds(setDoc(doc(asBob, 'events', 'surprise'), {
      ownerId: BOB, groupId: G, title: 'Surprise party for Alice', date: at(dayFrom(2)), hiddenFrom: [ALICE],
    }));
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case1');
    const bob = await digestAs(prompts, BOB, 'case1');
    expect(alice.lines).toEqual([`- Dentist on ${dayFrom(1)}`]);
    expect(alice.r.truncated).toBe(false);
    expect(bob.lines).toEqual([`- Dentist on ${dayFrom(1)}`, `- Surprise party for Alice on ${dayFrom(2)}`]);
  });

  it('2. named on it, the caller still sees it (maySee); a pending invitation is not shown (isPendingInvite)', async () => {
    await writeAll([
      GROUP,
      // Her own: the owner always sees it.
      ['events/mine', { ownerId: ALICE, groupId: G, title: 'Mine, hidden from me', date: at(dayFrom(1)), hiddenFrom: [ALICE] }],
      // Assigned to her, in the list and as the single assignee: assignment is a read grant.
      ['events/assigned', { ownerId: BOB, groupId: G, title: 'Assigned to me', date: at(dayFrom(2)), hiddenFrom: [ALICE], assigneeIds: [BOB, ALICE] }],
      ['events/assigned-one', { ownerId: BOB, groupId: G, title: 'Mine to do', date: at(dayFrom(3)), hiddenFrom: [ALICE], assigneeId: ALICE }],
      // Invited and answered (only the server can write `inviteeId`; vestigial, but `maySee` reads it).
      ['events/invited', { ownerId: BOB, groupId: G, title: 'Invited', date: at(dayFrom(4)), hiddenFrom: [ALICE], inviteeId: ALICE, inviteStatus: 'accepted' }],
      // Invited and not yet answered: hidden in the app until it is answered.
      ['events/pending', { ownerId: BOB, groupId: G, title: 'Pending invitation', date: at(dayFrom(5)), inviteeId: ALICE, inviteStatus: 'pending' }],
      // Hidden from somebody else.
      ['events/not-her', { ownerId: BOB, groupId: G, title: 'Hidden from Carol', date: at(dayFrom(6)), hiddenFrom: [CAROL] }],
    ]);
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case2');
    expect(alice.lines).toEqual([
      `- Mine, hidden from me on ${dayFrom(1)}`,
      `- Assigned to me on ${dayFrom(2)}`,
      `- Mine to do on ${dayFrom(3)}`,
      `- Invited on ${dayFrom(4)}`,
      `- Hidden from Carol on ${dayFrom(6)}`,
    ]);
    const carol = await digestAs(prompts, CAROL, 'case2');
    expect(carol.lines.some((l) => l.includes('Hidden from Carol'))).toBe(false);
    expect(carol.lines.some((l) => l.includes('Mine, hidden from me'))).toBe(true);
  });

  it('3. decided per occurrence, after the expansion: a hidden edit still stands in for its parent\'s occurrence', async () => {
    await writeAll([
      GROUP,
      // Weekly, visible to all, on today and on the window's last day.
      ['events/dinner', { ownerId: BOB, groupId: G, title: 'Family dinner', date: at(dayFrom(-28)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [] }],
      // An edit of the last one, made before `overrideDate` existed and with the parent's exception gone:
      // the shape expandInWindow keeps deduping on purpose. Hidden from Alice.
      ['events/dinner-edit', { ownerId: BOB, groupId: G, title: 'Surprise party for Alice', date: at(dayFrom(7)), overrideOfParent: 'dinner', hiddenFrom: [ALICE] }],
      // The shape the app writes today: moved by a day, `overrideDate` on it, the exception on the parent.
      ['events/club', { ownerId: BOB, groupId: G, title: 'Book club', date: at(dayFrom(-26)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [dayFrom(2)] }],
      ['events/club-edit', { ownerId: BOB, groupId: G, title: 'Book club (moved)', date: at(dayFrom(3)), overrideOfParent: 'club', overrideDate: dayFrom(2), hiddenFrom: [ALICE] }],
      // A series hidden from Alice whose one edit was opened to her: that occurrence is hers to see.
      ['events/plan', { ownerId: BOB, groupId: G, title: 'Secret planning', date: at(dayFrom(-24)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [dayFrom(4)], hiddenFrom: [ALICE] }],
      ['events/plan-edit', { ownerId: BOB, groupId: G, title: 'Planning (open)', date: at(dayFrom(4)), overrideOfParent: 'plan', overrideDate: dayFrom(4), hiddenFrom: [] }],
    ]);
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case3');
    const bob = await digestAs(prompts, BOB, 'case3');
    expect(alice.lines).toEqual([`- Family dinner on ${dayFrom(0)}`, `- Planning (open) on ${dayFrom(4)}`]);
    expect(bob.lines).toEqual([
      `- Family dinner on ${dayFrom(0)}`,
      `- Book club (moved) on ${dayFrom(3)}`,
      `- Planning (open) on ${dayFrom(4)}`,
      `- Surprise party for Alice on ${dayFrom(7)}`,
    ]);
  });

  it('4a. the 20-line cut counts only what the caller may see', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [GROUP];
    for (let i = 0; i < 25; i++) docs.push([`events/h${String(i).padStart(2, '0')}`, { ownerId: BOB, groupId: G, title: `Hidden ${i}`, date: at(dayFrom(1)), hiddenFrom: [ALICE] }]);
    for (let i = 0; i < 3; i++) docs.push([`events/v${i}`, { ownerId: BOB, groupId: G, title: `Visible ${i}`, date: at(dayFrom(2)) }]);
    await writeAll(docs);
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case4a');
    const bob = await digestAs(prompts, BOB, 'case4a');
    expect([...alice.lines].sort()).toEqual([0, 1, 2].map((i) => `- Visible ${i} on ${dayFrom(2)}`));
    expect(alice.r.truncated).toBe(false);
    expect(bob.lines).toHaveLength(20);
    expect(bob.r.truncated).toBe(true);
  });

  it('4b. the read cap counts every document fetched, one hidden from the caller too (a decision, green before and after)', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [GROUP];
    // Weeks ago, hidden from Alice, one more than the look-back read holds: they fill its cap.
    for (let i = 0; i <= EVENT_SCAN; i++) docs.push([`events/old${String(i).padStart(3, '0')}`, { ownerId: BOB, groupId: G, title: `Old ${i}`, date: at(dayFrom(-20)), hiddenFrom: [ALICE] }]);
    docs.push(['events/soon', { ownerId: BOB, groupId: G, title: 'Soon', date: at(dayFrom(1)) }]);
    await writeAll(docs);
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case4b');
    // Past the cap something may be missing, whoever may see it: the digest says it is cut. The days it
    // is about are read on their own (17.10.2026), so what is coming is still listed.
    expect(alice.r.truncated).toBe(true);
    expect(alice.lines).toEqual([`- Soon on ${dayFrom(1)}`]);
  });

  it('5. hiddenFrom is never read: a long list still hides, nothing of it is kept, nothing else is read', async () => {
    const others = Array.from({ length: 20_000 }, (_, i) => `uid-other-${i}`);
    await writeAll([
      GROUP,
      ['events/long', { ownerId: BOB, groupId: G, title: 'Long list', date: at(dayFrom(1)), hiddenFrom: [...others, ALICE], ...PAD }],
      ['events/short', { ownerId: BOB, groupId: G, title: 'Short list', date: at(dayFrom(2)), hiddenFrom: others.slice(0, 3), ...PAD }],
    ]);
    const w = digestWindow(new Date().toISOString())!;
    const read = await readDigestEvents(db, G, w, { viewer: ALICE } as never) as unknown as { docs: Array<Record<string, unknown>>; hidden?: Set<string> };
    expect(read.hidden && [...read.hidden]).toEqual(['long']);
    for (const d of read.docs) {
      for (const k of ['hiddenFrom', 'inviteeId', 'inviteStatus', 'pad']) expect(Object.keys(d), `${d.id}: ${k}`).not.toContain(k);
    }
    const prompts = stubModel();
    const alice = await digestAs(prompts, ALICE, 'case5');
    expect(alice.lines).toEqual([`- Short list on ${dayFrom(2)}`]);
    const bob = await digestAs(prompts, BOB, 'case5');
    expect(bob.lines).toEqual([`- Long list on ${dayFrom(1)}`, `- Short list on ${dayFrom(2)}`]);
    // Last: watchReads restores every mock when it is done, the model's stub too.
    const reads = await watchReads(() => as(ALICE));
    expect(reads.pads).toEqual([]);
    expect(reads.largestFieldPage).toBeLessThanOrEqual(10);
  });

  it('6. past the cap of the read of what hides from the caller, only what is theirs or names them gets a line', async () => {
    await writeAll([
      GROUP,
      ['events/mine', { ownerId: ALICE, groupId: G, title: 'Mine', date: at(dayFrom(1)) }],
      ['events/named', { ownerId: BOB, groupId: G, title: 'Named', date: at(dayFrom(2)), assigneeIds: [ALICE] }],
      ['events/open', { ownerId: BOB, groupId: G, title: 'Open', date: at(dayFrom(3)) }],
      ['events/hid-1', { ownerId: BOB, groupId: G, title: 'Hidden 1', date: at(dayFrom(4)), hiddenFrom: [ALICE] }],
      ['events/hid-2', { ownerId: BOB, groupId: G, title: 'Hidden 2', date: at(dayFrom(5)), hiddenFrom: [ALICE] }],
    ]);
    const w = digestWindow(new Date().toISOString())!;
    // Exactly the cap: every event hiding from her is known, and only those are hidden.
    const within = await readDigestEvents(db, G, w, { viewer: ALICE, hiddenScan: 2 });
    expect([...within.hidden].sort()).toEqual(['hid-1', 'hid-2']);
    expect(within.truncated).toBe(false);
    // One past it: which of the rest hide is unknown, so 'open' (nobody's but Bob's) is held back too.
    const past = await readDigestEvents(db, G, w, { viewer: ALICE, hiddenScan: 1 });
    expect([...past.hidden].sort()).toEqual(['hid-1', 'hid-2', 'open']);
    expect(past.truncated).toBe(true);
  });
});
