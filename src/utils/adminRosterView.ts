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
