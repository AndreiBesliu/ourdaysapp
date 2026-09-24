"use strict";
// functions/src/bootstrapAdmins.ts
//
// Who is an admin before anybody has been made one — and who can get back in if every admin were
// removed. `assertAdmin` auto-provisions `admins/{uid}` for a VERIFIED email on this list.
//
// It was a literal in index.ts, in a PUBLIC repository. Now it comes from the environment
// (`BOOTSTRAP_ADMIN_EMAILS` in `functions/.env`, which is gitignored), comma-separated. Pure, so the
// parsing is tested.
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapAdminEmails = bootstrapAdminEmails;
function bootstrapAdminEmails(raw) {
    if (typeof raw !== "string")
        return [];
    return raw.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
}
//# sourceMappingURL=bootstrapAdmins.js.map