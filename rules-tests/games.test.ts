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
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { ALICE, BOB, CAROL, DAVE, G1, G2, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

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

  it('and none of them can be listed', async () => {
    await assertFails(getDocs(collection(as(ALICE), 'reminder_log')));
    await assertFails(getDocs(collection(as(ALICE), 'aiLedger')));
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
