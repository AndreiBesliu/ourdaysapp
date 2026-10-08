// functions/test/gamePush.test.ts
//
// What a push may say (06.10.2026). A game's push used to be titled with its `gameType`, which
// was free text at creation, so any member could put any words on the lock screens of the whole
// group; the names in game and chat pushes came from `users`, which has no shape rule; and no push
// was cut to any length. Through the real triggers and the real notify(), on the Firestore
// emulator, with FCM replaced by a recorder (it is not emulated).

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';

type Fn = { run: (arg: unknown) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;
let notifyMod: typeof import('../src/notify');

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';
const G = 'group-one';

type Sent = { tokens: string[]; notification: { title: string; body: string } };
let sent: Sent[];
/** What FCM answers per token; success unless named here. */
let fcmErrors: Record<string, string>;

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  notifyMod = await import('../src/notify');
  db = admin.firestore();
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  sent = [];
  fcmErrors = {};
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'sendEachForMulticast').mockImplementation((async (msg: Sent) => {
    sent.push(JSON.parse(JSON.stringify(msg)));
    const responses = msg.tokens.map((tok) => (fcmErrors[tok]
      ? { success: false, error: { code: fcmErrors[tok] } }
      : { success: true }));
    return { successCount: responses.filter((r) => r.success).length, failureCount: 0, responses };
  }) as never);
  await db.doc(`groups/${G}`).set({ ownerId: ALICE, members: [ALICE, BOB, CAROL], name: 'Family' });
  await db.doc(`users/${ALICE}`).set({ name: 'Alice', language: 'en-US', fcmTokens: ['tok-alice'] });
  await db.doc(`users/${BOB}`).set({ name: 'Bob', language: 'ro-RO', fcmTokens: ['tok-bob'] });
  await db.doc(`users/${CAROL}`).set({ name: 'Carol', language: 'en-US', fcmTokens: ['tok-carol'] });
});

afterEach(() => { vi.restoreAllMocks(); });

let n = 0;
/** A game as the database holds it (written with the Admin SDK, so no rule stands in the way). */
async function createGame(fields: Record<string, unknown>) {
  const ref = db.doc(`games/game-${++n}`);
  await ref.set({ groupId: G, createdBy: ALICE, status: 'waiting', state: {}, winner: null, ...fields });
  await fn.onGameCreated.run({ data: await ref.get(), params: { gameId: ref.id } });
  return ref.id;
}

const rows = async () => (await db.collection('notifications').get()).docs.map((d) => d.data());
const errors = async () => (await db.collection('errorLogs').get()).docs.map((d) => d.data());

describe('a game’s push names one of the games, never what the document says', () => {
  // What the server wrote for each before 06.10.2026, when it title-cased `gameType` itself:
  // 'tic-tac-toe' → 'Tic Tac Toe'. Written out by hand, so a change of wording is seen here.
  const BEFORE: [string, string][] = [
    ['tic-tac-toe', 'Tic Tac Toe'],
    ['connect-4', 'Connect 4'],
    ['rummy-45', 'Rummy 45'],
    ['memory-match', 'Memory Match'],
    ['warlord-battle', 'Warlord Battle'],
  ];

  it.each(BEFORE)('%s is still called “%s”, in the bell and in the push, in each reader’s language', async (gameType, name) => {
    await createGame({ gameType });
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r]));
    expect(Object.keys(byUser).sort()).toEqual([BOB, CAROL]); // never the one who started it
    expect(byUser[BOB]).toMatchObject({ type: 'game', titleKey: 'notifNewGame', titleParam: name, title: `Joc nou: ${name}`, param: 'Alice', body: 'Pornit de Alice' });
    expect(byUser[CAROL]).toMatchObject({ titleParam: name, title: `New game: ${name}`, body: 'Started by Alice' });
    const titles = sent.map((s) => s.notification.title).sort();
    expect(titles).toEqual([`Joc nou: ${name}`, `New game: ${name}`].sort());
    expect(await errors()).toEqual([]);
  });

  const ODD: [string, unknown, string][] = [
    ['words', 'FREE PIZZA - tap here', 'string, 21 characters'],
    ['a name an object inherits', 'constructor', 'string, 11 characters'],
    ['an empty string', '', 'string, 0 characters'],
    ['a number', 42, 'number'],
    ['a map', { x: 1 }, 'object'],
    ['nothing at all', undefined, 'undefined'],
  ];

  it.each(ODD)('%s: no bell row, no push, and a log that does not repeat it', async (_label, gameType, said) => {
    const id = await createGame(gameType === undefined ? {} : { gameType });
    expect(await rows()).toEqual([]);
    expect(sent).toEqual([]);
    const logged = await errors();
    expect(logged).toEqual([expect.objectContaining({
      message: `game ${id} not announced: its type is not one of the games (${said})`,
      context: 'games:onGameCreated',
      uid: ALICE,
    })]);
    expect(JSON.stringify(logged)).not.toContain('PIZZA');
  });

  it('an announcement that fails is logged against whoever started the game, not only printed', async () => {
    const realDoc = db.doc.bind(db);
    vi.spyOn(db, 'doc').mockImplementation(((path: string) => {
      const ref = realDoc(path);
      if (path === `users/${ALICE}`) {
        return Object.assign(Object.create(Object.getPrototypeOf(ref)), ref, {
          get: () => Promise.reject(new Error('users unavailable')),
        });
      }
      return ref;
    }) as never);
    await createGame({ gameType: 'connect-4' });
    vi.mocked(db.doc).mockRestore();
    expect(await rows()).toEqual([]);
    expect(await errors()).toEqual([expect.objectContaining({
      message: 'game announcement failed: Error: users unavailable', context: 'games:onGameCreated', uid: ALICE,
    })]);
  });

  it('a game outside any group (a global Warlord battle) announces nothing and logs nothing', async () => {
    await createGame({ gameType: 'warlord-battle', groupId: null });
    expect(await rows()).toEqual([]);
    expect(await errors()).toEqual([]);
  });
});

describe('the name of whoever started it, or sent the message', () => {
  const nameOnGame = async (user: Record<string, unknown>) => {
    await db.doc(`users/${ALICE}`).set(user);
    await createGame({ gameType: 'tic-tac-toe' });
    return (await rows()).map((r) => r.param);
  };

  it('a name of any length is cut to 40', async () => {
    const got = await nameOnGame({ name: 'A'.repeat(5000) });
    expect(got).toEqual(['A'.repeat(40), 'A'.repeat(40)]);
    for (const s of sent) expect(s.notification.body.length).toBeLessThanOrEqual(60);
  });

  it('a name on several lines is one line', async () => {
    expect(await nameOnGame({ name: '  Ana\n\n\tMaria \u0007 ' })).toEqual(['Ana Maria', 'Ana Maria']);
  });

  it('a name that is not text falls back to the email’s first part, and the push still goes', async () => {
    expect(await nameOnGame({ name: { first: 'Ana' }, email: 'ana.pop@example.com' })).toEqual(['ana.pop', 'ana.pop']);
    expect(sent).toHaveLength(2);
  });

  it('nothing at all is “Someone”', async () => {
    expect(await nameOnGame({ email: 42 })).toEqual(['Someone', 'Someone']);
  });

  it('a group chat message: the same name, and a body of any length cut to 500', async () => {
    await db.doc(`users/${ALICE}`).set({ name: { first: 'Ana' }, email: 'ana@example.com' });
    const msg = db.doc(`groups/${G}/messages/m1`);
    await msg.set({ senderId: ALICE, text: 'x'.repeat(5000) });
    await fn.onMessageCreated.run({ data: await msg.get(), params: { groupId: G, messageId: 'm1' } });
    const got = await rows();
    expect(got.map((r) => r.titleParam)).toEqual(['ana', 'ana']);
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.notification.title).toMatch(/ana$/);
      expect(s.notification.body).toBe('x'.repeat(500));
    }
  });
});

describe('a group message whose text is not text', () => {
  it('is announced as a message, never as "[object Object]" (08.10.2026)', async () => {
    const msg = db.doc(`groups/${G}/messages/m-map`);
    await msg.set({ senderId: ALICE, text: { a: 1 }, imageUrl: null });
    await fn.onMessageCreated.run({ data: await msg.get(), params: { groupId: G, messageId: 'm-map' } });
    const got = await rows();
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(r.bodyKey).toBe('notifSentMessage');
      expect(r.body).not.toContain('[object Object]');
    }
    for (const s of sent) expect(s.notification.body).not.toContain('[object Object]');
  });
});

describe('every push is cut like its bell row, and never through a character', () => {
  const send = (spec: Partial<import('../src/notify').NotifySpec>) => notifyMod.notify({
    userIds: [BOB, CAROL], createdBy: ALICE, type: 'test', titleKey: 'notifNewMessage', ...spec,
  });

  it('title at most 200, body at most 500, the whole message far under FCM’s 4 KB', async () => {
    // The widest text there is in UTF-8: three bytes for every unit (a CJK character).
    await send({ titleParam: '中'.repeat(5000), bodyText: '中'.repeat(5000) });
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.notification.title.length).toBeLessThanOrEqual(200);
      expect(s.notification.body.length).toBe(500);
      expect(Buffer.byteLength(JSON.stringify(s), 'utf8')).toBeLessThan(4096);
    }
    for (const r of await rows()) {
      expect(r.title.length).toBeLessThanOrEqual(200);
      expect(r.titleParam.length).toBe(200);
      expect(r.body.length).toBe(500);
    }
  });

  it('a cut that falls inside an emoji drops the half, in the push and in the bell', async () => {
    await send({ titleText: 'a'.repeat(199) + '\u{1F600}', bodyText: 'b'.repeat(499) + '\u{1F600}' });
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.notification.title).toBe('a'.repeat(199));
      expect(s.notification.body).toBe('b'.repeat(499));
    }
    const got = await rows();
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(r.title).toBe('a'.repeat(199));
      expect(r.body).toBe('b'.repeat(499));
    }
  });

  it('half an emoji that arrives already cut is dropped wherever it is', async () => {
    // The reminders cut event titles at 120 units before they get here. Long enough (45 units) that
    // the emulator would store a lone half as U+FFFD rather than refuse it.
    const title = 'D'.repeat(45);
    await send({ titleParam: `${title}\uD83D`, bodyText: 'x\uDE00y' });
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.notification.title).toMatch(new RegExp(`${title}$`));
      expect(s.notification.body).toBe('xy');
    }
    const got = await rows();
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(r.titleParam).toBe(title);
      expect(r.title).toMatch(new RegExp(`${title}$`));
      expect(r.body).toBe('xy');
    }
  });

  it('a key with a parameter is cut the same way, in the push and in the bell', async () => {
    await send({ bodyKey: 'notifNewGameBody', param: 'a'.repeat(199) + '\u{1F600}' + 'x'.repeat(5000) });
    expect(sent).toHaveLength(2);
    for (const s of sent) expect(s.notification.body.length).toBe(500);
    const got = await rows();
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(r.param).toBe('a'.repeat(199));
      expect(r.body.length).toBe(500);
    }
  });

  it('short text is untouched, and a whole emoji is kept', async () => {
    await send({ titleParam: 'Ana \u{1F600}', bodyText: 'see you \u{1F600}' });
    const carol = sent.find((s) => s.tokens.includes('tok-carol'))!;
    expect(carol.notification).toEqual({ title: 'New message from Ana \u{1F600}', body: 'see you \u{1F600}' });
  });

  it('a token FCM says is gone is still pruned, and only that one', async () => {
    fcmErrors['tok-bob'] = 'messaging/registration-token-not-registered';
    const res = await send({ bodyText: 'hi' });
    expect(res).toMatchObject({ rows: 2, pushed: 1, pruned: 1 });
    expect((await db.doc(`users/${BOB}`).get()).get('fcmTokens')).toEqual([]);
    expect((await db.doc(`users/${CAROL}`).get()).get('fcmTokens')).toEqual(['tok-carol']);
  });
});
