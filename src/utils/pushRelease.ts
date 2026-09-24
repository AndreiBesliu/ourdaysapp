// src/utils/pushRelease.ts
//
// Signing out has to take this device's push token with it.
//
// ── The defect ─────────────────────────────────────────────────────────────────────────────
//
// Sign-out was a bare `signOut(auth)`. Registration only ever ADDED a token (`arrayUnion`) and
// nothing anywhere removed one. So on a shared phone or computer, the person who signed out kept
// receiving pushes — chat text, event titles — on a device they had left; and once somebody else
// signed in there, the same token sat in BOTH accounts, delivering each one's notifications to
// whoever was holding the device.
//
// ── The order is the point, so it is decided here where a test can run it ────────────────────
//
//   1. Remove the token from the account WHILE STILL SIGNED IN. Afterwards the rules refuse the
//      write: `users/{uid}` is owner-only, and there is no owner any more.
//   2. Invalidate it on the device (`deleteToken` on the web, `unregister` natively). This is the
//      step that actually stops delivery: FCM refuses a deleted token, and `notify` prunes a
//      refused token from every account that still lists it. So even when step 1 fails — offline,
//      or a token registered before this existed and never remembered — delivery still stops.
//   3. Sign out, ALWAYS. The person asked to leave; a failed clean-up is reported, never a reason
//      to keep them signed in.

const KEY = 'ourDays_pushToken';

interface Remembered { uid: string; token: string }

/** Record which token THIS device registered, and for whom, so sign-out can remove it. */
export function rememberPushToken(uid: string, token: string): void {
  if (!uid || !token) return;
  try { localStorage.setItem(KEY, JSON.stringify({ uid, token })); } catch { /* private mode */ }
}

export function rememberedPushToken(): Remembered | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v.uid === 'string' && typeof v.token === 'string' && v.uid && v.token ? v : null;
  } catch {
    return null;
  }
}

export function forgetPushToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

export interface ReleaseSteps {
  /** The account signing out. */
  uid: string | null;
  /** What this device remembered registering. Only removed if it was registered for `uid`. */
  remembered: Remembered | null;
  removeFromAccount: (uid: string, token: string) => Promise<void>;
  invalidateOnDevice: () => Promise<void>;
  signOut: () => Promise<void>;
  report: (err: unknown, context: string) => void;
}

export async function releasePushThenSignOut(s: ReleaseSteps): Promise<void> {
  // 1. Only a token this device registered for THIS account. A token remembered for somebody
  //    else is not this account's to remove — and removing it from the wrong document would be
  //    refused anyway, or worse, succeed on a stale uid.
  if (s.uid && s.remembered && s.remembered.uid === s.uid) {
    try { await s.removeFromAccount(s.uid, s.remembered.token); } catch (e) { s.report(e, 'push.release.account'); }
  }
  // 2. Regardless of step 1.
  try { await s.invalidateOnDevice(); } catch (e) { s.report(e, 'push.release.device'); }
  forgetPushToken();
  // 3. Always.
  await s.signOut();
}
