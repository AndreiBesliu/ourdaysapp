// rules-tests/games.test.ts
//
// The arcade, the Warlord battles, and the collections nothing but the server may touch.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────
//
// `games` carries two regimes in one collection: arcade games are client-authoritative — any
// member of the group may move a piece — while Warlord battles are server-authoritative and every
// mutation goes through a callable. A rule holding two regimes apart is a rule worth probing.
//
// It is also the third place today where the same shape turned up: `delete` is gated on a field
// that `update` leaves writable. `assets` carries a comment about it, `notifications` and `events`
// were repaired hours ago. Here the field is `createdBy`.

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALICE, BOB, CAROL, DAVE, G1, G2, as, resetWorld, seed, startEnv, stopEnv } from './_harness';
import { ARCADE_GAME_TYPES } from '../src/utils/gameSession';
import { buildMemoryBoard } from '../src/components/games/memoryThemes';
import { finalizeGameUpdate } from '../src/components/games/gameResult';

beforeAll(async () => { await startEnv('demo-ourdays-games'); });
afterAll(stopEnv);

beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'games', 'g-arcade'), {
      gameType: 'tictactoe', createdBy: ALICE, groupId: G1, board: ['', '', ''],
    });
    await setDoc(doc(db, 'games', 'g-battle'), {
      gameType: 'warlord-battle', createdBy: ALICE, groupId: null, players: [ALICE, BOB], turn: 1,
    });
    await setDoc(doc(db, 'warlordConfig', 'live'), { soldierCost: 10 });
    await setDoc(doc(db, 'warlordDomains', ALICE), { gold: 100 });
    await setDoc(doc(db, 'warlordDeploys', 'd1'), { battleId: 'g-battle', ownerId: ALICE });
    await setDoc(doc(db, 'reminder_log', 'r1'), { eventId: 'e1', day: '2026-09-19' });
    await setDoc(doc(db, 'aiLedger', 'l1'), { uid: ALICE, cost: 0.01 });
    await setDoc(doc(db, 'ai_budget', 'b1'), { limit: 5 });
    await setDoc(doc(db, 'aiSpendDaily', '2026-09-19'), { total: 0.42 });
    // `users`, not `byUser`. The rule is a `{sub=**}` catch-all so the test passed either way —
    // it was refusing a path the writer never writes, which proves nothing about the real one.
    // See `aiLedger.ts`: the rollup goes to `aiSpendDaily/{date}/users/{uid}`.
    await setDoc(doc(db, 'aiSpendDaily', '2026-09-19', 'users', ALICE), { total: 0.42 });
    await setDoc(doc(db, 'errorGroups', 'grp1'), { status: 'open', count: 3 });
    await setDoc(doc(db, 'jobRuns', 'sendDueReminders'), { at: 1, ok: true, detail: 'due 0', failStreak: 0 });
    await setDoc(doc(db, 'jobState', 'expireIdleGames'), { after: 'g1', lapRuns: 1, lastLapRuns: 1, at: 1 });
    await setDoc(doc(db, 'warlordPlayers', ALICE), { name: 'Alice', rank: 1, wins: 2, losses: 0 });
  });
});

describe('an arcade game: client-authoritative, but not owner-rewritable', () => {
  it('a group member plays — that is the whole point of the regime', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { board: ['X', '', ''] }));
  });

  it('somebody outside the group does not', async () => {
    await assertFails(updateDoc(doc(as(CAROL), 'games', 'g-arcade'), { board: ['O', '', ''] }));
  });

  it('only the creator may delete it', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'games', 'g-arcade')));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'games', 'g-arcade')));
  });

  it('and a member may not make themselves the creator to get there', async () => {
    // The shape found three times today. `delete` asks who created the game; `update` let any
    // member answer that question differently.
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { createdBy: BOB }));
  });

  it('nor turn it into a Warlord battle, which would freeze it beyond every client', async () => {
    // `update` and `delete` both refuse `gameType == 'warlord-battle'`. Flipping the field is
    // therefore a one-way door: the game becomes unplayable AND undeletable, by anybody.
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { gameType: 'warlord-battle' }));
  });

  it('nor move it into a group they are not in', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { groupId: G2 }));
  });
});

// ── 25.09.2026: an arcade game names no reader outside its group ─────────────────────────────
// The read rule grants a game to whoever its top-level `players` names — that is how a global
// Warlord battle is read by its two players. Arcade seats live in `state.players`, and no arcade
// client has ever written the top-level key, but nothing enforced it: a member could name a
// stranger and hand them the game, and put it in the stranger's "my battles" listener.

/** The installed APK's tic-tac-toe create, field for field from the bundle. */
const APK_TTT = (uid: string) => ({
  groupId: G1, date: '2026-09-25', gameType: 'tic-tac-toe', status: 'waiting',
  createdAt: serverTimestamp(), createdBy: uid,
  state: { board: Array(9).fill(null), xIsNext: true, players: { X: uid, O: null }, scores: { X: 0, O: 0 } },
  winner: null,
});

describe('an arcade game names no reader outside its group', () => {
  beforeEach(async () => {
    // A game that already carries the key — the case the rule must keep playable.
    await seed(async (db) => {
      await setDoc(doc(db, 'games', 'g-legacy'), { ...APK_TTT(ALICE), createdAt: new Date(), players: [DAVE] });
    });
  });

  it('a member cannot create one that names a stranger — nor one that names only themselves', async () => {
    await assertFails(addDoc(collection(as(BOB), 'games'), { ...APK_TTT(BOB), players: [DAVE] }));
    await assertFails(addDoc(collection(as(BOB), 'games'), { ...APK_TTT(BOB), players: [BOB] }));
  });

  it('a member cannot add it to a game in play, nor slip it into a real move', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { players: [DAVE] }));
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-arcade'), { board: ['X', '', ''], players: [DAVE] }));
  });

  it('so the stranger can neither open the game nor find it', async () => {
    await updateDoc(doc(as(BOB), 'games', 'g-arcade'), { players: [DAVE] }).catch(() => undefined);
    await assertFails(getDoc(doc(as(DAVE), 'games', 'g-arcade')));
    const mine = await getDocs(query(collection(as(DAVE), 'games'), where('players', 'array-contains', DAVE)));
    expect(mine.docs.map((d) => d.id)).toEqual(['g-legacy']);
  });

  it('a game that already carries the key stays playable', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'games', 'g-legacy'), { 'state.players.O': BOB, status: 'playing' }));
  });

  it('but its list cannot change', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-legacy'), { players: [DAVE, CAROL] }));
  });

  it('and a member may remove it, which takes the stranger\u2019s access away', async () => {
    await assertSucceeds(getDoc(doc(as(DAVE), 'games', 'g-legacy')));
    await assertSucceeds(updateDoc(doc(as(BOB), 'games', 'g-legacy'), { players: deleteField() }));
    await assertFails(getDoc(doc(as(DAVE), 'games', 'g-legacy')));
  });

  it('the Warlord "my battles" listener still proves', async () => {
    const mine = await getDocs(query(collection(as(ALICE), 'games'), where('players', 'array-contains', ALICE)));
    expect(mine.docs.map((d) => d.id)).toContain('g-battle');
  });
});

describe('a Warlord battle: the server owns it', () => {
  it('its two players may read it', async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), 'games', 'g-battle')));
    await assertSucceeds(getDoc(doc(as(BOB), 'games', 'g-battle')));
  });

  it('a bystander may not', async () => {
    await assertFails(getDoc(doc(as(CAROL), 'games', 'g-battle')));
  });

  it('neither player may move a piece directly', async () => {
    // Every mutation goes through a callable; the Admin SDK bypasses these rules.
    await assertFails(updateDoc(doc(as(ALICE), 'games', 'g-battle'), { turn: 2 }));
    await assertFails(updateDoc(doc(as(BOB), 'games', 'g-battle'), { turn: 2 }));
  });

  it('and neither may delete it, not even the one who started it', async () => {
    // Cancelling goes through forfeitWarlordBattle, which also clears the private deploy doc.
    await assertFails(deleteDoc(doc(as(ALICE), 'games', 'g-battle')));
  });

  it('a client cannot create one either', async () => {
    await assertFails(setDoc(doc(as(ALICE), 'games', 'g-new-battle'), {
      gameType: 'warlord-battle', createdBy: ALICE, groupId: G1, players: [ALICE, BOB],
    }));
  });

  it('the private deploy document is invisible to both of them', async () => {
    // The challenger's army, stashed out of the opponent's sight until they commit.
    await assertFails(getDoc(doc(as(BOB), 'warlordDeploys', 'd1')));
    await assertFails(getDoc(doc(as(ALICE), 'warlordDeploys', 'd1')));
  });
});

describe('the game’s balance configuration', () => {
  it('anybody signed in may read it — the client needs it to render numbers', async () => {
    await assertSucceeds(getDoc(doc(as(DAVE), 'warlordConfig', 'live')));
  });

  it('but only an admin may write it, and admin-ness lives where no client can reach', async () => {
    // `admins` is `if false` for every client, so the only way a row appears there is the Admin
    // SDK. That is what makes this rule hold: the gate is a document nobody can forge.
    await assertFails(updateDoc(doc(as(ALICE), 'warlordConfig', 'live'), { soldierCost: 1 }));
    await assertFails(setDoc(doc(as(DAVE), 'warlordConfig', 'cheap'), { soldierCost: 0 }));
  });
});

describe('a player’s own domain', () => {
  it('belongs to exactly one person', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'warlordDomains', ALICE), { gold: 200 }));
    await assertFails(getDoc(doc(as(BOB), 'warlordDomains', ALICE)));
    await assertFails(updateDoc(doc(as(BOB), 'warlordDomains', ALICE), { gold: 0 }));
  });
});

describe('the server-only collections really refuse', () => {
  // Each of these is `allow read, write: if false`. That is only true if nothing above grants —
  // this project has shipped a shadowed rule before, so the refusal is asserted, not assumed.
  it('the reminder dedupe log', async () => {
    // A writable row here suppresses somebody else's reminder; a readable one leaks which events
    // exist at all.
    await assertFails(getDoc(doc(as(ALICE), 'reminder_log', 'r1')));
    await assertFails(setDoc(doc(as(ALICE), 'reminder_log', 'r2'), { eventId: 'x' }));
  });

  it('the AI cost ledger and the budget counters', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'aiLedger', 'l1')));
    await assertFails(setDoc(doc(as(ALICE), 'aiLedger', 'l2'), { uid: ALICE, cost: 0 }));
    await assertFails(getDoc(doc(as(ALICE), 'ai_budget', 'b1')));
    await assertFails(updateDoc(doc(as(ALICE), 'ai_budget', 'b1'), { limit: 9999 }));
  });

  it('the scheduled-job run markers', async () => {
    // No rule names `jobRuns` at all (27.09.2026): Firestore refuses what nothing matches. Asserted
    // rather than assumed, because a writable marker could paint a stopped reminder job green — and
    // so a future wildcard that grants too much turns this red.
    await assertFails(getDoc(doc(as(ALICE), 'jobRuns', 'sendDueReminders')));
    await assertFails(setDoc(doc(as(ALICE), 'jobRuns', 'sendDueReminders'), { at: Date.now(), ok: true }));
    await assertFails(setDoc(doc(as(DAVE), 'jobRuns', 'logErrorDigest'), { at: Date.now(), ok: true }));
  });

  it('the game sweep’s cursor', async () => {
    // Also matched by no rule (10.10.2026). A client that could move it could keep the sweep away from
    // its own group's games for good, which is the defect the moving window exists to close.
    await assertFails(getDoc(doc(as(ALICE), 'jobState', 'expireIdleGames')));
    await assertFails(setDoc(doc(as(ALICE), 'jobState', 'expireIdleGames'), { after: '~', lapRuns: 0 }));
    await assertFails(getDocs(collection(as(ALICE), 'jobState')));
  });

  it('and none of them can be listed', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'reminder_log')));
    await assertFails(getDocs(collection(as(ALICE), 'aiLedger')));
    await assertFails(getDocs(collection(as(ALICE), 'jobRuns')));
  });
});

describe('the Warlord roster', () => {
  it('is readable by any signed-in account — recorded, not accidental', async () => {
    // The same trade as the profile mirror, and worth writing down for the same reason: the
    // roster is keyed by uid, so anybody signed in can enumerate every uid in the app. Nothing
    // else may depend on a uid being unguessable.
    await assertSucceeds(getDoc(doc(as(DAVE), 'warlordPlayers', ALICE)));
    await assertSucceeds(getDocs(collection(as(DAVE), 'warlordPlayers')));
  });

  it('only its owner writes it', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'warlordPlayers', ALICE), { name: 'Not Alice' }));
  });

  it('and not even its owner writes their own record', async () => {
    // A win is something the server awards. Left writable, the ladder is whatever you type.
    await assertFails(updateDoc(doc(as(ALICE), 'warlordPlayers', ALICE), { wins: 99 }));
  });

  it('nobody deletes one — that happens server-side when an account goes', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'warlordPlayers', ALICE)));
  });
});

describe('the last two server-only collections', () => {
  it('the daily AI spend rollup, and its per-person subcollection', async () => {
    // The subcollection matters separately: its `{sub=**}` is the only catch-all in the file,
    // and a catch-all that granted instead of refusing would be invisible from the parent.
    await assertFails(getDoc(doc(as(ALICE), 'aiSpendDaily', '2026-09-19')));
    await assertFails(getDoc(doc(as(ALICE), 'aiSpendDaily', '2026-09-19', 'users', ALICE)));
    await assertFails(setDoc(doc(as(ALICE), 'aiSpendDaily', '2026-09-19', 'users', ALICE), { total: 0 }));
  });

  it('and the error-group state an admin console writes', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'errorGroups', 'grp1')));
    await assertFails(updateDoc(doc(as(ALICE), 'errorGroups', 'grp1'), { status: 'fixed' }));
  });
});

// ── 06.10.2026: a game is one of the arcade's games ─────────────────────────────────────────
// The server made `gameType` the title of the push sent to every other member of the group, and
// the only check at creation was `!= 'warlord-battle'`: any member could put any words, at any
// length, on the lock screens of the whole group — or a number, on which the calendar's game
// banner crashed for everybody looking at that day.

/** The web's `state` for each game, as GamesHubModal's handleCreateGame builds it. */
const WEB_STATE: Record<string, (uid: string) => Record<string, unknown>> = {
  'tic-tac-toe': (uid) => ({
    board: Array(9).fill(null), xIsNext: true, players: { X: uid, O: null }, scores: { X: 0, O: 0 },
  }),
  'connect-4': (uid) => ({
    board: Object.fromEntries(Array.from({ length: 6 }, (_, r) => [String(r), Array(7).fill(null)])),
    p1IsNext: true, players: { P1: uid, P2: null }, scores: { P1: 0, P2: 0 }, winningCells: null,
  }),
  'rummy-45': (uid) => ({
    players: { [uid]: { uid, hand: [], hasMelded: false, score: 0 } }, playerIds: [uid],
    turnIndex: 0, turnPhase: 'draw', deck: [], discardPile: [], melds: [], round: 1,
  }),
  'memory-match': (uid) => ({
    board: buildMemoryBoard('animals'), theme: 'animals', flippedIndices: [], p1IsNext: true,
    players: { P1: uid, P2: null }, scores: { P1: 0, P2: 0 }, roundsWon: { P1: 0, P2: 0 }, moves: 0, streak: 0,
  }),
};

/** The web's create, field for field (GamesHubModal.tsx, handleCreateGame). */
const WEB_GAME = (uid: string, gameType: unknown) => ({
  groupId: G1, date: '2026-10-06', gameType, status: 'waiting',
  createdAt: serverTimestamp(), lastMoveAt: serverTimestamp(), createdBy: uid,
  // Own keys only: `'constructor' in WEB_STATE` is true of every object.
  state: WEB_STATE[typeof gameType === 'string' && Object.hasOwn(WEB_STATE, gameType) ? gameType : 'tic-tac-toe'](uid),
  winner: null,
});

describe('a game is one of the arcade\u2019s games', () => {
  it('the rule names exactly the list the app keeps', () => {
    // Both directions: a game the web offers but the rule lacks cannot be created; a value the
    // rule takes but the server cannot name is created without a push.
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');
    const m = rules.match(/request\.resource\.data\.gameType in \[([^\]]*)\]/);
    expect(m, 'the create rule lists the game types').not.toBeNull();
    const listed = [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    expect([...listed].sort()).toEqual([...ARCADE_GAME_TYPES].sort());
    expect(Object.keys(WEB_STATE).sort()).toEqual([...ARCADE_GAME_TYPES].sort());
  });

  it.each([...ARCADE_GAME_TYPES])('the web creates %s', async (gameType) => {
    await assertSucceeds(addDoc(collection(as(BOB), 'games'), WEB_GAME(BOB, gameType)));
  });

  it('anything else is refused, whatever it is', async () => {
    const refused: unknown[] = [
      'Free pizza \u2014 tap here', 'Tic Tac Toe', 'tictactoe', 'Tic-Tac-Toe', 'tic-tac-toe ', '', 'x'.repeat(5000),
      'constructor', '__proto__', null, 42, true, {}, ['tic-tac-toe'],
    ];
    for (const gameType of refused) {
      await assertFails(addDoc(collection(as(BOB), 'games'), WEB_GAME(BOB, gameType)));
    }
    const { gameType: _gone, ...noType } = WEB_GAME(BOB, 'tic-tac-toe');
    await assertFails(addDoc(collection(as(BOB), 'games'), noType));
    // The same payload, the same person, a real game: it is the type that is refused.
    await assertSucceeds(addDoc(collection(as(BOB), 'games'), WEB_GAME(BOB, 'tic-tac-toe')));
  });

  it('a Warlord battle is still the server\u2019s alone, with or without its players', async () => {
    await assertFails(addDoc(collection(as(BOB), 'games'), WEB_GAME(BOB, 'warlord-battle')));
  });

  it('once made, a game keeps its type', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'games', 'g-ttt'), { ...WEB_GAME(ALICE, 'tic-tac-toe'), createdAt: new Date(), lastMoveAt: new Date() });
    });
    const g = doc(as(BOB), 'games', 'g-ttt');
    await assertFails(updateDoc(g, { gameType: 'rummy-45' }));
    await assertFails(updateDoc(g, { gameType: 'Free pizza' }));
    await assertFails(updateDoc(g, { gameType: deleteField() }));
    await assertSucceeds(updateDoc(g, { 'state.players.O': BOB, status: 'playing' }));
  });

  it('a game\u2019s state is a map, and a rummy game\u2019s players a list: at creation and on every move', async () => {
    // The calendar's banner runs `state.playerIds.map` (the installed APK too): anything else
    // crashed the calendar for the whole group on that day.
    const rummy = WEB_GAME(BOB, 'rummy-45');
    for (const state of ['x', 5, ['a'], null]) {
      await assertFails(addDoc(collection(as(BOB), 'games'), { ...rummy, state }));
    }
    for (const playerIds of ['x', 5, { a: BOB }, null]) {
      await assertFails(addDoc(collection(as(BOB), 'games'), { ...rummy, state: { ...rummy.state, playerIds } }));
    }
    const made = await assertSucceeds(addDoc(collection(as(BOB), 'games'), rummy));
    const g = doc(as(ALICE), 'games', made.id);
    await assertFails(updateDoc(g, { 'state.playerIds': 'x' }));
    await assertFails(updateDoc(g, { 'state.playerIds': { 0: ALICE } }));
    await assertFails(updateDoc(g, { state: 'x' }));
    // The moves the game really makes.
    await assertSucceeds(updateDoc(g, { 'state.playerIds': [BOB, ALICE] }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'games', made.id), {
      state: { players: {}, playerIds: [BOB, ALICE], turnIndex: 0, turnPhase: 'draw', deck: [], discardPile: [], melds: [] },
      status: 'playing',
    }));
  });

  it('a game made before the rule stays playable, can be ended, and can be deleted', async () => {
    // `g-arcade` is 'tictactoe', which no client writes. Nothing on live is like either of these
    // (measured 06.10.2026: 18 games, all four kinds); this is what keeps them working if one is.
    await seed(async (db) => {
      await setDoc(doc(db, 'games', 'g-number'), { gameType: 42, createdBy: ALICE, groupId: G1, status: 'playing', state: {} });
    });
    for (const id of ['g-arcade', 'g-number']) {
      const g = doc(as(BOB), 'games', id);
      await assertSucceeds(updateDoc(g, { 'state.moves': 1 }));
      await assertSucceeds(updateDoc(g, finalizeGameUpdate({ gameType: id, state: {}, winner: BOB })));
      await assertSucceeds(deleteDoc(doc(as(ALICE), 'games', id)));
    }
  });
});

// ── 06.10.2026: what the installed APK reads of a game outside the game ─────────────────────
// The APK's calendar banner, arcade list and leaderboard read seats, `playerIds`, `winner`,
// `createdAt` and the id, and it cannot be repaired from here: a value of the wrong kind in any of
// them crashed its calendar or arcade for everybody in the group on that day.

/** A map with an own `toString`: it cannot become text, a key, or a number. */
const POISON = { toString: 0 };

describe('what the APK reads of a game outside it has the shape the games write', () => {
  const ttt = WEB_GAME(BOB, 'tic-tac-toe');
  const c4 = WEB_GAME(BOB, 'connect-4');
  const rummy = WEB_GAME(BOB, 'rummy-45');
  const withState = (g: typeof ttt, extra: Record<string, unknown>) => ({ ...g, state: { ...g.state, ...extra } });

  it('at creation: every seat a uid or empty, playerIds at most four uids, winner a uid or nothing', async () => {
    const refused: Record<string, unknown>[] = [
      withState(ttt, { players: { X: POISON, O: null } }),
      withState(ttt, { players: { X: BOB, O: 5 } }),
      withState(ttt, { players: { X: { uid: BOB }, O: null } }),
      withState(ttt, { players: 'x' }),
      withState(c4, { players: { P1: BOB, P2: POISON } }),
      withState(c4, { players: { P1: 7, P2: null } }),
      withState(rummy, { playerIds: [POISON] }),
      withState(rummy, { playerIds: [BOB, 5] }),
      withState(rummy, { playerIds: [BOB, ALICE, 'c', 'd', 'e'] }),
      withState(rummy, { playerIds: [BOB, ALICE, 5] }),
      withState(rummy, { playerIds: [BOB, ALICE, 'c', POISON] }),
      // On a game that is not rummy, where no player row stands in for the list: each place on its own.
      withState(ttt, { playerIds: [POISON] }),
      withState(ttt, { playerIds: [BOB, 5] }),
      withState(ttt, { playerIds: [BOB, ALICE, { a: 1 }] }),
      withState(ttt, { playerIds: [BOB, ALICE, 'c', 7] }),
      { ...ttt, winner: POISON },
      { ...ttt, winner: { a: 1 } },
      { ...ttt, winner: 5 },
      { ...ttt, winner: ['x'] },
    ];
    for (const g of refused) await assertFails(addDoc(collection(as(BOB), 'games'), g));
    // Controls: the games as the web writes them, and the most a rummy game ever holds.
    for (const g of [ttt, c4, rummy, withState(rummy, { playerIds: [BOB, ALICE, 'c', 'd'] }), withState(ttt, { playerIds: [BOB, ALICE, 'c', 'd'] }), { ...ttt, winner: BOB }]) {
      await assertSucceeds(addDoc(collection(as(BOB), 'games'), g));
    }
  });

  it('at creation: `createdAt` is the server\u2019s time, and there is no `id`', async () => {
    const { createdAt: _gone, ...noTime } = ttt;
    for (const g of [{ ...ttt, createdAt: 0 }, { ...ttt, createdAt: 'x' }, { ...ttt, createdAt: { toMillis: 1 } }, noTime]) {
      await assertFails(addDoc(collection(as(BOB), 'games'), g));
    }
    for (const id of ['another-game', POISON, '']) {
      await assertFails(addDoc(collection(as(BOB), 'games'), { ...ttt, id }));
    }
  });

  it('on a move: the same shapes, the same `createdAt`, still no `id`', async () => {
    const made = await assertSucceeds(addDoc(collection(as(BOB), 'games'), ttt));
    const madeRummy = await assertSucceeds(addDoc(collection(as(BOB), 'games'), rummy));
    const g = doc(as(ALICE), 'games', made.id);
    for (const change of [
      { 'state.players.O': POISON }, { 'state.players.O': 5 }, { 'state.players.X': { a: 1 } },
      { winner: POISON }, { winner: 5 },
      { createdAt: serverTimestamp() }, { createdAt: 0 }, { createdAt: deleteField() },
      { id: made.id }, { id: 'another-game' },
    ]) {
      await assertFails(updateDoc(g, change));
    }
    await assertFails(updateDoc(doc(as(ALICE), 'games', madeRummy.id), { 'state.playerIds': [BOB, 5] }));
    await assertFails(updateDoc(doc(as(ALICE), 'games', madeRummy.id), { 'state.playerIds': [BOB, ALICE, 'c', 'd', 'e'] }));
    // The moves the games really make, on the same two games.
    await assertSucceeds(updateDoc(g, { 'state.players.O': ALICE, status: 'playing' }));
    await assertSucceeds(updateDoc(g, { 'state.board': ['X', null, null, null, null, null, null, null, null], status: 'finished', winner: BOB }));
    await assertSucceeds(updateDoc(g, { 'state.board': Array(9).fill(null), status: 'playing', winner: null }));
    await assertSucceeds(updateDoc(g, finalizeGameUpdate({ gameType: 'tic-tac-toe', state: { players: { X: BOB, O: ALICE }, scores: { X: 1, O: 0 } } })));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'games', madeRummy.id), { 'state.playerIds': [BOB, ALICE] }));
  });

  it('a rummy game\u2019s player rows: keys among playerIds, each a map, its uid text and its score a number', async () => {
    // The APK's leaderboard reads `.uid` and `.score` off every row of every finished rummy game.
    const row = (extra: Record<string, unknown>) => ({ uid: BOB, hand: [], hasMelded: false, score: 0, ...extra });
    for (const players of [
      { [BOB]: null }, { [BOB]: 5 }, { [BOB]: row({ uid: POISON }) }, { [BOB]: row({ uid: 7 }) },
      { [BOB]: row({ score: POISON }) }, { [BOB]: row({ score: '3' }) }, { [BOB]: row({}), zz: row({ uid: 'zz' }) },
    ]) {
      await assertFails(addDoc(collection(as(BOB), 'games'), withState(rummy, { players })));
    }
    // Every one of the four places is checked, not only the first.
    const four = [BOB, ALICE, 'c', 'd'];
    const rows = Object.fromEntries(four.map((u) => [u, row({ uid: u })]));
    for (let i = 1; i < 4; i++) {
      await assertFails(addDoc(collection(as(BOB), 'games'), withState(rummy, { playerIds: four, players: { ...rows, [four[i]]: null } })));
      await assertFails(addDoc(collection(as(BOB), 'games'), withState(rummy, { playerIds: four, players: { ...rows, [four[i]]: row({ score: POISON }) } })));
    }
    await assertSucceeds(addDoc(collection(as(BOB), 'games'), withState(rummy, { playerIds: four, players: rows })));
    const made = await assertSucceeds(addDoc(collection(as(BOB), 'games'), rummy));
    const g = doc(as(ALICE), 'games', made.id);
    for (const change of [
      { 'state.players.zz': null }, { [`state.players.${BOB}`]: null }, { [`state.players.${BOB}.uid`]: POISON },
      { [`state.players.${BOB}.score`]: POISON }, { [`state.players.${BOB}.score`]: 'x' },
    ]) {
      await assertFails(updateDoc(g, change));
    }
    // What the game really writes: a join, a hand's penalty, a row the deal has not written yet.
    await assertSucceeds(updateDoc(g, {
      'state.playerIds': [BOB, ALICE],
      'state.players': { [BOB]: row({}), [ALICE]: row({ uid: ALICE }) },
    }));
    await assertSucceeds(updateDoc(g, { [`state.players.${BOB}.score`]: -12, [`state.players.${ALICE}.score`]: 0 }));
    await assertSucceeds(updateDoc(g, { 'state.players': {} }));
  });

  it('a game made before, with an older `createdAt` or none, stays playable', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'games', 'g-dated'), { ...ttt, createdAt: new Date('2026-05-10T10:00:00Z') });
      await setDoc(doc(db, 'games', 'g-undated'), { gameType: 'tic-tac-toe', createdBy: ALICE, groupId: G1, status: 'waiting', state: {} });
    });
    for (const id of ['g-dated', 'g-undated', 'g-arcade']) {
      await assertSucceeds(updateDoc(doc(as(BOB), 'games', id), { status: 'playing' }));
    }
  });
});

// ── 10.10.2026: what the idle sweep reads of a game ─────────────────────────────────────────────
// The hourly sweep reads `lastMoveAt`, `date` and `finalized` of every game (with `gameType` and
// `createdAt`, typed above), and nothing typed them: a member could make each a megabyte of text,
// and a page of such games could run the sweep out of memory. Each is now what the clients write:
// `lastMoveAt` the moment of the write (the web's `serverTimestamp()`; the installed APK never
// writes it), `date` a day `yyyy-MM-dd` (both clients, through `format`), `finalized` a bool (the
// web's End and the sweep write `true`; the APK never). Judged on every key at creation and on the
// keys a write changes, so a game holding something older stays playable. Measured on live that
// day: 18 games, no `lastMoveAt`, 14 dates all days, 4 without, `finalized` true on all 18.

async function refused(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

describe('what the idle sweep reads of a game has the shape the clients write', () => {
  const ttt = WEB_GAME(BOB, 'tic-tac-toe');
  const HUGE = 'x'.repeat(200_000);
  const past = () => Timestamp.fromMillis(Date.now() - 3 * 86_400_000);
  const future = () => Timestamp.fromMillis(Date.now() + 3 * 86_400_000);

  it('at creation', async () => {
    for (const lastMoveAt of [HUGE, '2026-10-10T00:00:00.000Z', 0, null, POISON, past(), future()]) {
      await refused(addDoc(collection(as(BOB), 'games'), { ...ttt, lastMoveAt }));
    }
    for (const date of [
      HUGE, HUGE + '2026-10-06', 'x2026-10-06', '9'.repeat(200_000) + '-10-06', '12026-10-06', '026-10-06',
      '2026-10-6', '2026-13-01', '2026-00-15', '2026-10-32', '2026-10-00',
      '2026-10-06T10:00:00Z', '', 20261006, null, POISON,
    ]) {
      await refused(addDoc(collection(as(BOB), 'games'), { ...ttt, date }));
    }
    for (const finalized of [HUGE, 'true', 1, null, POISON]) {
      await refused(addDoc(collection(as(BOB), 'games'), { ...ttt, finalized }));
    }
    // Controls: the web's create, the installed APK's (no `lastMoveAt`), no `date` at all, and a bool.
    const { date: _noDate, ...undated } = ttt;
    for (const g of [ttt, APK_TTT(BOB), undated, { ...ttt, finalized: false }]) {
      await assertSucceeds(addDoc(collection(as(BOB), 'games'), g));
    }
    // Every day a calendar can pick, through each branch of the pattern, from both clients.
    for (const date of ['2026-01-01', '2026-02-09', '2026-09-10', '2026-10-15', '2026-11-19', '2026-11-20', '2026-12-29', '2026-12-30', '2026-12-31']) {
      await assertSucceeds(addDoc(collection(as(BOB), 'games'), { ...ttt, date }));
      await assertSucceeds(addDoc(collection(as(BOB), 'games'), { ...APK_TTT(BOB), date }));
    }
  });

  it('on a move', async () => {
    const made = await assertSucceeds(addDoc(collection(as(BOB), 'games'), ttt));
    const g = doc(as(ALICE), 'games', made.id);
    for (const change of [
      { lastMoveAt: HUGE }, { lastMoveAt: past() }, { lastMoveAt: future() }, { lastMoveAt: 0 }, { lastMoveAt: deleteField() },
      { date: HUGE }, { date: HUGE + '2026-10-06' }, { date: '12026-10-06' }, { date: '2026-1-1' }, { date: 5 }, { date: null },
      { finalized: HUGE }, { finalized: 'true' }, { finalized: 1 }, { finalized: null },
    ]) {
      await refused(updateDoc(g, change));
    }
    // The writes the games really make: the web's (every one stamps `lastMoveAt`), the APK's (none
    // does), the web's End.
    await assertSucceeds(updateDoc(g, { 'state.players.O': ALICE, status: 'playing', lastMoveAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(g, { 'state.board': Array(9).fill(null), status: 'playing' }));
    await assertSucceeds(updateDoc(g, { ...finalizeGameUpdate({ gameType: 'tic-tac-toe', state: {} }), lastMoveAt: serverTimestamp() }));
  });

  it('a game that already holds something else stays playable and can be ended', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'games', 'g-odd'), { ...APK_TTT(ALICE), createdAt: new Date(), lastMoveAt: HUGE, date: 5, finalized: 'yes' });
    });
    const g = doc(as(BOB), 'games', 'g-odd');
    await assertSucceeds(updateDoc(g, { 'state.players.O': BOB, status: 'playing' }));
    await assertSucceeds(updateDoc(g, { 'state.moves': 1, lastMoveAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(g, { ...finalizeGameUpdate({ gameType: 'tic-tac-toe', state: {} }), lastMoveAt: serverTimestamp() }));
  });
});
