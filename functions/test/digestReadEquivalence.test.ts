// functions/test/digestReadEquivalence.test.ts
//
// Written by the review of 17.10.2026.
// End to end on the emulator: the lines the NEW reads give (readDigestEvents, and the callable's prompt)
// against the lines the OLD code gave (8797ed7^, reproduced verbatim below: the group's dated query and the
// whole-database `recurrenceRule != null` query, whole documents, `{ id: d.id, ...d.data() }`), for the
// shapes the app writes: every frequency, onlyOn, exceptions (incl. the weekly tolerance at the window's
// lower edge), a moved override with overrideDate, legacy overrides (no overrideDate) with and without the
// parent's exception, a not-an-edit copy, multi-day events begun before the window, a multi-day series
// whose occurrence began before the window, an APK-hour series start, a series dated INSIDE the scan
// (read by both queries), another group's events and personal events.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { awayFromEdge } from './clockEdges';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { resetClaudeClientForTests } from '../src/claude';
import { digestWindow, digestEventLines, DIGEST_EVENT_SCAN, DIGEST_RECURRING_SCAN } from '../src/digestEvents';
import { readDigestEvents } from '../src/digestRead';
import type { EventDoc } from '../src/recurrenceServer';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const G = 'g-digest';
const OTHER = 'g-other';
const ENV = ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID',
  'ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'];
const saved: Record<string, string | undefined> = {};
type Callable = { run: (req: CallableRequest<unknown>) => Promise<unknown> };
let digest: Callable;
let db: admin.firestore.Firestore;
const DAY_MS = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);
const dayFrom = (n: number, base = TODAY) => new Date(Date.parse(`${base}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const at = (day: string) => `${day}T00:00:00.000Z`;
const weekday = (day: string) => new Date(at(day)).getUTCDay();
const asAlice = () => digest.run({ data: { groupId: G }, auth: { uid: ALICE, token: { uid: ALICE } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

const REAL_FETCH = globalThis.fetch;
const refuseOutbound = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/anthropic\.com|metadata\.google\.internal/.test(url)) return Promise.reject(new Error(`outbound call outside the stub: ${url}`));
  return REAL_FETCH(input as never, init);
}) as typeof fetch;
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
      return json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The digest.' }], usage: { input_tokens: 10, output_tokens: 5 } });
    }
    if (/anthropic|metadata/.test(url)) return new Response('unexpected', { status: 500 });
    return real(input as never, init);
  }) as typeof fetch);
  return prompts;
}
const eventLines = (prompt: string) => (prompt.split('Upcoming Events (Next 7 days):\n')[1] ?? '').split('\n').filter((l) => l.startsWith('- '));

beforeAll(async () => {
  expect(HOST).not.toBe('');
  expect(PROJECT.startsWith('demo-')).toBe(true);
  digest = ((await import('../src/index')) as unknown as Record<string, Callable>).generateGroupDigest;
  db = admin.firestore();
  globalThis.fetch = refuseOutbound;
});
afterAll(() => { globalThis.fetch = REAL_FETCH; });
beforeEach(async () => {
  // The test computes days itself, the code reads its own clock: not across the day's edge.
  await awayFromEdge(0);
  expect((await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.ANTHROPIC_FEDERATION_RULE_ID = 'fdrl_test';
  process.env.ANTHROPIC_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';
  process.env.ANTHROPIC_SERVICE_ACCOUNT_ID = 'svac_test';
  resetClaudeClientForTests();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
  resetClaudeClientForTests();
});

/** The first day d >= from with weekday wd (0 = Sunday). */
const nextWeekday = (from: string, wd: number) => { let d = from; while (weekday(d) !== wd) d = dayFrom(1, d); return d; };

async function seedAppShapes() {
  const w = digestWindow(new Date().toISOString())!;
  const docs: Array<[string, Record<string, unknown>]> = [
    [`groups/${G}`, { name: 'Family', ownerId: ALICE, members: [ALICE, BOB] }],
    [`groups/${OTHER}`, { name: 'Other', ownerId: BOB, members: [BOB] }],
  ];
  const ev = (id: string, d: Record<string, unknown>) => docs.push([`events/${id}`, { ownerId: ALICE, groupId: G, recurrenceRule: null, recurrenceExceptions: [], ...d, title: id }]);
  ev('plain', { date: at(dayFrom(1)) });
  ev('today', { date: at(TODAY), time: '09:00' });
  ev('last-day', { date: at(w.toDay) });
  ev('after-window', { date: at(dayFrom(8)) });
  ev('trip-begun-10-days-ago', { date: at(dayFrom(-10)), endDayOffset: 12 });
  ev('trip-ended-yesterday', { date: at(dayFrom(-5)), endDayOffset: 4 });
  ev('trip-begun-40-days-ago', { date: at(dayFrom(-40)), endDayOffset: 45 }); // beyond the 30-day lookback: missed by both
  // Series, every frequency.
  ev('daily-weekdays-begun-5-days-ago', { date: at(dayFrom(-5)), recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' }, recurrenceExceptions: [dayFrom(2), dayFrom(-1)] });
  ev('daily-begun-25-days-ago', { date: at(dayFrom(-25)), recurrenceRule: { frequency: 'daily' }, recurrenceExceptions: [dayFrom(3), '2020-01-01', `${dayFrom(4)}T00:00:00.000Z`] });
  const weeklyStart = dayFrom(-98);
  ev('weekly-begun-98-days-ago', { date: at(weeklyStart), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [dayFrom(6)] }); // occurrences today and +7; +6 excepts +7 (tolerance)
  ev('monthly-begun-200-days-ago', { date: at(dayFrom(-200 + 0)), recurrenceRule: { frequency: 'monthly' } });
  ev('monthly-on-today-plus-2', { date: at(`${Number(dayFrom(2).slice(0, 4)) - 1}${dayFrom(2).slice(4)}`), recurrenceRule: { frequency: 'monthly' } });
  ev('yearly-3-years-ago-plus-3', { date: at(`${Number(dayFrom(3).slice(0, 4)) - 3}${dayFrom(3).slice(4)}`), recurrenceRule: { frequency: 'yearly' } });
  ev('weekly-weekends-filter-ignored', { date: at(dayFrom(-14)), recurrenceRule: { frequency: 'weekly', onlyOn: 'weekends' } });
  // APK hour: 22:30Z means the next day (seriesStartDay).
  ev('weekly-apk-hour', { date: `${dayFrom(-29)}T22:30:00.000Z`, recurrenceRule: { frequency: 'weekly' } });
  // A multi-day weekly series whose occurrence began the day before the window and runs into it, with an
  // exception one day before THAT occurrence (the weekly tolerance at the lower edge: lo = from - (span+1)).
  const edgeOcc = dayFrom(-1);
  ev('weekly-span2-edge', { date: at(dayFrom(-63, edgeOcc)), endDayOffset: 2, recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [dayFrom(-1, edgeOcc)] });
  ev('weekly-span2-edge-kept', { date: at(dayFrom(-63, edgeOcc)), endDayOffset: 2, recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [dayFrom(-2, edgeOcc)] });
  // A moved override: parent weekly, occurrence D in the window moved to D+1, exception on the parent.
  const D = dayFrom(2);
  ev('weekly-parent', { ownerId: BOB, date: at(dayFrom(-70, D)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [D] });
  docs.push(['events/weekly-parent-moved', { ownerId: BOB, groupId: G, title: 'weekly-parent (moved)', date: at(dayFrom(1, D)), overrideOfParent: 'weekly-parent', overrideDate: D }]);
  // Moved far away (outside the scan): only the parent's exception hides D2.
  const D2 = dayFrom(4);
  ev('weekly-parent-far', { ownerId: BOB, date: at(dayFrom(-70, D2)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [D2] });
  docs.push(['events/weekly-parent-far-moved', { ownerId: BOB, groupId: G, title: 'moved far', date: at(dayFrom(40)), overrideOfParent: 'weekly-parent-far', overrideDate: D2 }]);
  // Legacy overrides (before overrideDate): one with the parent's exception, one whose exception went missing.
  const D3 = dayFrom(5);
  ev('legacy-parent', { date: at(dayFrom(-35, D3)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [D3] });
  docs.push(['events/legacy-edit', { ownerId: ALICE, groupId: G, title: 'legacy edit', date: at(D3), overrideOfParent: 'legacy-parent', recurrenceRule: null }]);
  const D4 = dayFrom(6);
  ev('legacy-parent-noexc', { date: at(dayFrom(-35, D4)), recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [] });
  docs.push(['events/legacy-edit-noexc', { ownerId: ALICE, groupId: G, title: 'legacy edit, exception lost', date: at(D4), overrideOfParent: 'legacy-parent-noexc' }]);
  // Not an edit: another owner, same group, carrying the keys. Hides nothing.
  const D5 = dayFrom(1);
  ev('series-not-edited', { date: at(dayFrom(-21, D5)), recurrenceRule: { frequency: 'weekly' } });
  docs.push(['events/not-an-edit', { ownerId: BOB, groupId: G, title: 'not an edit', date: at(dayFrom(-3)), overrideOfParent: 'series-not-edited', overrideDate: D5 }]);
  // Another group's and personal events and series: never lines.
  docs.push(['events/other-plain', { ownerId: BOB, groupId: OTHER, title: 'other-plain', date: at(dayFrom(1)) }]);
  docs.push(['events/other-series', { ownerId: BOB, groupId: OTHER, title: 'other-series', date: at(dayFrom(-7)), recurrenceRule: { frequency: 'weekly' } }]);
  docs.push(['events/personal', { ownerId: ALICE, groupId: null, title: 'personal', date: at(dayFrom(1)) }]);
  docs.push(['events/personal-series', { ownerId: ALICE, groupId: null, title: 'personal-series', date: at(dayFrom(-7)), recurrenceRule: { frequency: 'weekly' } }]);
  const b = db.batch();
  for (const [p, d] of docs) b.set(db.doc(p), d);
  await b.commit();
  return w;
}

/** 8797ed7^ verbatim: the two reads and the docs handed to digestEventLines. */
async function oldDocs(w: NonNullable<ReturnType<typeof digestWindow>>): Promise<EventDoc[]> {
  const [windowSnap, recurringSnap] = await Promise.all([
    db.collection('events').where('groupId', '==', G).where('date', '>=', w.scanFrom).where('date', '<=', w.scanTo)
      .orderBy('date', 'asc').limit(DIGEST_EVENT_SCAN).get(),
    db.collection('events').where('recurrenceRule', '!=', null).limit(DIGEST_RECURRING_SCAN).get(),
  ]);
  return [...windowSnap.docs, ...recurringSnap.docs].map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as EventDoc));
}

describe('old and new reads give the digest the same lines', () => {
  it('for every app shape, readDigestEvents and the old reads list the same (all lines, no cut)', async () => {
    const w = await seedAppShapes();
    const old = digestEventLines(await oldDocs(w), G, w, 1000);
    const read = await readDigestEvents(db, G, w);
    const now = digestEventLines(read.docs, G, w, 1000);
    console.log(`OLD (${old.lines.length})\n${old.lines.join('\n')}`);
    console.log(`NEW (${now.lines.length})\n${now.lines.join('\n')}`);
    expect(old.lines.length).toBeGreaterThan(15);
    expect([...now.lines].sort()).toEqual([...old.lines].sort());
    // Same-day ties come out in the order the two concurrent reads happened to fill the Map: logged, not pinned.
    console.log(`ORDER identical=${JSON.stringify(now.lines) === JSON.stringify(old.lines)}`);
    expect(read.truncated).toBe(false);
  });

  it('and the callable puts the same (first twenty) in front of the model', async () => {
    const w = await seedAppShapes();
    const prompts = stubModel();
    const r = await asAlice();
    const old = digestEventLines(await oldDocs(w), G, w);
    console.log(`CALLABLE ${JSON.stringify(r)} lines=${eventLines(prompts[0]).length} oldTruncated=${old.truncated}`);
    expect(new Set(eventLines(prompts[0]))).toEqual(new Set(old.lines));
  });

  it('page size does not change the answer (1, 3, 7), with documents read by both queries', async () => {
    const w = await seedAppShapes();
    const base = digestEventLines((await readDigestEvents(db, G, w)).docs, G, w, 1000).lines;
    for (const page of [1, 3, 7]) {
      const r = await readDigestEvents(db, G, w, { page });
      expect(r.truncated).toBe(false);
      expect([...digestEventLines(r.docs, G, w, 1000).lines].sort(), `page ${page}`).toEqual([...base].sort());
    }
  });
});
