// src/utils/adminRosterView.ts
//
// What Admin → Admins offers on each row (07.11.2026, the owner level). Asked of the server's own rules
// (functions/src/adminRoles.ts, `planRosterChange`) for the roster as `adminListAdmins` listed it, so the screen offers
// exactly the changes the server would accept, and a plain admin sees none. The server checks again on every call: this
// only keeps buttons that would be refused off the screen.

import { planRosterChange, roleOf, type AdminRole, type RosterChange, type RosterRow } from '../../functions/src/adminRoles';

/** A row of `adminListAdmins`, as much of it as this needs. */
export interface ListedAdmin { uid: string; role?: unknown; bootstrap?: unknown }

export type RosterControl = 'makeOwner' | 'makeAdmin' | 'revoke';

/**
 * Why an owner cannot remove a row. Only these two: with an owner looking, the roster has at least the owner and the
 * row, so "the last admin" cannot be the reason.
 */
export type RosterNote = 'setByServer' | 'lastOwner';

const rosterOf = (list: readonly ListedAdmin[]): RosterRow[] => list.map((a) => ({ uid: a.uid, role: roleOf(a) }));

/** The role a listed row holds. */
export const listedRole = (row: ListedAdmin): AdminRole => roleOf(row);

/** Whether the viewer is an owner, by their own row of the list. */
export function viewerIsOwner(list: readonly ListedAdmin[], viewerUid: string | null | undefined): boolean {
  return !!viewerUid && list.some((a) => a.uid === viewerUid && roleOf(a) === 'owner');
}

/** The changes the viewer may make to one row: the ones the server's rules accept and that change something. */
export function rosterControls(list: readonly ListedAdmin[], viewerUid: string | null | undefined, row: ListedAdmin): RosterControl[] {
  if (!viewerUid) return [];
  const roster = rosterOf(list);
  const target = { uid: row.uid, bootstrap: row.bootstrap === true };
  const accepted = (change: RosterChange) => {
    const plan = planRosterChange(viewerUid, roster, target, change);
    return plan.ok && plan.write !== null;
  };
  const out: RosterControl[] = [];
  if (accepted({ kind: 'grant', role: 'owner' })) out.push('makeOwner');
  if (accepted({ kind: 'grant', role: 'admin' })) out.push('makeAdmin');
  if (accepted({ kind: 'revoke' })) out.push('revoke');
  return out;
}

/** For an owner, why a row cannot be removed; `null` where it can, and for anyone who is not an owner. */
export function rosterNote(list: readonly ListedAdmin[], viewerUid: string | null | undefined, row: ListedAdmin): RosterNote | null {
  if (!viewerIsOwner(list, viewerUid) || rosterControls(list, viewerUid, row).includes('revoke')) return null;
  if (row.bootstrap === true) return 'setByServer';
  if (roleOf(row) === 'owner') return 'lastOwner';
  return null;
}

/** A row of `history` from `adminListAdmins` (the roster log, 07.11.2026): uids, roles, and names looked up when read. */
export interface RosterHistoryRow {
  id: string;
  at: string | null;
  by: string | null;
  byName: string | null;
  via: 'adminSetAdmin' | 'bootstrap' | 'accountDeletion';
  target: string;
  targetName: string | null;
  from: 'owner' | 'admin' | null;
  to: 'owner' | 'admin' | null;
}

const article = (role: 'owner' | 'admin') => (role === 'owner' ? 'an owner' : 'an admin');

/**
 * One change, as a sentence. A uid whose account is gone reads "a deleted account"; a change someone made to their own
 * row reads "themselves". English, like the rest of the admin.
 */
export function describeRosterChange(row: RosterHistoryRow): string {
  const target = row.targetName ?? 'a deleted account';
  if (row.via === 'bootstrap') {
    return row.from === null
      ? `${target} was added as an owner by the server's settings`
      // From "admin": a row from before 07.11.2026 has no role, so "again" would be false the first time.
      : `${target} was made an owner by the server's settings`;
  }
  if (row.via === 'accountDeletion') {
    // By then the account is usually gone, so it is rarely named.
    const subject = row.targetName ? `${row.targetName}'s account` : 'An account';
    const byOther = row.by && row.by !== row.target ? ` by ${row.byName ?? 'a deleted account'}` : '';
    return `${subject} was deleted${byOther} and left the admins${row.from ? ` (was ${article(row.from)})` : ''}`;
  }
  const who = row.by ? (row.byName ?? 'A deleted account') : 'An unknown admin';
  const whom = row.by && row.by === row.target ? 'themselves' : target;
  if (row.from === null && row.to) return `${who} added ${whom} as ${article(row.to)}`;
  if (row.to === null && row.from) return `${who} removed ${whom} from the admins (was ${article(row.from)})`;
  if (row.from === 'admin' && row.to === 'owner') return `${who} made ${whom} an owner`;
  if (row.from === 'owner' && row.to === 'admin') return `${who} made ${whom} an admin (no longer an owner)`;
  return `${who} changed ${whom}`;
}
