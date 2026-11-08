// src/utils/recentSignIn.test.ts
//
// A recent sign-in for the owner's actions (07.11.2026): the server's window (functions/src/recentSignIn.ts), the admin
// screen's "try, confirm it is you, try once more" (src/utils/recentSignIn.ts), and how the dialog and the screen are wired
// to them. The callables' refusals are run on the emulator in functions/test/adminRoster.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RECENT_SIGN_IN_S, SIGN_IN_AGAIN, signedInRecently } from '../../functions/src/recentSignIn';
import { asksToSignInAgain, confirmFailureRow, confirmItsYou, makeConfirmGate, withRecentSignIn } from './recentSignIn';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const refusal = (reason: unknown = SIGN_IN_AGAIN) => Object.assign(new Error('Confirm it\'s you'), { code: 'functions/failed-precondition', details: { reason } });
const authError = (code: string) => Object.assign(new Error(code), { code });

describe('the server’s window', () => {
  const NOW = 1_800_000_000;

  it('five minutes, the same for deleting your own account and for the owner’s actions', () => {
    expect(RECENT_SIGN_IN_S).toBe(300);
    expect(SIGN_IN_AGAIN).toBe('recent-sign-in-required');
    expect(read('functions/src/accountDeletion.ts')).toMatch(/import \{ RECENT_SIGN_IN_S, SIGN_IN_AGAIN, signedInRecently \} from "\.\/recentSignIn";/);
    expect(read('functions/src/accountDeletion.ts')).not.toMatch(/function signedInRecently|RECENT_SIGN_IN_S =/);
  });

  it('a sign-in within it is recent, up to the second; one past it is not', () => {
    expect(signedInRecently(NOW, NOW)).toBe(true);
    expect(signedInRecently(NOW - 300, NOW)).toBe(true);
    expect(signedInRecently(NOW - 301, NOW)).toBe(false);
  });

  it('a minute of clock difference ahead is tolerated, more is not; anything but a number is not a sign-in', () => {
    expect(signedInRecently(NOW + 60, NOW)).toBe(true);
    expect(signedInRecently(NOW + 61, NOW)).toBe(false);
    for (const odd of [undefined, null, String(NOW), NaN, Infinity, [NOW]]) expect(signedInRecently(odd, NOW), String(odd)).toBe(false);
  });
});

describe('the refusal the screen asks again on', () => {
  it('only the recent-sign-in reason', () => {
    expect(asksToSignInAgain(refusal())).toBe(true);
    expect(asksToSignInAgain(refusal('admin-account'))).toBe(false);
    expect(asksToSignInAgain(Object.assign(new Error('x'), { code: 'functions/permission-denied' }))).toBe(false);
    for (const odd of [null, undefined, 'recent-sign-in-required', { details: null }]) expect(asksToSignInAgain(odd)).toBe(false);
  });
});

describe('try, confirm it is you, try once more', () => {
  it('no refusal: runs once, never asks', async () => {
    const run = vi.fn().mockResolvedValue('done');
    const confirm = vi.fn();
    expect(await withRecentSignIn(run, confirm)).toEqual({ ok: true, value: 'done' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refused, confirmed: asked once, then run again, and its answer returned', async () => {
    const run = vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValueOnce('second');
    const confirm = vi.fn().mockResolvedValue(true);
    expect(await withRecentSignIn(run, confirm)).toEqual({ ok: true, value: 'second' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[1]);
  });

  it('refused, not confirmed: nothing runs again', async () => {
    const run = vi.fn().mockRejectedValue(refusal());
    expect(await withRecentSignIn(run, () => Promise.resolve(false))).toEqual({ ok: false });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refused again after confirming: that refusal is thrown, not asked about in a loop', async () => {
    const second = refusal();
    const run = vi.fn().mockRejectedValueOnce(refusal()).mockRejectedValueOnce(second);
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(withRecentSignIn(run, confirm)).rejects.toBe(second);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('any other failure is thrown as it came, without asking', async () => {
    const other = Object.assign(new Error('Only an owner can send a broadcast.'), { code: 'functions/permission-denied' });
    const confirm = vi.fn();
    await expect(withRecentSignIn(() => Promise.reject(other), confirm)).rejects.toBe(other);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('confirming it is you', () => {
  const steps = (over: Partial<Parameters<typeof confirmItsYou>[0]> = {}) => {
    const order: string[] = [];
    return {
      order,
      s: {
        method: 'password' as const,
        reauthenticate: async () => { order.push('reauth'); },
        refreshToken: async () => { order.push('refresh'); },
        ...over,
      },
    };
  };

  it('signs in again, then refreshes the token, so the next call carries the new sign-in time', async () => {
    const { s, order } = steps();
    expect(await confirmItsYou(s)).toEqual({ ok: true });
    expect(order).toEqual(['reauth', 'refresh']);
  });

  it('a wrong password says so, in English, and is not reported; nothing is refreshed', async () => {
    const { s, order } = steps({ reauthenticate: () => Promise.reject(authError('auth/invalid-credential')) });
    expect(await confirmItsYou(s)).toEqual({ ok: false, message: 'That password is not right.', report: false });
    expect(order).toEqual([]);
  });

  it('the Google window closed: nothing to say', async () => {
    const { s } = steps({ method: 'google', reauthenticate: () => Promise.reject(authError('auth/popup-closed-by-user')) });
    expect(await confirmItsYou(s)).toEqual({ ok: false, message: null, report: false });
  });

  it('another Google account, a blocked window, no connection: each says what to do', async () => {
    const g = (code: string) => confirmItsYou(steps({ method: 'google', reauthenticate: () => Promise.reject(authError(code)) }).s);
    expect(await g('auth/user-mismatch')).toMatchObject({ message: expect.stringContaining('different Google account') });
    expect(await g('auth/popup-blocked')).toMatchObject({ message: expect.stringContaining('blocked the Google window') });
    // Not the deletion's sentence ("Deleting your account needs a connection").
    expect(await g('auth/network-request-failed')).toEqual({ ok: false, message: 'Confirming it is you needs a connection.', report: false });
  });

  it('an unexpected failure says to try again and is worth a row, with its cause; so is a refresh that fails', async () => {
    const internal = authError('auth/internal-error');
    expect(await confirmItsYou(steps({ reauthenticate: () => Promise.reject(internal) }).s))
      .toEqual({ ok: false, message: 'Your identity could not be confirmed. Try again.', report: true, cause: internal });
    const refresh = Object.assign(new Error('Token refresh failed'), { code: 'auth/network-request-failed' });
    expect(await confirmItsYou(steps({ refreshToken: () => Promise.reject(refresh) }).s)).toMatchObject({ ok: false, report: true, cause: refresh });
  });

  it('the row says which cause: the error\u2019s own message and code; without a cause, the sentence', () => {
    expect(confirmFailureRow({ message: 'Your identity could not be confirmed. Try again.', cause: authError('auth/unauthorized-domain') }))
      .toEqual({ message: 'auth/unauthorized-domain', stack: 'code=auth/unauthorized-domain' });
    expect(confirmFailureRow({ message: 'Confirmed, but…', cause: new Error('boom') })).toEqual({ message: 'boom' });
    expect(confirmFailureRow({ message: 'Confirmed, but…' })).toEqual({ message: 'Confirmed, but…' });
    expect(confirmFailureRow({ message: null })).toEqual({ message: 'reauthentication failed' });
  });
});

describe('the question and its answer (the gate the admin screen awaits)', () => {
  it('asking opens the dialog; the answer closes it and settles the question with it', async () => {
    const open = vi.fn();
    const gate = makeConfirmGate(open);
    const asked = gate.ask();
    expect(open).toHaveBeenLastCalledWith(true);
    gate.answer(true);
    expect(open).toHaveBeenLastCalledWith(false);
    await expect(asked).resolves.toBe(true);
  });

  it('closed without confirming: no', async () => {
    const gate = makeConfirmGate(() => {});
    const asked = gate.ask();
    gate.answer(false);
    await expect(asked).resolves.toBe(false);
  });

  it('asked again before an answer: the older question is answered no, and the answer goes to the newer one', async () => {
    const gate = makeConfirmGate(() => {});
    const first = gate.ask();
    const second = gate.ask();
    await expect(first).resolves.toBe(false);
    gate.answer(true);
    await expect(second).resolves.toBe(true);
  });

  it('an answer with no question pending is harmless, and is not kept for the next one', async () => {
    const gate = makeConfirmGate(() => {});
    gate.answer(true);
    const asked = gate.ask();
    gate.answer(false);
    await expect(asked).resolves.toBe(false);
  });
});

describe('the wiring', () => {
  const DIALOG = read('src/components/ConfirmItsYouDialog.tsx');
  const ADMIN = read('src/screens/Admin.tsx');

  it('the dialog signs in again with the password, or with Google, and refreshes the token', () => {
    expect(DIALOG).toMatch(/reauthenticateWithCredential\(user, EmailAuthProvider\.credential\(user\.email \?\? '', password\)\)/);
    expect(DIALOG).toMatch(/reauthenticateWithPopup\(user, new GoogleAuthProvider\(\)\)/);
    expect(DIALOG).toContain('refreshToken: () => user.getIdToken(true),');
    // The method from the person's own providers, as "Delete my account" takes it (reverify of 07.11.2026).
    expect(DIALOG).toContain('const method = reauthMethod((user?.providerData ?? []).map((p) => p.providerId));');
    // A reported failure goes to the error log with its cause's message and code.
    expect(DIALOG).toMatch(/if \(outcome\.report\) \{\s*const row = confirmFailureRow\(outcome\);\s*reportError\(row\.message, \{ context: 'Admin\.confirmItsYou', stack: row\.stack \}\);\s*\}/);
    // Each method to its own step, the yes handed back only on success, and no closing while it works (review of 07.11.2026).
    expect(DIALOG).toMatch(/reauthenticate: \(\) => \(method === 'password'\s*\?\s*reauthenticateWithCredential\(/);
    expect(DIALOG).toMatch(/if \(outcome\.ok\) \{\s*setPassword\(''\);\s*onDone\(true\);\s*return;\s*\}/);
    expect(DIALOG.match(/onDone\(true\)/g)).toHaveLength(1);
    expect(DIALOG).toMatch(/const close = \(\): boolean \| void => \{\s*if \(busy\) return false;/);
  });

  it('the screen runs each owner action through it: the roster, the broadcast, the AI budget', () => {
    expect(ADMIN).toMatch(/withRecentSignIn\(\(\) => adminSetAdmin\(/);
    expect(ADMIN).toMatch(/withRecentSignIn\(\(\) => adminBroadcast\(/);
    expect(ADMIN).toMatch(/withRecentSignIn\(\(\) => adminSetAiConfig\(/);
    // And none of them is called outside it.
    expect(ADMIN).toMatch(/withRecentSignIn\(\(\) => adminModerateUser\(/);
    for (const fn of ['adminSetAdmin', 'adminBroadcast', 'adminSetAiConfig', 'adminModerateUser']) {
      const calls = ADMIN.match(new RegExp(`\\b${fn}\\(`, 'g')) ?? [];
      expect(calls, fn).toHaveLength(1);
    }
    expect(ADMIN).toContain('<ConfirmItsYouDialog isOpen={confirmOpen} onDone={answerConfirm} />');
    // The gate is made once, around the dialog's own open state.
    expect(ADMIN).toContain('const [confirmGate] = useState(() => makeConfirmGate(setConfirmOpen));');
    expect(ADMIN).toContain('const confirmItsYou = confirmGate.ask;');
    expect(ADMIN).toContain('const answerConfirm = confirmGate.answer;');
  });
});
