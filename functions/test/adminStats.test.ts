// functions/test/adminStats.test.ts
//
// The Admin statistics read values any member can write (10.10.2026): a group's id, an event's
// category, a game's status, a card's category, a creation time. Run through the REAL callables on the
// emulator, then through the callable's real encoder and a decode that does what the client's does —
// the old helpers either threw on those values or sent an answer the client could not read.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { createRequire } from 'node:module';

// The callable's REAL server-side encoder (by path: the package does not export it).
const { encode } = createRequire(import.meta.url)('../node_modules/firebase-functions/lib/common/providers/https.js') as { encode: (v: unknown) => unknown };

const PROJECT = process.env.GCLOUD_PROJECT || '';
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const ADMIN = 'uid-stats-admin';

type Callable = { run: (req: CallableRequest<unknown>) => Promise<any> };
let db: admin.firestore.Firestore;
let fns: Record<'adminGetStats' | 'adminListGroups' | 'adminGetGrowth', Callable>;
const ask = (f: Callable) => f.run({ data: {}, auth: { uid: ADMIN, token: { uid: ADMIN } }, rawRequest: {} } as unknown as CallableRequest<unknown>);

/** What the client's decode does to a map (@firebase/functions `mapValues` + `decode`). */
function clientDecode(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(clientDecode);
  if (json && typeof json === 'object') {
    if ((json as Record<string, unknown>)['@type']) throw new Error('Data cannot be decoded from JSON');
    const out: Record<string, unknown> = {};
    for (const key in json as Record<string, unknown>) {
      if ((json as { hasOwnProperty: (k: string) => boolean }).hasOwnProperty(key)) out[key] = clientDecode((json as Record<string, unknown>)[key]);
    }
    return out;
  }
  return json;
}
const overTheWire = (v: unknown) => clientDecode(JSON.parse(JSON.stringify(encode(v))));

beforeAll(async () => {
  expect(HOST, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fns = (await import('../src/index')) as never;
  db = admin.firestore();
});

beforeEach(async () => {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await db.doc(`admins/${ADMIN}`).set({ email: 'admin@example.test' });
  const t = admin.firestore.Timestamp.now();
  await db.doc('groups/constructor').set({ name: 'Odd', ownerId: ADMIN, members: [ADMIN], createdAt: '2026-10-01T00:00:00.000Z' });
  await db.doc('groups/g1').set({ name: 'Family', ownerId: ADMIN, members: [ADMIN], createdAt: '2026-10-01T00:00:00.000Z' });
  await db.doc('events/e1').set({ ownerId: ADMIN, groupId: 'g1', categoryId: 'hasOwnProperty', createdAt: { toDate: 5 }, title: 'x' });
  await db.doc('events/e2').set({ ownerId: ADMIN, groupId: 'g1', categoryId: { a: 1 }, createdAt: new Date().toISOString(), title: 'y' });
  await db.doc('games/x1').set({ groupId: 'g1', gameType: 'tic-tac-toe', status: '@type', createdAt: t });
  await db.doc('games/x2').set({ groupId: 'g1', gameType: { toString: 0 }, status: '__proto__', createdAt: t });
  await db.doc('assets/a1').set({ ownerId: ADMIN, category: 'toString', name: 'Card' });
});

describe('the Admin statistics on values a member could write', () => {
  it('a group called "constructor" with no events or games has 0 of each, and the list arrives', async () => {
    const res = overTheWire(await ask(fns.adminListGroups)) as { groups: Array<{ id: string; events: unknown; games: unknown }> };
    const odd = res.groups.find((g) => g.id === 'constructor')!;
    expect(odd).toMatchObject({ events: 0, games: 0 });
    expect(res.groups.find((g) => g.id === 'g1')).toMatchObject({ events: 2, games: 2 });
  });

  it('the statistics arrive, with the awkward keys counted in brackets and the rest in the fallback', async () => {
    const res = overTheWire(await ask(fns.adminGetStats)) as Record<string, any>;
    const text = JSON.stringify(res);
    expect(text).toContain('"[hasOwnProperty]":1');
    expect(text).toContain('"[@type]":1');
    expect(text).toContain('"[__proto__]":1');
    expect(text).toContain('"[toString]":1');
  });

  it('the growth chart arrives, a time that is not one counted nowhere', async () => {
    const res = overTheWire(await ask(fns.adminGetGrowth)) as { events: Array<{ count: number }>; games: Array<{ count: number }> };
    expect(res.events.reduce((a, d) => a + d.count, 0)).toBe(1);
    expect(res.games.reduce((a, d) => a + d.count, 0)).toBe(2);
  });
});
