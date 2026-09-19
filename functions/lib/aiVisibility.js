"use strict";
// functions/src/aiVisibility.ts
//
// Whether one event is visible to one person, on the SERVER.
//
// ── Why it is its own file ──────────────────────────────────────────────────────────────
//
// It lived in `aiSources.ts`, which imports `firebase-admin`. CI installs only the root
// package, so any app test that imported it would pass on a developer machine and fail in
// CI — the arrangement `functionsPurity.test.ts` exists to prevent. The practical effect was
// that this rule, alone among the visibility rules, had no test at all.
//
// And then it drifted. The client retired `visibleTo` for `hiddenFrom` on 18.09; this went
// on reading `visibleTo` for a month, so the Period Log hid events the calendar showed and
// listed back events somebody had deliberately unticked. Nothing failed. There was nothing
// that could fail.
//
// It is deliberately NOT the client's `src/utils/eventScope.ts`: that one is wrapped in a
// `activeGroupId !== 'personal'` check, a UI variable the server does not have. Ported
// literally, with the caller "in personal view", the condition short-circuits to false and
// every hidden event lands in the cross-group context. Two rules, one invariant, tested apart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.maySee = maySee;
exports.isPendingInvite = isPendingInvite;
/** THE visibility invariant for one event, as the server must state it. */
function maySee(ev, uid) {
    if (ev.ownerId === uid)
        return true; // personal events carry `visibleTo: []`
    const assignees = Array.isArray(ev.assigneeIds) ? ev.assigneeIds : [];
    if (assignees.includes(uid))
        return true;
    if (ev.assigneeId === uid || ev.inviteeId === uid)
        return true; // assignment IS a read grant
    // The audience is the EXCLUSION, and has been since 18.09.
    //
    // This read the retired `visibleTo` until 19.09, which was wrong in both directions at once.
    // A member who joined after an event was written is absent from its frozen allow-list, so
    // the Period Log dropped events their calendar plainly shows — measured on live: five
    // events, every one B&D has, naming neither of the two members who joined later. And every
    // exclusion recorded since 18.09 is in `hiddenFrom`, which this never read, so somebody
    // deliberately unticked still had that event listed back to them.
    //
    // The legacy field does not decay: an edit adds `hiddenFrom` and never deletes `visibleTo`,
    // so an old document carries both and this preferred the dead one.
    return !(Array.isArray(ev.hiddenFrom) && ev.hiddenFrom.includes(uid));
}
/** A pending invitation is hidden in the app until it is answered; mirror that. */
function isPendingInvite(ev, uid) {
    return ev.inviteeId === uid && ev.inviteStatus === "pending";
}
//# sourceMappingURL=aiVisibility.js.map