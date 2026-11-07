// functions/src/adminRoles.ts
//
// The owner level of the admin (07.11.2026). Until then any admin could make another admin: `adminSetAdmin` was gated by
// `assertAdmin` alone, so the roster was only as safe as its least careful member, and every control that had to be held
// somewhere safer (raising the AI budget) leaned on the bootstrap email instead.
//
// The role lives on the roster row, `admins/{uid}.role`, and is read from Firestore on every call, never from a custom
// claim: a claim stays in the person's token until it refreshes (up to an hour), so taking the role away would not take
// it away. A row without `role` is a plain admin (every row written before 07.11.2026 was one).
//
// Who is an owner:
// - whoever an owner made one (`adminSetAdmin` with `role: "owner"`);
// - a VERIFIED email on `BOOTSTRAP_ADMIN_EMAILS` (functions/.env), made one again at its next admin call. That is the way
//   back in if the roster were emptied, so the server refuses to demote or remove such an account: it would come back at
//   its next visit, and a button that seems to work and does not is worse than a refusal that says why.
//
// Pure, so every rule below is tested without the emulator (src/utils/adminRoles.test.ts); the callables run it inside
// the transaction that reads the roster, so two owners acting at once cannot both pass a floor.

export type AdminRole = "owner" | "admin";

/** The role a stored `admins/{uid}` row grants. Anything but the literal "owner" is a plain admin. */
export function roleOf(row: unknown): AdminRole {
  return row !== null && typeof row === "object" && (row as { role?: unknown }).role === "owner" ? "owner" : "admin";
}

/** A role named in a request: "owner", "admin", or nothing (`null`). Anything else is not a role. */
export function requestedRole(value: unknown): AdminRole | null | "invalid" {
  if (value === undefined || value === null) return null;
  return value === "owner" || value === "admin" ? value : "invalid";
}

export interface RosterRow { uid: string; role: AdminRole }

export interface RosterTarget {
  uid: string;
  /** Their verified email is on `BOOTSTRAP_ADMIN_EMAILS`: the server makes them an owner again at their next call. */
  bootstrap: boolean;
}

/** Make (or keep) them an admin, with `role` if one was asked for; or take the admin away. */
export type RosterChange = { kind: "grant"; role: AdminRole | null } | { kind: "revoke" };

export type RosterWrite =
  | { op: "create"; role: AdminRole }
  | { op: "setRole"; role: AdminRole }
  | { op: "delete" };

export type RosterPlan =
  | { ok: true; write: RosterWrite | null; role: AdminRole | null }
  | { ok: false; code: "permission-denied" | "failed-precondition"; reason: string };

const refuse = (code: "permission-denied" | "failed-precondition", reason: string): RosterPlan => ({ ok: false, code, reason });

export const ONLY_THE_OWNER = "Only an owner can add or remove admins, or change their role.";
export const SET_BY_THE_SERVER =
  "This owner is named in the server's settings (BOOTSTRAP_ADMIN_EMAILS) and would be an owner again at their next visit. Take them out of the settings first.";

/**
 * What a change to the roster writes, or why it is refused.
 *
 * `roster` is every row of `admins`, read in the same transaction as the write; the caller's role is taken from it, not
 * from anything read earlier, so an owner demoted a moment ago cannot finish a change they started before.
 *
 * - Only an owner changes the roster.
 * - Granting keeps an existing admin's role unless another is asked for, so "Make admin" on someone who is already an
 *   owner does not demote them.
 * - There is always an admin and always an owner: neither the last admin nor the last owner can be removed or demoted.
 * - An owner set by the server's settings is neither demoted nor removed here (see the header).
 */
export function planRosterChange(callerUid: string, roster: readonly RosterRow[], target: RosterTarget, change: RosterChange): RosterPlan {
  const caller = roster.find((r) => r.uid === callerUid);
  if (!caller || caller.role !== "owner") return refuse("permission-denied", ONLY_THE_OWNER);

  const current = roster.find((r) => r.uid === target.uid) ?? null;
  const owners = roster.filter((r) => r.role === "owner").length;

  if (change.kind === "grant") {
    const role: AdminRole = change.role ?? current?.role ?? "admin";
    if (!current) return { ok: true, write: { op: "create", role }, role };
    if (current.role === role) return { ok: true, write: null, role };
    if (current.role === "owner") {
      if (target.bootstrap) return refuse("failed-precondition", SET_BY_THE_SERVER);
      if (owners <= 1) return refuse("failed-precondition", "Can't demote the last owner.");
    }
    return { ok: true, write: { op: "setRole", role }, role };
  }

  if (!current) return { ok: true, write: null, role: null };
  if (target.bootstrap) return refuse("failed-precondition", SET_BY_THE_SERVER);
  if (roster.length <= 1) return refuse("failed-precondition", "Can't remove the last admin.");
  if (current.role === "owner" && owners <= 1) return refuse("failed-precondition", "Can't remove the last owner.");
  return { ok: true, write: { op: "delete" }, role: null };
}
