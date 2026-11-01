// functions/test/gamePush.test.ts
//
// What a push may say (06.10.2026). A game's push used to be titled with its `gameType`, which
// was free text at creation, so any member could put any words on the lock screens of the whole
// group; the names in game and chat pushes came from `users`, which has no shape rule; and no push
// was cut to any length. Through the real triggers and the real notify(), on the Firestore
// emulator, with FCM replaced by a recorder (it is not emulated).

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

type Sent = { tokens: string[]; notification: { title: string; body: string }; data?: Record<string, string>; webpush?: Record<string, unknown> };
let sent: Sent[];
/** What FCM answers per token; success unless named here. */
let fcmErrors: Record<string, string>;
/** A whole call that throws, by the tokens it carries (credentials, an outage, an SDK refusal). */
let fcmThrows: ((tokens: string[]) => Error | null) | null;
/** Every single-message send, with its dry-run flag (notify asks FCM to validate a message it doubts). */
let dryRuns: Array<{ msg: Record<string, unknown>; dryRun: unknown }>;
/** What the dry run throws; it passes unless set. */
let dryRunError: unknown;

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
  fcmThrows = null;
  dryRuns = [];
  dryRunError = undefined;
  // Under the same stub as the multicast: nothing here may reach FCM, a dry run included.
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'send').mockImplementation(((msg: Record<string, unknown>, dryRun: unknown) => {
    dryRuns.push({ msg: JSON.parse(JSON.stringify(msg)), dryRun });
    // As firebase-admin does it: its own validation THROWS (synchronously), FCM's answer REJECTS.
    if (String((dryRunError as { code?: unknown } | undefined)?.code).includes('invalid-payload')) throw dryRunError;
    if (dryRunError) return Promise.reject(dryRunError);
    return Promise.resolve('projects/demo/messages/dry-run');
  }) as never);
  vi.spyOn(Object.getPrototypeOf(admin.messaging()), 'sendEachForMulticast').mockImplementation((async (msg: Sent) => {
    sent.push(JSON.parse(JSON.stringify(msg)));
    const thrown = fcmThrows?.(msg.tokens);
    if (thrown) throw thrown;
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

  // FCM's v1 API says INVALID_ARGUMENT both for a token that is no token and for a message it refuses,
  // and the Admin SDK reports both as `messaging/invalid-argument` (01.11.2026, pushTokens.ts).
  describe('invalid-argument: the token, or the message?', () => {
    /** Bob reads English too, so Bob and Carol share ONE send: one message, two tokens. */
    const oneSend = () => db.doc(`users/${BOB}`).update({ language: 'en-US' });
    const tokensOf = async (uid: string) => (await db.doc(`users/${uid}`).get()).get('fcmTokens');

    it('beside a token the same message reached, it is the token’s: pruned, with no dry run', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      const res = await send({ bodyText: 'hi' });
      expect(sent).toHaveLength(1);
      expect(res).toMatchObject({ pushed: 1, pruned: 1 });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await tokensOf(CAROL)).toEqual(['tok-carol']);
      expect(dryRuns).toEqual([]);
      expect(await errors()).toEqual([]);
    });

    it('refused for every token: a dry run of the SAME message, to a topic, decides', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-carol'] = 'messaging/invalid-argument';
      await send({ bodyText: 'hi' });
      expect(dryRuns).toHaveLength(1);
      expect(dryRuns[0].dryRun).toBe(true);
      const { tokens, ...message } = sent[0] as unknown as Record<string, unknown>;
      expect(tokens).toEqual(['tok-bob', 'tok-carol']);
      expect(dryRuns[0].msg).toEqual({ topic: 'payload-check', ...message });
    });

    it('the dry run passes: the message was fine, so the refused tokens were dead', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-carol'] = 'messaging/invalid-argument';
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 0, pruned: 2 });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await tokensOf(CAROL)).toEqual([]);
      expect(await errors()).toEqual([]);
    });

    it('the dry run refuses it too: the message is at fault, nobody loses a token, and it is reported', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-carol'] = 'messaging/invalid-argument';
      dryRunError = Object.assign(new Error('Invalid value at message.data'), { code: 'messaging/invalid-argument' });
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 0, pruned: 0 });
      expect(await tokensOf(BOB)).toEqual(['tok-bob']);
      expect(await tokensOf(CAROL)).toEqual(['tok-carol']);
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ context: 'notify:push', source: 'server' });
      expect(rows[0].message).toContain('refused for all 2 tokens');
      expect(rows[0].message).toContain('Invalid value at message.data');
    });

    it('the SDK refuses the dry run before it leaves (it throws, synchronously): reported, tokens stay', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-carol'] = 'messaging/registration-token-not-registered';
      dryRunError = Object.assign(new Error('data must only contain string values'), { code: 'messaging/invalid-payload' });
      const res = await send({ bodyText: 'hi' });
      // The gone token still goes: the throw must not skip the rest of the bucket's verdict.
      expect(res).toMatchObject({ pushed: 0, pruned: 1 });
      expect(await tokensOf(BOB)).toEqual(['tok-bob']);
      expect(await tokensOf(CAROL)).toEqual([]);
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toContain('data must only contain string values');
    });

    it('the dry run fails for another reason: it decides nothing, tokens stay, and the push that reached nobody is reported', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-carol'] = 'messaging/invalid-argument';
      dryRunError = Object.assign(new Error('unavailable'), { code: 'messaging/server-unavailable' });
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 0, pruned: 0 });
      expect(await tokensOf(BOB)).toEqual(['tok-bob']);
      expect(quiet.mock.calls.some((c) => String(c[0]).includes('the message check said nothing'))).toBe(true);
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('push reached none of 2 tokens: messaging/invalid argument');
    });

    it('one person’s two dead tokens are not evidence against the message: the dry run passes, both go', async () => {
      // Bob, alone in his language, with two devices he no longer uses: before the review this read as
      // "two refused, none delivered", blamed the message on every push and never pruned (01.11.2026).
      await db.doc(`users/${BOB}`).update({ fcmTokens: ['tok-bob', 'tok-bob-old'] });
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      fcmErrors['tok-bob-old'] = 'messaging/invalid-argument';
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 1, pruned: 2 });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await errors()).toEqual([]);
    });

    it('a lone token refused is judged by the dry run too: pruned when the message is fine', async () => {
      fcmErrors['tok-bob'] = 'messaging/invalid-argument';
      const res = await send({ bodyText: 'hi' });
      expect(sent).toHaveLength(2);
      expect(dryRuns).toHaveLength(1);
      expect(res).toMatchObject({ pushed: 1, pruned: 1 });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await errors()).toEqual([]);
    });

    it('a token FCM says is gone is pruned even when nothing was delivered, with no dry run', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/registration-token-not-registered';
      fcmErrors['tok-carol'] = 'messaging/internal-error';
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 0, pruned: 1 });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await tokensOf(CAROL)).toEqual(['tok-carol']);
      expect(dryRuns).toEqual([]);
    });
  });

  // A push that reached nobody used to leave no trace but the function's log; one bucket over 500
  // tokens made the whole call throw (01.11.2026, the review's leftovers).
  describe('a push that reaches nobody is reported; a big bucket goes in slices', () => {
    const oneSend = () => db.doc(`users/${BOB}`).update({ language: 'en-US' });
    const tokensOf = async (uid: string) => (await db.doc(`users/${uid}`).get()).get('fcmTokens');
    const many = (n: number) => Array.from({ length: n }, (_, i) => `b-${i}`);

    it('reached nobody, and not because the address is gone: one row with the codes and whose it was, tokens kept', async () => {
      fcmErrors['tok-bob'] = 'messaging/third-party-auth-error';
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 1, pruned: 0 });
      expect(await tokensOf(BOB)).toEqual(['tok-bob']);
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        message: 'push reached none of 1 tokens: messaging/third party auth error',
        context: 'notify:push', source: 'server', uid: BOB, stack: 'push type: test, language: ro-RO',
      });
    });

    it('one person’s device failing every push: one row a day for them, the rest only in Cloud Logging', async () => {
      fcmErrors['tok-bob'] = 'messaging/third-party-auth-error';
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await send({ bodyText: 'hi' });
      await send({ type: 'chat', bodyText: 'again' });
      await send({ type: 'reminder', bodyText: 'and again' });
      expect(await errors()).toHaveLength(1);
      expect(log.mock.calls.filter((c) => String(c[1]).startsWith('push reached none of 1 tokens'))).toHaveLength(2);
      expect((await db.doc(`push_unreached/${BOB}`).get()).data()).toEqual({
        day: new Date().toISOString().slice(0, 10), failures: ['messaging/third party auth error'],
      });
    });

    it('yesterday’s mark does not hold back today’s row', async () => {
      fcmErrors['tok-bob'] = 'messaging/third-party-auth-error';
      await db.doc(`push_unreached/${BOB}`).set({ day: '2000-01-01', failures: ['messaging/third party auth error'] });
      await send({ bodyText: 'hi' });
      expect(await errors()).toHaveLength(1);
      expect((await db.doc(`push_unreached/${BOB}`).get()).get('day')).toBe(new Date().toISOString().slice(0, 10));
    });

    it('a different failure for the same person the same day still gets its row', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fcmErrors['tok-bob'] = 'messaging/third-party-auth-error';
      await send({ bodyText: 'hi' });
      fcmErrors['tok-bob'] = 'messaging/server-unavailable';
      await send({ bodyText: 'again' });
      await send({ bodyText: 'and again' });
      expect((await errors()).map((r) => r.message).sort()).toEqual([
        'push reached none of 1 tokens: messaging/server unavailable',
        'push reached none of 1 tokens: messaging/third party auth error',
      ]);
    });

    it('a call that throws is not one person’s device: it is written each time', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fcmThrows = (tokens) => (tokens.includes('tok-bob') ? new Error('Failed to determine project ID for Messaging') : null);
      await send({ bodyText: 'hi' });
      await send({ bodyText: 'again' });
      expect(await errors()).toHaveLength(2);
      expect((await db.doc(`push_unreached/${BOB}`).get()).exists).toBe(false);
    });

    it('no mark is left for an account that is gone', async () => {
      fcmErrors['tok-bob'] = 'messaging/third-party-auth-error';
      // notify() read the tokens; the account was deleted before the mark: the read below stands in for it.
      const real = db.runTransaction.bind(db);
      vi.spyOn(db, 'runTransaction').mockImplementation((async (fn: never, opts: never) => {
        await db.doc(`users/${BOB}`).delete();
        return real(fn, opts);
      }) as never);
      await send({ bodyText: 'hi' });
      vi.restoreAllMocks();
      expect((await db.doc(`push_unreached/${BOB}`).get()).exists).toBe(false);
    });

    it('a failure that reaches several people is written each time (the daily cap bounds it)', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/server-unavailable';
      fcmErrors['tok-carol'] = 'messaging/server-unavailable';
      await send({ bodyText: 'hi' });
      await send({ type: 'chat', bodyText: 'again' });
      expect(await errors()).toHaveLength(2);
    });

    it('a send that reached somebody is not reported, whatever else failed in it', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/server-unavailable';
      await send({ bodyText: 'hi' });
      expect(await errors()).toEqual([]);
    });

    it('every address gone: pruned, and nothing to report', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/registration-token-not-registered';
      fcmErrors['tok-carol'] = 'messaging/registration-token-not-registered';
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 0, pruned: 2 });
      expect(await errors()).toEqual([]);
    });

    it('a bucket of several people names no one person', async () => {
      await oneSend();
      fcmErrors['tok-bob'] = 'messaging/server-unavailable';
      fcmErrors['tok-carol'] = 'messaging/message-rate-exceeded';
      await send({ bodyText: 'hi' });
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        message: 'push reached none of 2 tokens: messaging/message rate exceeded, messaging/server unavailable',
        uid: null,
      });
    });

    it('one token in two accounts (a shared device): the row names neither, and a dead one leaves both', async () => {
      await oneSend();
      await db.doc(`users/${BOB}`).update({ fcmTokens: ['tok-shared'] });
      await db.doc(`users/${CAROL}`).update({ fcmTokens: ['tok-shared'] });
      fcmErrors['tok-shared'] = 'messaging/server-unavailable';
      await send({ bodyText: 'hi' });
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ message: 'push reached none of 1 tokens: messaging/server unavailable', uid: null });
      fcmErrors['tok-shared'] = 'messaging/registration-token-not-registered';
      await send({ bodyText: 'again' });
      expect(await tokensOf(BOB)).toEqual([]);
      expect(await tokensOf(CAROL)).toEqual([]);
    });

    it('over 500 tokens: sent in slices of 500, and every one of them reached', async () => {
      await db.doc(`users/${BOB}`).update({ fcmTokens: many(600) });
      const res = await send({ bodyText: 'hi' });
      const bobs = sent.filter((m) => m.tokens.some((t) => t.startsWith('b-')));
      expect(bobs.map((m) => m.tokens.length)).toEqual([500, 100]);
      expect(new Set(bobs.flatMap((m) => m.tokens))).toEqual(new Set(many(600)));
      // The same message in every slice, the whole of it: one delivery in any slice is read as proof the
      // message is fine for the tokens of every other slice (pushTokens.ts, deadTokens).
      expect(new Set(bobs.map((m) => JSON.stringify({ ...m, tokens: undefined })))).toHaveProperty('size', 1);
      expect(bobs[1]).toMatchObject({
        data: { tag: expect.any(String) },
        webpush: { notification: { tag: expect.any(String) }, fcmOptions: { link: expect.any(String) } },
      });
      expect(res).toMatchObject({ pushed: 601, pruned: 0 });
      expect(await errors()).toEqual([]);
    });

    it('a slice that throws: its tokens stay, the rest are judged, and the push that reached nobody says why', async () => {
      await db.doc(`users/${BOB}`).update({ fcmTokens: many(501) });
      // A whole call that throws with nothing to say about its tokens (credentials surface per token).
      fcmThrows = (tokens) => (tokens.includes('b-0') ? new Error('Failed to determine project ID for Messaging') : null);
      fcmErrors['b-500'] = 'messaging/registration-token-not-registered';
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await send({ bodyText: 'hi' });
      // The trace of a slice that threw, whatever the other slices did.
      expect(log.mock.calls.some((c) => String(c[0]).includes('a push slice threw'))).toBe(true);
      expect(res).toMatchObject({ pruned: 1 });
      expect(await tokensOf(BOB)).toEqual(many(500));
      const rows = await errors();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('push reached none of 501 tokens: notify/send threw (Failed to determine project ID for Messaging)');
      expect(rows[0].uid).toBe(BOB);
    });

    it('a dropped HTTP/2 session: the slice’s real outcome, which firebase-admin hands over, is the one judged', async () => {
      await db.doc(`users/${BOB}`).update({ fcmTokens: many(500) });
      fcmThrows = (tokens) => (tokens.includes('b-0')
        ? Object.assign(new Error('Error while making requests: GOAWAY - , Error code: 0'), {
          pendingBatchResponse: Promise.resolve({
            successCount: 499,
            responses: many(500).map((t) => (t === 'b-1'
              ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
              : { success: true })),
          }),
        })
        : null);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pushed: 500, pruned: 1 });
      expect(await tokensOf(BOB)).toEqual(many(500).filter((t) => t !== 'b-1'));
      expect(await errors()).toEqual([]);
    });

    it('a late outcome that does not answer for every token of the slice is not used: it would pair the wrong ones', async () => {
      await db.doc(`users/${BOB}`).update({ fcmTokens: many(3) });
      fcmThrows = (tokens) => (tokens.includes('b-0') ? Object.assign(new Error('Error while making requests: GOAWAY'), {
        pendingBatchResponse: Promise.resolve({
          successCount: 0, responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }],
        }),
      }) : null);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await send({ bodyText: 'hi' });
      expect(res).toMatchObject({ pruned: 0 });
      expect(await tokensOf(BOB)).toEqual(many(3));
      expect((await errors()).map((r) => r.message)).toContain('push reached none of 3 tokens: notify/send threw (Error while making requests: GOAWAY)');
    });

    it('a recipient id that is not one document id gets nothing, and breaks nothing for the others', async () => {
      const res = await notifyMod.notify({ userIds: [`${BOB}/x/y`, CAROL], createdBy: ALICE, type: 'test', titleKey: 'notifNewMessage' });
      expect(res).toMatchObject({ rows: 1, pushed: 1 });
      expect((await rows()).map((r) => r.userId)).toEqual([CAROL]);
    });

    it('the slice is what firebase-admin takes in one call', async () => {
      const { FCM_BATCH } = await import('../src/pushTokens');
      const sdk = readFileSync(join(__dirname, '..', 'node_modules', 'firebase-admin', 'lib', 'messaging', 'messaging.js'), 'utf8');
      expect(sdk).toMatch(new RegExp(`FCM_MAX_BATCH_SIZE = ${FCM_BATCH};`));
    });
  });
});
