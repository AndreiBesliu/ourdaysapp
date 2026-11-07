"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SET_BY_THE_SERVER = exports.ONLY_THE_OWNER = void 0;
exports.roleOf = roleOf;
exports.requestedRole = requestedRole;
exports.planRosterChange = planRosterChange;
/** The role a stored `admins/{uid}` row grants. Anything but the literal "owner" is a plain admin. */
function roleOf(row) {
    return row !== null && typeof row === "object" && row.role === "owner" ? "owner" : "admin";
}
/** A role named in a request: "owner", "admin", or nothing (`null`). Anything else is not a role. */
function requestedRole(value) {
    if (value === undefined || value === null)
        return null;
    return value === "owner" || value === "admin" ? value : "invalid";
}
const refuse = (code, reason) => ({ ok: false, code, reason });
exports.ONLY_THE_OWNER = "Only an owner can add or remove admins, or change their role.";
exports.SET_BY_THE_SERVER = "This owner is named in the server's settings (BOOTSTRAP_ADMIN_EMAILS) and would be an owner again at their next visit. Take them out of the settings first.";
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
function planRosterChange(callerUid, roster, target, change) {
    var _a, _b, _c;
    const caller = roster.find((r) => r.uid === callerUid);
    if (!caller || caller.role !== "owner")
        return refuse("permission-denied", exports.ONLY_THE_OWNER);
    const current = (_a = roster.find((r) => r.uid === target.uid)) !== null && _a !== void 0 ? _a : null;
    const owners = roster.filter((r) => r.role === "owner").length;
    if (change.kind === "grant") {
        const role = (_c = (_b = change.role) !== null && _b !== void 0 ? _b : current === null || current === void 0 ? void 0 : current.role) !== null && _c !== void 0 ? _c : "admin";
        if (!current)
            return { ok: true, write: { op: "create", role }, role };
        if (current.role === role)
            return { ok: true, write: null, role };
        if (current.role === "owner") {
            if (target.bootstrap)
                return refuse("failed-precondition", exports.SET_BY_THE_SERVER);
            if (owners <= 1)
                return refuse("failed-precondition", "Can't demote the last owner.");
        }
        return { ok: true, write: { op: "setRole", role }, role };
    }
    if (!current)
        return { ok: true, write: null, role: null };
    if (target.bootstrap)
        return refuse("failed-precondition", exports.SET_BY_THE_SERVER);
    if (roster.length <= 1)
        return refuse("failed-precondition", "Can't remove the last admin.");
    if (current.role === "owner" && owners <= 1)
        return refuse("failed-precondition", "Can't remove the last owner.");
    return { ok: true, write: { op: "delete" }, role: null };
}
//# sourceMappingURL=adminRoles.js.map