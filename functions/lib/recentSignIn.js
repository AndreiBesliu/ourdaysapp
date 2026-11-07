"use strict";
// functions/src/recentSignIn.ts
//
// "Sign in again first": how recent the last sign-in must be for the actions a session left open must not reach. One
// window and one test for the whole server (07.11.2026; until then it lived in accountDeletion.ts, for deleting your own
// account, and the owner's actions in the admin took the same rule).
//
// `auth_time` in the ID token is when the person last proved who they are (a sign-in, or `reauthenticateWith…`), in
// seconds. It is NOT when the token was minted: the SDK mints a new one every hour on its own, with the same `auth_time`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGN_IN_AGAIN = exports.RECENT_SIGN_IN_S = void 0;
exports.signedInRecently = signedInRecently;
/** How recent the last sign-in must be. Five minutes, as Firebase's own "requires recent login". */
exports.RECENT_SIGN_IN_S = 5 * 60;
/** `HttpsError.details.reason` of the refusal, so the app can ask the person to confirm it is them and try again. */
exports.SIGN_IN_AGAIN = "recent-sign-in-required";
/** Whether `authTime` (seconds) is within the window of `nowS`. A minute of clock difference is tolerated. */
function signedInRecently(authTime, nowS) {
    return typeof authTime === "number" && Number.isFinite(authTime)
        && authTime <= nowS + 60 && nowS - authTime <= exports.RECENT_SIGN_IN_S;
}
//# sourceMappingURL=recentSignIn.js.map