// functions/test/adminRoster.test.ts
//
// The owner level of the admin (07.11.2026), through the real callables on the Firestore and Auth emulators: only an
// owner changes the roster; the role is read from Firestore on every call, so it is given and taken at once; the floors
// (an admin, an owner) hold, also for two owners at once; an owner named in the server's settings is made one at their
// next call and is neither demoted nor removed; the AI budget's "riskier" direction follows the same role.
// The rules themselves are tested without the emulator in src/utils/adminRoles.test.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

const PROJECT = process.env.GCLOUD_PROJECT || '';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';

// The bootstrap list is read when the functions module loads: set before the import below, put back after.
const BOSS_EMAIL = 'boss@example.test';
const bootstrapBefore = process.env.BOOTSTRAP_ADMIN_EMAILS;
process.env.BOOTSTRAP_ADMIN_EMAILS = BOSS_EMAIL;

type Fn = { run: (arg: unknown) => Promise<any> };
let fn: Record<string, Fn>;
let db: admin.firestore.Firestore;

const BOSS = 'uid-boss'; // named in BOOTSTRAP_ADMIN_EMAILS, verified
const OWNER = 'uid-owner'; // an owner by their row
const ADMIN = 'uid-admin'; // a plain admin
const MEMBER = 'uid-member'; // not an admin
const SQUAT = 'uid-squat'; // the bootstrap address on a second account, unverified

const EMAIL: Record<string, string> = {
  [BOSS]: BOSS_EMAIL, [OWNER]: 'owner@example.test', [ADMIN]: 'admin@example.test', [MEMBER]: 'member@example.test',
};

const nowS = () => Math.floor(Date.now() / 1000);

/** A call from `uid`, signed in just now unless `token` says otherwise (the owner's actions need a recent sign-in). */
function call(name: string, uid: string | null, data: unknown, token: Record<string, unknown> = {}) {
  return fn[name].run({
    data,
    ...(uid ? { auth: { uid, token: { uid, email: EMAIL[uid], email_verified: true, auth_time: nowS(), ...token } } } : {}),
    rawRequest: {},
  } as unknown as CallableRequest<unknown>);
}
const setAdmin = (caller: string, data: unknown) => call('adminSetAdmin', caller, data);
const row = async (uid: string) => (await db.doc(`admins/${uid}`).get()).data();
/** The roster log, oldest first, without its timestamps (checked on their own). */
const logged = async () => (await db.collection('adminRosterLog').orderBy('at').get()).docs.map((d) => {
  const { at, ...rest } = d.data();
  expect(at).toBeInstanceOf(admin.firestore.Timestamp);
  return rest;
});
const roster = async () => Object.fromEntries((await db.collection('admins').get()).docs.map((d) => [d.id, d.get('role') ?? null]));

beforeAll(async () => {
  expect(FS, 'run through `npm run test:rules`').not.toBe('');
  expect(AUTH, 'the Auth emulator runs with `npm run test:rules`').not.toBe('');
  expect(PROJECT.startsWith('demo-'), `project "${PROJECT}" is not a demo project`).toBe(true);
  fn = (await import('../src/index')) as unknown as Record<string, Fn>;
  db = admin.firestore();
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  if (bootstrapBefore === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAILS;
  else process.env.BOOTSTRAP_ADMIN_EMAILS = bootstrapBefore;
});

beforeEach(async () => {
  expect((await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
  expect((await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })).ok).toBe(true);
  for (const uid of [BOSS, OWNER, ADMIN, MEMBER]) await admin.auth().createUser({ uid, email: EMAIL[uid], emailVerified: true });
  await db.doc(`admins/${OWNER}`).set({ email: EMAIL[OWNER], role: 'owner' });
  await db.doc(`admins/${ADMIN}`).set({ email: EMAIL[ADMIN] }); // a row from before 07.11.2026: no role
});

describe('only an owner changes the roster', () => {
  it.each([
    ['grant', { email: EMAIL[MEMBER], makeAdmin: true }],
    ['make an owner (themselves too)', { uid: ADMIN, makeAdmin: true, role: 'owner' }],
    ['demote an owner', { uid: OWNER, makeAdmin: true, role: 'admin' }],
    ['revoke', { uid: OWNER, makeAdmin: false }],
  ])('a plain admin cannot %s; nothing is written', async (_, data) => {
    await expect(setAdmin(ADMIN, data)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await roster()).toEqual({ [OWNER]: 'owner', [ADMIN]: null });
  });

  it('refused before the request is read: a plain admin learns nothing, not even whether an address has an account', async () => {
    // The rules inside the transaction would refuse them too; this is the gate in front of them.
    await expect(setAdmin(ADMIN, { email: 'nobody@example.test', makeAdmin: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setAdmin(ADMIN, { uid: ADMIN, makeAdmin: true, role: 'root' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('nor a member, nor nobody signed in', async () => {
    await expect(setAdmin(MEMBER, { email: EMAIL[MEMBER], makeAdmin: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call('adminSetAdmin', null, { email: EMAIL[MEMBER], makeAdmin: true })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await roster()).toEqual({ [OWNER]: 'owner', [ADMIN]: null });
  });

  it('an owner grants by email (the form the web screen sends): a new admin is an admin, with who added them', async () => {
    const res = await setAdmin(OWNER, { email: EMAIL[MEMBER], makeAdmin: true });
    expect(res).toMatchObject({ ok: true, uid: MEMBER, makeAdmin: true, role: 'admin', changed: true });
    expect(await row(MEMBER)).toMatchObject({ email: EMAIL[MEMBER], role: 'admin', addedBy: OWNER });
    expect((await row(MEMBER))!.addedAt).toBeInstanceOf(admin.firestore.Timestamp);
  });

  it('the way the client SDK sends a field left undefined, as null, is "not given" (the web admin screen)', async () => {
    // Found on the bench (07.11.2026): `grant(undefined, uid)` arrives as `{ email: null, uid }`.
    await expect(setAdmin(OWNER, { email: null, uid: MEMBER, makeAdmin: true, role: 'owner' })).resolves.toMatchObject({ role: 'owner', changed: true });
    await expect(setAdmin(OWNER, { email: EMAIL[ADMIN], uid: null, makeAdmin: false })).resolves.toMatchObject({ changed: true });
    expect(await roster()).toEqual({ [OWNER]: 'owner', [MEMBER]: 'owner' });
  });

  it('"Make admin" on an owner does not demote them', async () => {
    await expect(setAdmin(OWNER, { uid: OWNER, makeAdmin: true })).resolves.toMatchObject({ role: 'owner', changed: false });
    expect(await row(OWNER)).toEqual({ email: EMAIL[OWNER], role: 'owner' });
  });
});

describe('the role is read from Firestore on every call', () => {
  it('made an owner, they can change the roster at once, with the same token as before', async () => {
    const addedAt = admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 8, 1));
    await db.doc(`admins/${ADMIN}`).set({ email: EMAIL[ADMIN], addedBy: OWNER, addedAt });
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    // Only the role and who set it, when: the rest of the row stays.
    expect(await row(ADMIN)).toEqual({
      email: EMAIL[ADMIN], addedBy: OWNER, addedAt, role: 'owner', roleSetBy: OWNER, roleSetAt: expect.any(admin.firestore.Timestamp),
    });
    await expect(setAdmin(ADMIN, { email: EMAIL[MEMBER], makeAdmin: true })).resolves.toMatchObject({ ok: true });
  });

  it('demoted, they are refused at once', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    await setAdmin(ADMIN, { uid: OWNER, makeAdmin: true, role: 'admin' });
    expect(await roster()).toEqual({ [OWNER]: 'admin', [ADMIN]: 'owner' });
    await expect(setAdmin(OWNER, { email: EMAIL[MEMBER], makeAdmin: true })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('the list says each admin\'s role; a row from before the owner level is an admin', async () => {
    const { admins } = await call('adminListAdmins', ADMIN, {});
    const byUid = Object.fromEntries(admins.map((a: any) => [a.uid, a]));
    expect(byUid[OWNER]).toMatchObject({ role: 'owner', bootstrap: false });
    expect(byUid[ADMIN]).toMatchObject({ role: 'admin', bootstrap: false });
  });
});

describe('the floors: always an admin, always an owner', () => {
  it('the last owner can neither demote nor remove themselves', async () => {
    await expect(setAdmin(OWNER, { uid: OWNER, makeAdmin: true, role: 'admin' })).rejects.toMatchObject({ code: 'failed-precondition', message: "Can't demote the last owner." });
    await expect(setAdmin(OWNER, { uid: OWNER, makeAdmin: false })).rejects.toMatchObject({ code: 'failed-precondition', message: "Can't remove the last owner." });
    expect(await roster()).toEqual({ [OWNER]: 'owner', [ADMIN]: null });
  });

  it('two owners demoting each other at once: one of them stays an owner', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    const results = await Promise.allSettled([
      setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'admin' }),
      setAdmin(ADMIN, { uid: OWNER, makeAdmin: true, role: 'admin' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Object.values(await roster()).filter((r) => r === 'owner')).toHaveLength(1);
  });

  it('two owners removing each other at once: one of them stays', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    await Promise.allSettled([
      setAdmin(OWNER, { uid: ADMIN, makeAdmin: false }),
      setAdmin(ADMIN, { uid: OWNER, makeAdmin: false }),
    ]);
    expect(Object.values(await roster())).toEqual(['owner']);
  });
});

describe('the owner named in the server\'s settings (BOOTSTRAP_ADMIN_EMAILS)', () => {
  it('first call: provisioned as an owner', async () => {
    await expect(call('adminCheck', BOSS, {})).resolves.toEqual({ isAdmin: true });
    expect(await row(BOSS)).toMatchObject({ email: BOSS_EMAIL, addedBy: 'bootstrap', role: 'owner' });
  });

  it('a row from before 07.11.2026 (no role) becomes an owner at the next admin call; who added it, and when, stay', async () => {
    const addedAt = admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 7, 2));
    await db.doc(`admins/${BOSS}`).set({ email: BOSS_EMAIL, addedBy: 'bootstrap', addedAt });
    await call('adminCheck', BOSS, {});
    expect(await row(BOSS)).toEqual({ email: BOSS_EMAIL, addedBy: 'bootstrap', addedAt, role: 'owner' });
  });

  it('demoted by hand in the console, an owner again at the next call', async () => {
    await db.doc(`admins/${BOSS}`).set({ email: BOSS_EMAIL, role: 'admin' });
    await expect(setAdmin(BOSS, { email: EMAIL[MEMBER], makeAdmin: true })).resolves.toMatchObject({ ok: true });
    expect((await row(BOSS))!.role).toBe('owner');
  });

  it('another owner can neither demote nor remove them, and the list says why', async () => {
    // A stale address on the row: the list asks the account, as adminSetAdmin does.
    await db.doc(`admins/${BOSS}`).set({ email: 'old@example.test', role: 'owner' });
    await call('adminCheck', BOSS, {});
    await expect(setAdmin(OWNER, { uid: BOSS, makeAdmin: true, role: 'admin' })).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('BOOTSTRAP_ADMIN_EMAILS') });
    await expect(setAdmin(OWNER, { email: BOSS_EMAIL, makeAdmin: false })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await row(BOSS))!.role).toBe('owner');
    const { admins } = await call('adminListAdmins', OWNER, {});
    expect(admins.find((a: any) => a.uid === BOSS)).toMatchObject({ role: 'owner', bootstrap: true });
  });

  it('only verified: the address unverified on another account is not an owner, and can be removed like anybody', async () => {
    await admin.auth().deleteUser(BOSS);
    await admin.auth().createUser({ uid: SQUAT, email: BOSS_EMAIL, emailVerified: false });
    await expect(call('adminCheck', SQUAT, {}, { email: BOSS_EMAIL, email_verified: false })).resolves.toEqual({ isAdmin: false });
    await setAdmin(OWNER, { uid: SQUAT, makeAdmin: true });
    const { admins } = await call('adminListAdmins', OWNER, {});
    expect(admins.find((a: any) => a.uid === SQUAT)).toMatchObject({ role: 'admin', bootstrap: false });
    await expect(call('adminSetAdmin', SQUAT, { email: EMAIL[MEMBER], makeAdmin: true }, { email: BOSS_EMAIL, email_verified: false }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setAdmin(OWNER, { uid: SQUAT, makeAdmin: false })).resolves.toMatchObject({ ok: true, changed: true });
    expect(await row(SQUAT)).toBeUndefined();
  });
});

describe('a broadcast is an owner’s (07.11.2026)', () => {
  it('a plain admin is refused before anything is read or sent; an owner gets as far as the target check', async () => {
    await expect(call('adminBroadcast', ADMIN, { target: 'all', title: 'Hello' }))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'Only an owner can send a broadcast.' });
    expect((await db.collection('notifications').get()).size).toBe(0);
    // A target that names no group: refused for what it says, which an admin never reaches.
    await expect(call('adminBroadcast', OWNER, { target: 'a/b', title: 'Hello' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('a recent sign-in for the owner\u2019s actions (07.11.2026, functions/src/recentSignIn.ts)', () => {
  const STALE = { auth_time: nowS() - 6 * 60 }; // six minutes ago: past the five-minute window
  const SIGN_IN_AGAIN = { code: 'failed-precondition', details: { reason: 'recent-sign-in-required' } };

  it('changing the roster: refused from an old sign-in, with the reason the screen asks again on; nothing written', async () => {
    await expect(call('adminSetAdmin', OWNER, { email: EMAIL[MEMBER], makeAdmin: true }, STALE)).rejects.toMatchObject(SIGN_IN_AGAIN);
    await expect(call('adminSetAdmin', OWNER, { uid: ADMIN, makeAdmin: false }, STALE)).rejects.toMatchObject(SIGN_IN_AGAIN);
    // No auth_time at all, or one in the future, is not recent either.
    await expect(call('adminSetAdmin', OWNER, { email: EMAIL[MEMBER], makeAdmin: true }, { auth_time: undefined })).rejects.toMatchObject(SIGN_IN_AGAIN);
    await expect(call('adminSetAdmin', OWNER, { email: EMAIL[MEMBER], makeAdmin: true }, { auth_time: nowS() + 10 * 60 })).rejects.toMatchObject(SIGN_IN_AGAIN);
    expect(await roster()).toEqual({ [OWNER]: 'owner', [ADMIN]: null });
    // Four minutes ago is recent.
    await expect(call('adminSetAdmin', OWNER, { email: EMAIL[MEMBER], makeAdmin: true }, { auth_time: nowS() - 4 * 60 })).resolves.toMatchObject({ ok: true });
  });

  it('a plain admin is told they are not an owner, not asked to sign in again', async () => {
    await expect(call('adminSetAdmin', ADMIN, { email: EMAIL[MEMBER], makeAdmin: true }, STALE)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call('adminBroadcast', ADMIN, { target: 'all', title: 'Hello' }, STALE)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('a broadcast: refused from an old sign-in before anything is sent', async () => {
    await expect(call('adminBroadcast', OWNER, { target: 'all', title: 'Hello' }, STALE)).rejects.toMatchObject(SIGN_IN_AGAIN);
    expect((await db.collection('notifications').get()).size).toBe(0);
  });

  describe('the AI budget', () => {
    beforeEach(async () => {
      await db.doc('aiConfig/live').set({ globalDailyUsd: 5, userDailyUsd: 0.25, killSwitch: true });
    });

    it('raising it, or switching the kill switch off, needs a recent sign-in; nothing is written or logged without one', async () => {
      await expect(call('adminSetAiConfig', OWNER, { globalDailyUsd: '10', userDailyUsd: '0.25', killSwitch: true }, STALE)).rejects.toMatchObject(SIGN_IN_AGAIN);
      await expect(call('adminSetAiConfig', OWNER, { globalDailyUsd: '5', userDailyUsd: '0.25', killSwitch: false }, STALE)).rejects.toMatchObject(SIGN_IN_AGAIN);
      expect((await db.doc('aiConfig/live').get()).data()).toMatchObject({ globalDailyUsd: 5, killSwitch: true });
      expect((await db.collection('aiConfigLog').get()).size).toBe(0);
      await expect(call('adminSetAiConfig', OWNER, { globalDailyUsd: '10', userDailyUsd: '0.25', killSwitch: false })).resolves.toMatchObject({ actor: 'owner' });
    });

    it('making it safer never does: lowering a limit, or keeping the kill switch on, from an old sign-in, owner or not', async () => {
      await expect(call('adminSetAiConfig', OWNER, { globalDailyUsd: '2', userDailyUsd: '0.25', killSwitch: true }, STALE)).resolves.toMatchObject({ saved: { globalDailyUsd: 2 } });
      await expect(call('adminSetAiConfig', ADMIN, { globalDailyUsd: '1', userDailyUsd: '0.1', killSwitch: true }, STALE)).resolves.toMatchObject({ actor: 'admin' });
    });

    it('switching the kill switch on never does, owner or not: the emergency stop stays one tap away', async () => {
      for (const who of [ADMIN, OWNER]) {
        await db.doc('aiConfig/live').set({ globalDailyUsd: 5, userDailyUsd: 0.25, killSwitch: false });
        await expect(call('adminSetAiConfig', who, { globalDailyUsd: '5', userDailyUsd: '0.25', killSwitch: true }, STALE))
          .resolves.toMatchObject({ saved: { killSwitch: true } });
      }
    });

    it('a plain admin raising it is refused for the role, not asked to sign in again', async () => {
      await expect(call('adminSetAiConfig', ADMIN, { globalDailyUsd: '10', userDailyUsd: '0.25', killSwitch: true }, STALE)).rejects.toMatchObject({ code: 'permission-denied' });
    });
  });

  it('what does not need it: reading the roster, and the bootstrap owner\u2019s provisioning', async () => {
    await expect(call('adminListAdmins', ADMIN, {}, STALE)).resolves.toMatchObject({ admins: expect.any(Array) });
    await expect(call('adminCheck', BOSS, {}, STALE)).resolves.toEqual({ isAdmin: true });
    expect((await row(BOSS))!.role).toBe('owner');
  });
});

describe('the roster log: every change, written with it (07.11.2026)', () => {
  const by = (who: string, target: string, from: string | null, to: string | null) => ({ schema: 1, by: who, via: 'adminSetAdmin', target, from, to });

  it('a grant, a role change and a removal each write one row: who, whom, from, to; uids only', async () => {
    await setAdmin(OWNER, { email: EMAIL[MEMBER], makeAdmin: true });
    await setAdmin(OWNER, { uid: MEMBER, makeAdmin: true, role: 'owner' });
    await setAdmin(OWNER, { uid: MEMBER, makeAdmin: true, role: 'admin' });
    await setAdmin(OWNER, { uid: MEMBER, makeAdmin: false });
    expect(await logged()).toEqual([
      by(OWNER, MEMBER, null, 'admin'), by(OWNER, MEMBER, 'admin', 'owner'), by(OWNER, MEMBER, 'owner', 'admin'), by(OWNER, MEMBER, 'admin', null),
    ]);
  });

  it('a row from before 07.11.2026 (no role) is logged as an admin when it changes', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: false });
    expect(await logged()).toEqual([by(OWNER, ADMIN, 'admin', null)]);
  });

  it('nothing changed, nothing logged: "Make admin" on an admin, revoking a non-admin, any refusal', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true });
    await setAdmin(OWNER, { uid: MEMBER, makeAdmin: false });
    await expect(setAdmin(ADMIN, { email: EMAIL[MEMBER], makeAdmin: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setAdmin(OWNER, { uid: OWNER, makeAdmin: false })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await logged()).toEqual([]);
  });

  it('two owners demoting each other at once: one of the two changes happens, and only it is logged (with the promotion before)', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    await Promise.allSettled([
      setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'admin' }),
      setAdmin(ADMIN, { uid: OWNER, makeAdmin: true, role: 'admin' }),
    ]);
    expect(await logged()).toHaveLength(2);
  });

  it('the server\u2019s settings: provisioned, or made an owner again, by nobody; once, however often it calls', async () => {
    await call('adminCheck', BOSS, {});
    await call('adminCheck', BOSS, {});
    await db.doc(`admins/${BOSS}`).set({ role: 'admin' }, { merge: true });
    await Promise.all([call('adminCheck', BOSS, {}), call('adminCheck', BOSS, {})]);
    expect(await logged()).toEqual([
      { schema: 1, by: null, via: 'bootstrap', target: BOSS, from: null, to: 'owner' },
      { schema: 1, by: null, via: 'bootstrap', target: BOSS, from: 'admin', to: 'owner' },
    ]);
    // And read back as the server's settings, not as somebody's grant (asked by ADMIN, so no new check runs for BOSS).
    const { history } = await call('adminListAdmins', ADMIN, {});
    expect(history).toEqual([
      expect.objectContaining({ via: 'bootstrap', by: null, byName: null, target: BOSS, targetName: BOSS_EMAIL, from: 'admin', to: 'owner' }),
      expect.objectContaining({ via: 'bootstrap', by: null, byName: null, target: BOSS, from: null, to: 'owner' }),
    ]);
  });

  it('the list gives the newest changes first, with names looked up now: the account\u2019s name, else its email; a deleted account has none', async () => {
    await admin.auth().updateUser(OWNER, { displayName: 'Olga' });
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    await setAdmin(OWNER, { email: EMAIL[MEMBER], makeAdmin: true });
    await setAdmin(OWNER, { uid: MEMBER, makeAdmin: false });
    await admin.auth().deleteUser(MEMBER);
    const { history } = await call('adminListAdmins', ADMIN, {});
    expect(history).toEqual([
      expect.objectContaining({ by: OWNER, byName: 'Olga', target: MEMBER, targetName: null, from: 'admin', to: null, via: 'adminSetAdmin' }),
      expect.objectContaining({ by: OWNER, target: MEMBER, targetName: null, from: null, to: 'admin' }),
      expect.objectContaining({ by: OWNER, byName: 'Olga', target: ADMIN, targetName: EMAIL[ADMIN], from: 'admin', to: 'owner' }),
    ]);
    expect(Date.parse(history[0].at)).toBeGreaterThanOrEqual(Date.parse(history[1].at));
  });

  it('an account whose deletion has started can still have its role changed, or be removed; only a grant is refused', async () => {
    await db.doc(`accountDeletions/${ADMIN}`).set({ startedAt: admin.firestore.Timestamp.now(), by: 'self' });
    await expect(setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' })).resolves.toMatchObject({ changed: true });
    await expect(setAdmin(OWNER, { uid: ADMIN, makeAdmin: false })).resolves.toMatchObject({ changed: true });
    expect(await logged()).toHaveLength(2);
  });

  it('a deletion that finds a roster row (a grant in the moment before its record): the row goes, and so does a line', async () => {
    const { deleteAccountData } = await import('../src/accountDeletion');
    await db.doc(`admins/${MEMBER}`).set({ email: EMAIL[MEMBER], role: 'admin' });
    await deleteAccountData(MEMBER, `admin:${OWNER}`);
    expect(await row(MEMBER)).toBeUndefined();
    expect(await logged()).toEqual([{ schema: 1, by: OWNER, via: 'accountDeletion', target: MEMBER, from: 'admin', to: null }]);
    const { history } = await call('adminListAdmins', ADMIN, {});
    expect(history[0]).toMatchObject({ via: 'accountDeletion', by: OWNER, target: MEMBER, targetName: null, from: 'admin', to: null });
  });

  it('a deletion with no roster row writes no line', async () => {
    const { deleteAccountData } = await import('../src/accountDeletion');
    await deleteAccountData(MEMBER, 'self');
    expect(await logged()).toEqual([]);
  });

  it('an account whose deletion has started is not made an admin: its deletion would take the row away again', async () => {
    await db.doc(`accountDeletions/${MEMBER}`).set({ startedAt: admin.firestore.Timestamp.now(), by: 'self' });
    await expect(setAdmin(OWNER, { email: EMAIL[MEMBER], makeAdmin: true })).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('being deleted') });
    expect(await row(MEMBER)).toBeUndefined();
    expect(await logged()).toEqual([]);
  });

  it('the newest 50 only', async () => {
    const batch = db.batch();
    for (let i = 0; i < 55; i++) {
      batch.set(db.collection('adminRosterLog').doc(`r${String(i).padStart(2, '0')}`), {
        schema: 1, by: OWNER, via: 'adminSetAdmin', target: ADMIN, from: null, to: 'admin', at: admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 10, 7, 12, i)),
      });
    }
    await batch.commit();
    const { history } = await call('adminListAdmins', ADMIN, {});
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe('r54');
    expect(history[49].id).toBe('r05');
  });

  it('a log that cannot be read: the roster still comes back, and the history says it could not be read (null)', async () => {
    const realCollection = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation(((path: string) => {
      if (path === 'adminRosterLog') throw new Error('injected: the log is unreadable');
      return realCollection(path);
    }) as typeof db.collection);
    const res = await call('adminListAdmins', ADMIN, {});
    expect(res.admins.map((a: any) => a.uid).sort()).toEqual([ADMIN, OWNER].sort());
    expect(res.history).toBeNull();
  });

  it('no client may read or write it: refused by the rules (rules-tests/admin-roster-log.test.ts); the list is the way in', async () => {
    const { history } = await call('adminListAdmins', ADMIN, {});
    expect(history).toEqual([]);
  });
});

describe('what a request may say', () => {
  it.each([
    [{ uid: ADMIN, makeAdmin: true, role: 'root' }],
    [{ uid: ADMIN, makeAdmin: true, role: '' }],
    [{ uid: ADMIN, makeAdmin: false, role: 'admin' }],
    [{ uid: ['x'], makeAdmin: true }],
    [{ email: { a: 1 }, makeAdmin: true }],
    [{ uid: ADMIN, makeAdmin: 'yes' }],
    [{ makeAdmin: true }],
  ])('%j is refused, nothing written', async (data) => {
    await expect(setAdmin(OWNER, data)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await roster()).toEqual({ [OWNER]: 'owner', [ADMIN]: null });
  });

  it('an account that does not exist', async () => {
    await expect(setAdmin(OWNER, { email: 'nobody@example.test', makeAdmin: true })).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('the AI budget: only an owner makes it riskier, by the same role', () => {
  const raise = { globalDailyUsd: '10', userDailyUsd: '0.25', killSwitch: false };

  beforeEach(async () => {
    await db.doc('aiConfig/live').set({ globalDailyUsd: 5, userDailyUsd: 0.25, killSwitch: false });
  });

  it('a plain admin cannot raise a limit; an owner by their row can, and the log names them the owner', async () => {
    await expect(call('adminSetAiConfig', ADMIN, raise)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc('aiConfig/live').get()).get('globalDailyUsd')).toBe(5);
    await expect(call('adminSetAiConfig', OWNER, raise)).resolves.toMatchObject({ actor: 'owner', saved: { globalDailyUsd: 10 } });
    const log = (await db.collection('aiConfigLog').get()).docs.map((d) => d.data());
    expect(log).toEqual([expect.objectContaining({ actor: 'owner', by: expect.objectContaining({ uid: OWNER }) })]);
  });

  it('a plain admin can still make it safer', async () => {
    await expect(call('adminSetAiConfig', ADMIN, { globalDailyUsd: '2', userDailyUsd: '0.25', killSwitch: true }))
      .resolves.toMatchObject({ actor: 'admin', saved: { globalDailyUsd: 2, killSwitch: true } });
  });

  it('demoted, an owner can no longer raise it', async () => {
    await setAdmin(OWNER, { uid: ADMIN, makeAdmin: true, role: 'owner' });
    await setAdmin(ADMIN, { uid: OWNER, makeAdmin: true, role: 'admin' });
    await expect(call('adminSetAiConfig', OWNER, raise)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  /** Run `change` once, just before the first transaction starts: after the gate, before the write. */
  function meanwhile(change: () => Promise<unknown>) {
    const realTx = db.runTransaction.bind(db);
    let first = true;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any, ...rest: any[]) => {
      if (first) { first = false; await change(); }
      return realTx(fn, ...rest);
    });
  }

  it('an owner demoted while the call is on its way cannot raise it: the role is the one read where the change is written', async () => {
    meanwhile(() => db.doc(`admins/${OWNER}`).set({ role: 'admin' }, { merge: true }));
    await expect(call('adminSetAiConfig', OWNER, raise)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc('aiConfig/live').get()).get('globalDailyUsd')).toBe(5);
    expect((await db.collection('aiConfigLog').get()).size).toBe(0);
  });

  it('an admin removed while the call is on its way changes nothing, not even in the safer direction', async () => {
    meanwhile(() => db.doc(`admins/${ADMIN}`).delete());
    await expect(call('adminSetAiConfig', ADMIN, { globalDailyUsd: '2', userDailyUsd: '0.25', killSwitch: true }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc('aiConfig/live').get()).get('globalDailyUsd')).toBe(5);
    expect((await db.collection('aiConfigLog').get()).size).toBe(0);
  });

  it('the owner named in the settings, on a row from before 07.11.2026, can', async () => {
    await db.doc(`admins/${BOSS}`).set({ email: BOSS_EMAIL, addedBy: 'bootstrap' });
    await expect(call('adminSetAiConfig', BOSS, raise)).resolves.toMatchObject({ actor: 'owner' });
  });
});
