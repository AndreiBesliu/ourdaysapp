// src/utils/recentSignIn.ts
//
// The owner's actions in the admin need a sign-in from the last few minutes (07.11.2026; the server's window and its
// refusal are in functions/src/recentSignIn.ts). The admin screen does not guess the window: it tries, and when the server
// refuses for that reason it asks the person to confirm it is them (src/components/ConfirmItsYouDialog.tsx), then tries
// once more. Deleting your own account asks first instead (utils/accountDeletion.ts), because there the dialog asks for
// the password anyway.

import { SIGN_IN_AGAIN } from '../../functions/src/recentSignIn';
import { reauthErrorKey } from './accountDeletion';
import { t } from './i18n';

/** Whether a callable refused because the sign-in is too old. */
export function asksToSignInAgain(err: unknown): boolean {
  const reason = (err as { details?: { reason?: unknown } } | null)?.details?.reason;
  return reason === SIGN_IN_AGAIN;
}

export type AfterSignIn<T> = { ok: true; value: T } | { ok: false };

/**
 * Run `run`. If the server asks for a recent sign-in, ask `confirmItsYou`; when it says yes, run again, once. A second
 * refusal, or any other failure, is thrown as it came. `{ ok: false }`: the person did not confirm, and nothing ran.
 */
export async function withRecentSignIn<T>(run: () => Promise<T>, confirmItsYou: () => Promise<boolean>): Promise<AfterSignIn<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (!asksToSignInAgain(err)) throw err;
  }
  if (!(await confirmItsYou())) return { ok: false };
  return { ok: true, value: await run() };
}

export interface ConfirmSteps {
  method: 'password' | 'google';
  /** `reauthenticateWithCredential` with the password, or `reauthenticateWithPopup` with Google. */
  reauthenticate: () => Promise<unknown>;
  /** `user.getIdToken(true)`: the next call carries the new `auth_time`. */
  refreshToken: () => Promise<unknown>;
}

/**
 * `message: null`: the person closed the Google window, so there is nothing to say. `report`: worth an error row, and then
 * `cause` is the error itself, so the row can say which (review of 07.11.2026: one sentence for every cause told nothing).
 */
export type ConfirmOutcome = { ok: true } | { ok: false; message: string | null; report: boolean; cause?: unknown };

/**
 * Prove it is them again. The messages are the ones "Delete my account" uses (utils/accountDeletion.ts), in English like
 * the rest of the admin, except the one about the connection, which there speaks of deleting the account.
 */
export async function confirmItsYou(s: ConfirmSteps): Promise<ConfirmOutcome> {
  try {
    await s.reauthenticate();
  } catch (err) {
    const key = reauthErrorKey(err, s.method);
    if (key === null) return { ok: false, message: null, report: false };
    if (key === 'deleteAccountOffline') return { ok: false, message: 'Confirming it is you needs a connection.', report: false };
    const report = key === 'deleteAccountReauthFailed';
    return report ? { ok: false, message: t(key, 'en-US'), report, cause: err } : { ok: false, message: t(key, 'en-US'), report };
  }
  try {
    await s.refreshToken();
  } catch (err) {
    return { ok: false, message: 'Confirmed, but the session could not be refreshed. Try again.', report: true, cause: err };
  }
  return { ok: true };
}

/** What an error row says about a failed confirmation: the error's own message, and its code where it has one. */
export function confirmFailureRow(outcome: { message: string | null; cause?: unknown }): { message: string; stack?: string } {
  const c = outcome.cause as { message?: unknown; code?: unknown } | null | undefined;
  const message = (typeof c?.message === 'string' && c.message) || outcome.message || 'reauthentication failed';
  return typeof c?.code === 'string' && c.code ? { message, stack: `code=${c.code}` } : { message };
}

/**
 * The question "confirm it's you" as a promise the screen awaits, and its answer. One question at a time: asking again
 * answers the older one "no", so no action waits for ever (review of 07.11.2026: this lived untested in Admin.tsx).
 */
export function makeConfirmGate(setOpen: (open: boolean) => void) {
  let pending: ((confirmed: boolean) => void) | null = null;
  return {
    ask(): Promise<boolean> {
      pending?.(false);
      return new Promise<boolean>((resolve) => {
        pending = resolve;
        setOpen(true);
      });
    },
    answer(confirmed: boolean): void {
      setOpen(false);
      const p = pending;
      pending = null;
      p?.(confirmed);
    },
  };
}
