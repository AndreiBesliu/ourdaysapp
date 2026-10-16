// functions/test/groupDigestRead.test.ts
//
// The group digest reads the group's events in two queries, and until 16.10.2026 both brought whole
// documents. The series query searched the WHOLE database (`recurrenceRule != null`, 500 documents):
// an account with 500 personal events carrying any rule at all (`true` sorts before every real one)
// pushed every group's series out of every digest. The dated one brought up to 300 of the group's
// events whole, and any member can pad those to a megabyte. Pinned here, on the emulators, through the
// real callable, with the network stubbed so that the prompt the model would get can be read:
//   1. the group's series reach the digest whatever other accounts hold;
//   2. no read brings a field the lines are not made from (a `pad` on every event), and a page of
//      fields holds at most ten documents;
//   3. everything still arrives across pages, and past either query's cap the digest says it is cut.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { resetClaudeClientForTests } from '../src/claude';
import { digestWindow } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';
import { watchReads } from './watchReads';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

/** The test's own numbers, not the code's: a constant raised in the code must turn this red. */
const MOST_PER_FIELD_PAGE = 10;
const EVENT_SCAN = 300;
const RECURRING_SCAN = 500;
/** Of every kind, more than one page of fields. */
const N = 12;
const PAD = { pad: 'x'.repeat(64) };

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const STRANGER = 'uid-stranger';
const G = 'g-digest';
const OTHER = 'g-other';

const ENV = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'];
const saved: Record<string, string | undefined> = {};

type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let digest: Callable;
let db: admin.firestore.Firestore;

const DAY_MS = 86_400_000;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const ids = (prefix: string, n = N) => range(n).map((i) => `${prefix}-${String(i).padStart(3, '0')}`);
const dayFrom = (n: number) => new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;
/** The same day of the month, `years` earlier: a yearly series begun then occurs on `day` this year. */
const yearsBefore = (day: string, years: number) => `${Number(day.slice(0, 4)) - years}${day.slice(4)}`;

const asAlice = () => digest.run({
  data: { groupId: G }, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {},
} as unknown as CallableRequest<unknown>);

const REAL_FETCH = globalThis.fetch;
/**
 * Under every stub, for the whole file: a request for Anthropic or Google's metadata server that gets
 * past one fails the test instead of leaving the machine. A restored stub falls through to this.
 */
const refuseOutbound = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/anthropic\.com|metadata\.google\.internal/.test(url)) return Promise.reject(new Error(`outbound call outside the stub: ${url}`));
  return REAL_FETCH(input as never, init);
}) as typeof fetch;

/** The model, stubbed: Google's token, the exchange, and one answer. Returns the prompts it was sent. */
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

/** The event lines of a prompt. */
const eventLines = (prompt: string) => (prompt.split('Upcoming Events (Next 7 days):\n')[1] ?? '')
  .split('\n').filter((l) => l.startsWith('- '));

async function writeAll(docs: Array<[string, Record<string, unknown>]>) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    for (const [path, d] of docs.slice(i, i + 400)) b.set(db.doc(path), d);
    await b.commit();
  }
}

const SERIES_DAY = dayFrom(2);
const SOON = [1, 3, 5];

/** What the digest's events section must list after `seed`: every series of the group, and what is soon. */
const EXPECTED = () => [
  ...ids('series').map((id) => `- ${id} on ${SERIES_DAY}`),
  ...ids('soon', SOON.length).map((id, i) => `- ${id} on ${dayFrom(SOON[i])}`),
];

async function seed() {
  const docs: Array<[string, Record<string, unknown>]> = [
    [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB] }],
    [`groups/${OTHER}`, { name: 'Other', ownerId: STRANGER, members: [STRANGER] }],
  ];
  // The group's series: yearly, begun four years ago on a day of this window, so each occurs in it
  // once, and only the series query can bring them (they are dated long before the dated query's scan).
  for (const id of ids('series')) {
    docs.push([`events/${id}`, {
      ownerId: BOB, groupId: G, title: id, date: at(yearsBefore(SERIES_DAY, 4)),
      recurrenceRule: { frequency: 'yearly' }, recurrenceExceptions: [], ...PAD,
    }]);
  }
  // The group's dated events: ten that ended weeks ago, which the dated query brings FIRST (by date)
  // and the window drops, then those coming up, on its second page.
  for (const id of ids('ended', 10)) docs.push([`events/${id}`, { ownerId: BOB, groupId: G, title: id, date: at(dayFrom(-20)), ...PAD }]);
  ids('soon', SOON.length).forEach((id, i) => docs.push([`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(dayFrom(SOON[i])), ...PAD }]));
  // Another group's series, and its events coming up: never this group's business, never read.
  for (const id of ids('elsewhere', 3)) {
    docs.push([`events/${id}`, {
      ownerId: STRANGER, groupId: OTHER, title: id, date: at(yearsBefore(SERIES_DAY, 4)), recurrenceRule: { frequency: 'yearly' }, ...PAD,
    }]);
  }
  for (const id of ids('elsewhere-soon', 3)) docs.push([`events/${id}`, { ownerId: STRANGER, groupId: OTHER, title: id, date: at(dayFrom(2)), ...PAD }]);
  // A stranger's personal events with a rule that is no series: more than the old query held.
  for (const id of ids('junk', 600)) {
    docs.push([`events/${id}`, { ownerId: STRANGER, groupId: null, title: id, date: at(dayFrom(-400)), recurrenceRule: true, ...PAD }]);
  }
  await writeAll(docs);
}

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  digest = ((await import('../src/index')) as unknown as Record<string, Callable>).generateGroupDigest;
  db = admin.firestore();
  globalThis.fetch = refuseOutbound;
});

afterAll(() => { globalThis.fetch = REAL_FETCH; });

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

describe('the group digest reads its own group', () => {
  it('every series of the group reaches the digest, whatever another account holds', async () => {
    await seed();
    const prompts = stubModel();
    const r = await asAlice();
    expect(prompts).toHaveLength(1);
    const lines = eventLines(prompts[0]);
    expect(new Set(lines)).toEqual(new Set(EXPECTED()));
    expect(lines).toHaveLength(EXPECTED().length);
    expect(r).toEqual({ digest: 'The digest.', truncated: false });
  });

  it('reads no field the lines are not made from, and no more than ten documents a page of fields', async () => {
    await seed();
    stubModel();
    const reads = await watchReads(asAlice);
    expect(reads.pads).toEqual([]);
    expect(reads.largestFieldPage).toBeLessThanOrEqual(MOST_PER_FIELD_PAGE);
    expect(reads.fieldPages).toBeGreaterThan(1);
    // Nothing of another group's or another account's is fetched at all, not even its few fields: what
    // another group holds is not this one's to read, and it would count against this group's caps.
    expect(reads.paths.filter((p) => /^events\/(elsewhere|junk)/.test(p))).toEqual([]);
    expect(reads.paths.filter((p) => /^events\/series-/.test(p))).toHaveLength(N);
  });

  it('a padded title reaches the model as its first 120 characters, as a reminder does', async () => {
    // The rules type a title and nothing more, and the APK writes any length: whole, every member's
    // digest paid for it in the prompt.
    await writeAll([
      [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB] }],
      ['events/long', { ownerId: BOB, groupId: G, title: 'T'.repeat(200_000), date: at(dayFrom(1)) }],
    ]);
    const prompts = stubModel();
    await asAlice();
    expect(eventLines(prompts[0])).toEqual([`- ${'T'.repeat(120)} on ${dayFrom(1)}`]);
  });
});

describe('past a cap, the digest says it is cut', () => {
  /**
   * The digest's answer, and the event lines it was made from. ONE stub for the whole test, never
   * restored between calls: the Claude client keeps the `fetch` it was made with and the token it was
   * given, so a second stub after a restore left the second call on the real network (16.10.2026: two
   * requests reached api.anthropic.com with the test's token, refused with 401).
   */
  let prompts: string[] = [];
  const digestNow = async () => {
    const before = prompts.length;
    const r = await asAlice();
    expect(prompts.length, 'one prompt per digest, all through the stub').toBe(before + 1);
    return { r, lines: eventLines(prompts[before]) };
  };
  beforeEach(() => { prompts = stubModel(); });

  it('events dated in the scan: exactly the dated read\'s cap is the whole of it, one more is cut', async () => {
    const group: [string, Record<string, unknown>] = [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE] }];
    // Ended weeks ago: brought, and dropped by the window, so no line says the list was long.
    const ended = (id: string): [string, Record<string, unknown>] => [`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(dayFrom(-20)) }];
    await writeAll([group, ...ids('ended', EVENT_SCAN).map(ended)]);
    expect(await digestNow()).toEqual({ r: { digest: 'The digest.', truncated: false }, lines: [] });
    await writeAll([ended('ended-one-more')]);
    expect(await digestNow()).toEqual({ r: { digest: 'The digest.', truncated: true }, lines: [] });
  });

  it('series: exactly the series read\'s cap is the whole of it, one more is cut', async () => {
    const group: [string, Record<string, unknown>] = [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE] }];
    // Yearly, on a day outside the window: brought, and no line.
    const series = (id: string): [string, Record<string, unknown>] =>
      [`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(yearsBefore(dayFrom(100), 4)), recurrenceRule: { frequency: 'yearly' } }];
    await writeAll([group, ...ids('series', RECURRING_SCAN).map(series)]);
    expect(await digestNow()).toEqual({ r: { digest: 'The digest.', truncated: false }, lines: [] });
    await writeAll([series('series-one-more')]);
    expect(await digestNow()).toEqual({ r: { digest: 'The digest.', truncated: true }, lines: [] });
  });

  it('the group\'s events that are neither in the scan nor a series are not read, so they cut nothing', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [[`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE] }]];
    // More than either cap, long past, with no rule a series has.
    for (const id of ids('old', RECURRING_SCAN + 1)) docs.push([`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(dayFrom(-400)), recurrenceRule: null }]);
    await writeAll(docs);
    const prompts = stubModel();
    let r: unknown;
    const reads = await watchReads(async () => { r = await asAlice(); });
    expect(r).toEqual({ digest: 'The digest.', truncated: false });
    expect(eventLines(prompts[0])).toEqual([]);
    expect(reads.fieldPages).toBe(0);
  });

  it('exactly a cap is the whole of it; one more is cut, and the cap is kept (both reads, across pages)', async () => {
    const docs: Array<[string, Record<string, unknown>]> = [];
    for (const id of ids('dated', 4)) docs.push([`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(dayFrom(1)) }]);
    for (const id of ids('series', 4)) docs.push([`events/${id}`, { ownerId: ALICE, groupId: G, title: id, date: at(yearsBefore(dayFrom(100), 4)), recurrenceRule: { frequency: 'weekly' } }]);
    await writeAll(docs);
    const w = digestWindow(new Date().toISOString())!;
    const exact = await readDigestEvents(db, G, w, { eventScan: 4, recurringScan: 4, page: 2 });
    expect(exact.truncated).toBe(false);
    expect(exact.docs.map((d) => d.id).sort()).toEqual([...ids('dated', 4), ...ids('series', 4)]);
    const dated = await readDigestEvents(db, G, w, { eventScan: 3, recurringScan: 4, page: 2 });
    expect(dated.truncated).toBe(true);
    expect(dated.docs.filter((d) => d.id.startsWith('dated'))).toHaveLength(3);
    const series = await readDigestEvents(db, G, w, { eventScan: 4, recurringScan: 3, page: 2 });
    expect(series.truncated).toBe(true);
    expect(series.docs.filter((d) => d.id.startsWith('series'))).toHaveLength(3);
  });
});
