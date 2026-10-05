// src/utils/accountDeletion.ts
//
// Deleting your own account, from Settings (Andrei, 04.10.2026: immediately, after a typed
// confirmation and a recent sign-in). The server does the deleting (functions/src/accountDeletion.ts);
// this is what the app decides around it, pure so a test can run it.
//
// ── The order is the point ─────────────────────────────────────────────────────────────────
//
//   1. Prove who you are again: the password, or Google. FIRST, because a Google popup opened after
//      anything else has been awaited is blocked by the browser as not coming from the click.
//   2. Wait until this device's queued writes have reached the server. One that landed AFTER the
//      deletion would put a piece of the account back: a card, an event, a lastLogin.
//   3. Ask the server to delete the account.
//   4. Only then clear this device: the offline copies, the per-account keys, the push token, the
//      sign-in. A deletion that failed must leave the person signed in, able to try again.

import { settleWithin } from './pendingWrite';

/**
 * The typed word, in any case and with or without diacritics: „sterge” is „ȘTERGE”, „loschen” is
 * „LÖSCHEN”. A phone keyboard without the letter must not make the account impossible to delete.
 */
export function confirmationMatches(typed: string, word: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase();
  return norm(word) !== '' && norm(typed) === norm(word);
}

/** How the person proves who they are again. A password if the account has one, else Google. */
export function reauthMethod(providerIds: string[]): 'password' | 'google' {
  return providerIds.includes('password') ? 'password' : 'google';
}

/**
 * What to say when proving who you are failed, as an i18n key. Null: the person closed the popup.
 * `auth/user-mismatch` means another Google account was picked; with a password it only happens when
 * the account no longer exists, which the caller finds out separately (`mayBeGone`).
 */
export function reauthErrorKey(err: unknown, method: 'password' | 'google'): string | null {
  switch (codeOf(err)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/popup-blocked':
      return 'deleteAccountPopupBlocked';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/missing-password':
      return 'deleteAccountWrongPassword';
    case 'auth/user-mismatch':
      return method === 'google' ? 'deleteAccountWrongGoogle' : 'deleteAccountReauthFailed';
    case 'auth/too-many-requests':
      return 'authTooManyRequests';
    case 'auth/network-request-failed':
      return 'deleteAccountOffline';
    default:
      return 'deleteAccountReauthFailed';
  }
}

/**
 * Could this failure to prove who you are mean the account no longer exists? Measured on the Auth
 * emulator, 04.10.2026: a password against a deleted account answers `auth/user-mismatch` (and,
 * with email-enumeration protection on, `auth/invalid-credential`, which a wrong password answers
 * too). Only a question: the answer comes from `accountState`.
 */
export function mayBeGone(err: unknown): boolean {
  return ['auth/user-mismatch', 'auth/user-not-found', 'auth/user-token-expired', 'auth/invalid-credential',
    'auth/invalid-login-credentials', 'auth/wrong-password'].includes(codeOf(err));
}

/**
 * Does the account still exist, from `user.reload()`? Measured on the Auth emulator: for a deleted
 * account it fails with `auth/user-token-expired` (and signs the session out). A failure that says
 * nothing about the account, offline say, is `unknown`.
 */
export async function accountStateFrom(reload: () => Promise<unknown>): Promise<'here' | 'gone' | 'unknown'> {
  try {
    await reload();
    return 'here';
  } catch (err) {
    return ['auth/user-token-expired', 'auth/user-not-found'].includes(codeOf(err)) ? 'gone' : 'unknown';
  }
}

function codeOf(err: unknown): string {
  return String((err as { code?: unknown } | null)?.code ?? '');
}

/** What to say when the server did not delete the account, as an i18n key. */
export function serverErrorKey(err: unknown): string {
  const e = err as { code?: unknown; details?: { reason?: unknown } } | null;
  const reason = e?.details?.reason;
  // The reasons functions/src/accountDeletion.ts sends (REFUSAL there).
  if (reason === 'recent-sign-in-required') return 'deleteAccountSignInAgain';
  if (reason === 'admin-account') return 'deleteAccountAdmin';
  // Everything else may have run part way. Saying "nothing happened" could be false; the server
  // continues where it stopped, so trying again is the honest advice.
  return 'deleteAccountFailed';
}

/** How long to wait for this device's queued writes before giving up on deleting now. */
export const DRAIN_WAIT_MS = 10_000;

/**
 * How long clearing the Firestore cache may hold the reload that ends a deletion. A tab that cannot
 * answer could otherwise hold it for ever, and this one would never reach the sign-in screen.
 */
export const CACHE_CLEAR_WAIT_MS = 4_000;

export interface DeletionSteps {
  /** `navigator.onLine`: only `false` is believed. */
  onLine: boolean | undefined;
  method: 'password' | 'google';
  reauthenticate: () => Promise<unknown>;
  /** `waitForPendingWrites(db)`. */
  drainWrites: () => Promise<unknown>;
  callDelete: () => Promise<unknown>;
  /** Does the account still exist? `accountStateFrom(() => user.reload())`. */
  accountState: () => Promise<'here' | 'gone' | 'unknown'>;
  /** Clears this device and signs out. Runs only once the account is gone from the server. */
  afterDeleted: () => Promise<void>;
  /** Reports a failure nobody but the logs can act on. Never called once the account is gone. */
  report: (err: unknown, context: string) => void;
  drainMs?: number;
}

export type DeletionOutcome = { ok: true } | { ok: false; key: string | null };

export async function deleteOwnAccount(s: DeletionSteps): Promise<DeletionOutcome> {
  if (s.onLine === false) return { ok: false, key: 'deleteAccountOffline' };
  // Once the account is gone, nothing may keep the person signed in to it: the dialog cannot be left
  // spinning, and a failure in the clean-up must not be shown as a failed deletion.
  const done = async (): Promise<DeletionOutcome> => {
    try { await s.afterDeleted(); } catch { /* the reload it ends in is what matters */ }
    return { ok: true };
  };
  try {
    await s.reauthenticate();
  } catch (err) {
    // A deletion whose answer was lost: the next try finds an account that no longer exists.
    if (mayBeGone(err) && (await s.accountState()) === 'gone') return done();
    const key = reauthErrorKey(err, s.method);
    // A wrong password is the person's to fix; anything unexpected is worth a row.
    if (key === 'deleteAccountReauthFailed') s.report(err, 'Settings.deleteAccount.reauth');
    return { ok: false, key };
  }
  // Either answer will do: a write the server refused is no longer queued either.
  const drained = await settleWithin(s.drainWrites(), s.drainMs ?? DRAIN_WAIT_MS);
  if (drained.kind === 'noAnswer') return { ok: false, key: 'deleteAccountPending' };
  try {
    await s.callDelete();
  } catch (err) {
    const key = serverErrorKey(err);
    if (key === 'deleteAccountFailed') {
      // The answer may be all that was lost: the connection dropped, or the call outlived its wait.
      const state = await s.accountState();
      if (state === 'gone') return done();
      if (state === 'unknown') return { ok: false, key: 'deleteAccountUnknown' };
    }
    s.report(err, 'Settings.deleteAccount');
    return { ok: false, key };
  }
  return done();
}

/** The keys this device keeps for one account, which a deleted account must not leave behind. */
export function accountKeys(uid: string): string[] {
  return [
    `ourdays.walletLedger:${uid}`, // utils/walletLedger.ts
    `warlord_save_${uid}`, `warlord_rev_${uid}`, // warlordCloud.ts
    `warlord_pvp_applied_${uid}`, // warlordPvp/pvpApi.ts
    'ourDays_draftEvent', // AddEventModal: a draft of THIS person's next event
  ];
}

/** Remove them. A storage that throws (private mode) has nothing to remove. */
export function forgetAccountOnDevice(uid: string, store: Pick<Storage, 'removeItem'> | null = safeLocalStorage()): void {
  if (!store) return;
  for (const key of accountKeys(uid)) {
    try { store.removeItem(key); } catch { /* nothing kept */ }
  }
}

function safeLocalStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Other tabs of the app. They are signed out with this one, but the Firestore cache this tab clears
 * is theirs too: clearing it shuts their Firestore down (read in the SDK by the review of 04.10.2026),
 * and a later sign-in there would hang. So they are told, and reload. A `storage` event reaches every
 * other tab of the origin and none of this one; the key is removed at once, it carries nothing.
 */
const OTHER_TABS_KEY = 'ourdays.accountDeletedHere';

export function tellOtherTabs(store: Pick<Storage, 'setItem' | 'removeItem'> | null = safeLocalStorage()): void {
  try {
    store?.setItem(OTHER_TABS_KEY, String(Date.now()));
    store?.removeItem(OTHER_TABS_KEY);
  } catch { /* they reload on their own next start */ }
}

/** Calls `reload` when another tab says its account was deleted. Returns the remover. */
export function onDeletedInAnotherTab(
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>, reload: () => void,
): () => void {
  const listener = (e: Event) => {
    const ev = e as StorageEvent;
    if (ev.key === OTHER_TABS_KEY && ev.newValue) reload();
  };
  win.addEventListener('storage', listener);
  return () => win.removeEventListener('storage', listener);
}

/** One message on the sign-in screen after the reload that ends a deletion. */
const NOTICE_KEY = 'ourdays.accountDeleted';

export function markAccountDeleted(store: Pick<Storage, 'setItem'> | null = safeSessionStorage()): void {
  try { store?.setItem(NOTICE_KEY, '1'); } catch { /* the notice is a courtesy */ }
}

/** Read once: true the first time after a deletion, false after that. */
export function takeAccountDeletedNotice(store: Pick<Storage, 'getItem' | 'removeItem'> | null = safeSessionStorage()): boolean {
  try {
    if (store?.getItem(NOTICE_KEY) !== '1') return false;
    store.removeItem(NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}

function safeSessionStorage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
