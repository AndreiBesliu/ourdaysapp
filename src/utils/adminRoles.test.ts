// src/utils/adminRoles.test.ts
//
// The owner level of the admin (07.11.2026): the rules for who may change the roster, and what each change writes
// (functions/src/adminRoles.ts), and what Admin → Admins offers on each row because of them (src/utils/adminRosterView.ts).
// The callables are run on the emulator in functions/test/adminRoster.test.ts.

import { describe, expect, it } from 'vitest';
import {
  ONLY_THE_OWNER, SET_BY_THE_SERVER, planRosterChange, requestedRole, roleOf,
  bootstrapLogRow, deletionLogRow, loggedRole, rosterLogRow,
  type RosterRow,
} from '../../functions/src/adminRoles';
import { describeRosterChange, rosterControls, rosterNote, viewerIsOwner, type ListedAdmin, type RosterHistoryRow } from './adminRosterView';

const OWNER = 'uid-owner';
const OWNER2 = 'uid-owner-2';
const ADMIN = 'uid-admin';
const ADMIN2 = 'uid-admin-2';
const NEW = 'uid-new';

const row = (uid: string, role: 'owner' | 'admin'): RosterRow => ({ uid, role });
const plain = (uid: string, bootstrap = false) => ({ uid, bootstrap });

describe('the role a stored row grants', () => {
  it('only the literal "owner" is an owner; a row without a role (every row before 07.11.2026) is an admin', () => {
    expect(roleOf({ role: 'owner' })).toBe('owner');
    expect(roleOf({ role: 'admin' })).toBe('admin');
    expect(roleOf({})).toBe('admin');
    for (const odd of [{ role: 'Owner' }, { role: true }, { role: ['owner'] }, null, undefined, 'owner']) {
      expect(roleOf(odd), JSON.stringify(odd)).toBe('admin');
    }
  });

  it('a role named in a request is "owner", "admin" or nothing; anything else is refused, not read as nothing', () => {
    expect(requestedRole('owner')).toBe('owner');
    expect(requestedRole('admin')).toBe('admin');
    expect(requestedRole(undefined)).toBeNull();
    expect(requestedRole(null)).toBeNull();
    for (const odd of ['', 'Owner', 'root', 1, true, {}]) expect(requestedRole(odd), JSON.stringify(odd)).toBe('invalid');
  });
});

describe('who may change the roster', () => {
  const roster = [row(OWNER, 'owner'), row(ADMIN, 'admin'), row(ADMIN2, 'admin')];

  it.each([
    ['grant a new admin', { kind: 'grant', role: null }, NEW],
    ['make an owner', { kind: 'grant', role: 'owner' }, ADMIN2],
    ['revoke an admin', { kind: 'revoke' }, ADMIN2],
    ['make themselves an owner', { kind: 'grant', role: 'owner' }, ADMIN],
  ] as const)('a plain admin cannot %s', (_, change, target) => {
    expect(planRosterChange(ADMIN, roster, plain(target), change)).toEqual({ ok: false, code: 'permission-denied', reason: ONLY_THE_OWNER });
  });

  it('nor can someone who is not on the roster at all, or whose row was removed a moment ago', () => {
    expect(planRosterChange('uid-stranger', roster, plain(NEW), { kind: 'grant', role: null })).toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('an owner can', () => {
    expect(planRosterChange(OWNER, roster, plain(NEW), { kind: 'grant', role: null })).toEqual({ ok: true, write: { op: 'create', role: 'admin' }, role: 'admin' });
  });
});

describe('granting', () => {
  const roster = [row(OWNER, 'owner'), row(OWNER2, 'owner'), row(ADMIN, 'admin')];

  it('a new admin is an admin unless an owner is asked for', () => {
    expect(planRosterChange(OWNER, roster, plain(NEW), { kind: 'grant', role: null })).toMatchObject({ ok: true, write: { op: 'create', role: 'admin' } });
    expect(planRosterChange(OWNER, roster, plain(NEW), { kind: 'grant', role: 'owner' })).toMatchObject({ ok: true, write: { op: 'create', role: 'owner' } });
  });

  it('"Make admin" on someone who is already one keeps their role: an owner is not demoted by it, and nothing is written', () => {
    expect(planRosterChange(OWNER, roster, plain(OWNER2), { kind: 'grant', role: null })).toEqual({ ok: true, write: null, role: 'owner' });
    expect(planRosterChange(OWNER, roster, plain(ADMIN), { kind: 'grant', role: null })).toEqual({ ok: true, write: null, role: 'admin' });
    expect(planRosterChange(OWNER, roster, plain(ADMIN), { kind: 'grant', role: 'admin' })).toEqual({ ok: true, write: null, role: 'admin' });
  });

  it('an admin made an owner, and an owner made an admin while another owner remains', () => {
    expect(planRosterChange(OWNER, roster, plain(ADMIN), { kind: 'grant', role: 'owner' })).toEqual({ ok: true, write: { op: 'setRole', role: 'owner' }, role: 'owner' });
    expect(planRosterChange(OWNER, roster, plain(OWNER2), { kind: 'grant', role: 'admin' })).toEqual({ ok: true, write: { op: 'setRole', role: 'admin' }, role: 'admin' });
    // Themselves too, while another owner remains.
    expect(planRosterChange(OWNER, roster, plain(OWNER), { kind: 'grant', role: 'admin' })).toMatchObject({ ok: true, write: { op: 'setRole', role: 'admin' } });
  });

  it('the last owner cannot be demoted, not even by themselves', () => {
    const one = [row(OWNER, 'owner'), row(ADMIN, 'admin')];
    expect(planRosterChange(OWNER, one, plain(OWNER), { kind: 'grant', role: 'admin' })).toEqual({ ok: false, code: 'failed-precondition', reason: "Can't demote the last owner." });
  });

  it('an owner named in the server\'s settings is not demoted here, however many owners there are', () => {
    expect(planRosterChange(OWNER, roster, plain(OWNER2, true), { kind: 'grant', role: 'admin' })).toEqual({ ok: false, code: 'failed-precondition', reason: SET_BY_THE_SERVER });
  });

  it('but made an owner, or kept, like anybody else', () => {
    expect(planRosterChange(OWNER, roster, plain(ADMIN, true), { kind: 'grant', role: 'owner' })).toMatchObject({ ok: true, write: { op: 'setRole', role: 'owner' } });
    expect(planRosterChange(OWNER, roster, plain(NEW, true), { kind: 'grant', role: null })).toMatchObject({ ok: true, write: { op: 'create' } });
  });
});

describe('revoking', () => {
  it('an admin, or an owner while another owner remains, is removed', () => {
    const roster = [row(OWNER, 'owner'), row(OWNER2, 'owner'), row(ADMIN, 'admin')];
    expect(planRosterChange(OWNER, roster, plain(ADMIN), { kind: 'revoke' })).toEqual({ ok: true, write: { op: 'delete' }, role: null });
    expect(planRosterChange(OWNER, roster, plain(OWNER2), { kind: 'revoke' })).toEqual({ ok: true, write: { op: 'delete' }, role: null });
    expect(planRosterChange(OWNER, roster, plain(OWNER), { kind: 'revoke' })).toMatchObject({ ok: true, write: { op: 'delete' } });
  });

  it('someone who is not an admin: nothing to do, nothing written', () => {
    expect(planRosterChange(OWNER, [row(OWNER, 'owner'), row(ADMIN, 'admin')], plain(NEW), { kind: 'revoke' })).toEqual({ ok: true, write: null, role: null });
  });

  it('never the last owner, even with admins left; never the last admin', () => {
    expect(planRosterChange(OWNER, [row(OWNER, 'owner'), row(ADMIN, 'admin')], plain(OWNER), { kind: 'revoke' }))
      .toEqual({ ok: false, code: 'failed-precondition', reason: "Can't remove the last owner." });
    expect(planRosterChange(OWNER, [row(OWNER, 'owner')], plain(OWNER), { kind: 'revoke' }))
      .toEqual({ ok: false, code: 'failed-precondition', reason: "Can't remove the last admin." });
  });

  it('never an owner named in the server\'s settings, nor such an account whose row still says admin', () => {
    const roster = [row(OWNER, 'owner'), row(OWNER2, 'owner'), row(ADMIN, 'admin')];
    expect(planRosterChange(OWNER, roster, plain(OWNER2, true), { kind: 'revoke' })).toEqual({ ok: false, code: 'failed-precondition', reason: SET_BY_THE_SERVER });
    expect(planRosterChange(OWNER, roster, plain(ADMIN, true), { kind: 'revoke' })).toMatchObject({ ok: false, reason: SET_BY_THE_SERVER });
  });
});

describe('what Admin → Admins offers on each row', () => {
  const list: ListedAdmin[] = [
    { uid: OWNER, role: 'owner', bootstrap: true },
    { uid: OWNER2, role: 'owner' },
    { uid: ADMIN, role: 'admin' },
    { uid: ADMIN2 }, // a row from before 07.11.2026
  ];

  it('the viewer is an owner by their own row; nobody signed in, or off the list, is not', () => {
    expect(viewerIsOwner(list, OWNER2)).toBe(true);
    expect(viewerIsOwner(list, ADMIN)).toBe(false);
    expect(viewerIsOwner(list, ADMIN2)).toBe(false);
    expect(viewerIsOwner(list, 'uid-stranger')).toBe(false);
    expect(viewerIsOwner(list, null)).toBe(false);
  });

  it('a plain admin is offered nothing, and no notes, on any row', () => {
    for (const r of list) {
      expect(rosterControls(list, ADMIN, r), r.uid).toEqual([]);
      expect(rosterNote(list, ADMIN, r), r.uid).toBeNull();
    }
    expect(rosterControls(list, null, list[2])).toEqual([]);
  });

  it('an owner: an admin can be made an owner or removed; another owner made an admin or removed', () => {
    expect(rosterControls(list, OWNER2, list[2])).toEqual(['makeOwner', 'revoke']);
    expect(rosterControls(list, OWNER2, list[3])).toEqual(['makeOwner', 'revoke']);
    expect(rosterControls(list, OWNER2, list[1])).toEqual(['makeAdmin', 'revoke']);
    expect(rosterNote(list, OWNER2, list[2])).toBeNull();
  });

  it('the owner set by the server\'s settings: nothing to press, and the note says why', () => {
    expect(rosterControls(list, OWNER2, list[0])).toEqual([]);
    expect(rosterNote(list, OWNER2, list[0])).toBe('setByServer');
    // Granted before their first admin call, their row still says admin: they can be made an owner, not removed.
    const pending: ListedAdmin[] = [{ uid: OWNER2, role: 'owner' }, { uid: NEW, role: 'admin', bootstrap: true }];
    expect(rosterControls(pending, OWNER2, pending[1])).toEqual(['makeOwner']);
    expect(rosterNote(pending, OWNER2, pending[1])).toBe('setByServer');
  });

  it('the last owner: nothing to press on their own row, "last owner", alone on the roster or not', () => {
    const one: ListedAdmin[] = [{ uid: OWNER, role: 'owner' }, { uid: ADMIN, role: 'admin' }];
    expect(rosterControls(one, OWNER, one[0])).toEqual([]);
    expect(rosterNote(one, OWNER, one[0])).toBe('lastOwner');
    expect(rosterControls(one, OWNER, one[1])).toEqual(['makeOwner', 'revoke']);
    const alone: ListedAdmin[] = [{ uid: OWNER, role: 'owner' }];
    expect(rosterNote(alone, OWNER, alone[0])).toBe('lastOwner');
  });
});

describe('the roster log (07.11.2026)', () => {
  it('a row for each write the rules decided on, none for nothing written; uids and roles only', () => {
    expect(rosterLogRow(OWNER, NEW, null, { op: 'create', role: 'admin' }))
      .toEqual({ schema: 1, by: OWNER, via: 'adminSetAdmin', target: NEW, from: null, to: 'admin' });
    expect(rosterLogRow(OWNER, ADMIN, 'admin', { op: 'setRole', role: 'owner' })).toMatchObject({ from: 'admin', to: 'owner' });
    expect(rosterLogRow(OWNER, OWNER2, 'owner', { op: 'delete' })).toMatchObject({ from: 'owner', to: null });
    expect(rosterLogRow(OWNER, ADMIN, 'admin', null)).toBeNull();
    expect(Object.keys(rosterLogRow(OWNER, NEW, null, { op: 'create', role: 'admin' })!).sort()).toEqual(['by', 'from', 'schema', 'target', 'to', 'via']);
  });

  it('an account deletion: by the account itself, or by the admin who deleted it', () => {
    expect(deletionLogRow(ADMIN, 'self', 'admin')).toEqual({ schema: 1, by: ADMIN, via: 'accountDeletion', target: ADMIN, from: 'admin', to: null });
    expect(deletionLogRow(ADMIN, `admin:${OWNER}`, 'owner')).toEqual({ schema: 1, by: OWNER, via: 'accountDeletion', target: ADMIN, from: 'owner', to: null });
    expect(deletionLogRow(ADMIN, 'admin:', 'admin').by).toBeNull();
  });

  it('the server\u2019s settings: by nobody, provisioned or made an owner again', () => {
    expect(bootstrapLogRow(OWNER, null)).toEqual({ schema: 1, by: null, via: 'bootstrap', target: OWNER, from: null, to: 'owner' });
    expect(bootstrapLogRow(OWNER, 'admin')).toMatchObject({ from: 'admin', to: 'owner' });
  });

  it('a role read back is one of the two literals, or nothing', () => {
    expect(loggedRole('owner')).toBe('owner');
    expect(loggedRole('admin')).toBe('admin');
    for (const odd of [null, undefined, 'Owner', '', 1, {}]) expect(loggedRole(odd)).toBeNull();
  });
});

describe('what the history says', () => {
  const row = (over: Partial<RosterHistoryRow>): RosterHistoryRow => ({
    id: 'r', at: null, by: OWNER, byName: 'Alice', via: 'adminSetAdmin', target: ADMIN, targetName: 'Bob', from: null, to: 'admin', ...over,
  });

  it('each kind of change, as a sentence', () => {
    expect(describeRosterChange(row({}))).toBe('Alice added Bob as an admin');
    expect(describeRosterChange(row({ to: 'owner' }))).toBe('Alice added Bob as an owner');
    expect(describeRosterChange(row({ from: 'admin', to: 'owner' }))).toBe('Alice made Bob an owner');
    expect(describeRosterChange(row({ from: 'owner', to: 'admin' }))).toBe('Alice made Bob an admin (no longer an owner)');
    expect(describeRosterChange(row({ from: 'owner', to: null }))).toBe('Alice removed Bob from the admins (was an owner)');
    expect(describeRosterChange(row({ from: 'admin', to: null }))).toBe('Alice removed Bob from the admins (was an admin)');
  });

  it('a change to your own row says "themselves"; an account that is gone says so', () => {
    expect(describeRosterChange(row({ target: OWNER, targetName: 'Alice', from: 'owner', to: 'admin' }))).toBe('Alice made themselves an admin (no longer an owner)');
    expect(describeRosterChange(row({ targetName: null, from: 'admin', to: null }))).toBe('Alice removed a deleted account from the admins (was an admin)');
    expect(describeRosterChange(row({ byName: null }))).toBe('A deleted account added Bob as an admin');
  });

  it('an account deletion that took someone off the list: by themselves, or by an admin', () => {
    expect(describeRosterChange(row({ via: 'accountDeletion', by: ADMIN, byName: null, targetName: null, from: 'admin', to: null })))
      .toBe('An account was deleted and left the admins (was an admin)');
    expect(describeRosterChange(row({ via: 'accountDeletion', by: OWNER, byName: 'Alice', targetName: null, from: 'owner', to: null })))
      .toBe('An account was deleted by Alice and left the admins (was an owner)');
    expect(describeRosterChange(row({ via: 'accountDeletion', by: ADMIN, byName: 'Bob', targetName: 'Bob', from: 'admin', to: null })))
      .toBe("Bob's account was deleted and left the admins (was an admin)");
  });

  it('the server\u2019s settings', () => {
    expect(describeRosterChange(row({ via: 'bootstrap', by: null, byName: null, from: null, to: 'owner' }))).toBe("Bob was added as an owner by the server's settings");
    expect(describeRosterChange(row({ via: 'bootstrap', by: null, byName: null, from: 'admin', to: 'owner' }))).toBe("Bob was made an owner by the server's settings");
  });
});

describe('the history and the controls are the admin\u2019s alone', () => {
  it('only Admin.tsx imports adminRosterView.ts for code (its English shares the admin\u2019s exemption from i18n)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? (n === 'warlord' ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p.split('\\').join('/')] : [];
    });
    // A static import or re-export for code, or a dynamic import (review of 07.11.2026); `import type` leaves no code.
    // With or without an extension (allowImportingTsExtensions; main.tsx imports './App.tsx'), and in backticks (reverify).
    const imports = /^\s*(?:import|export)\s+(?!type\b)[^;]*from\s+['"][^'"]*\/adminRosterView(?:\.[cm]?[jt]sx?)?['"]|\bimport\(\s*['"`][^'"`]*\/adminRosterView(?:\.[cm]?[jt]sx?)?['"`]/m;
    const importers = walk('src').filter((f) => imports.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual(['src/screens/Admin.tsx']);
  });
});
