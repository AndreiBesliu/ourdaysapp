// src/utils/accountDeletion.test.ts
//
// What the app decides around deleting your own account (utils/accountDeletion.ts, 04.10.2026). The
// deleting itself is the server's, tested on the emulators in functions/test/deleteMyAccount.test.ts.

import { describe, it, expect } from 'vitest';
import {
  accountKeys, accountStateFrom, confirmationMatches, deleteOwnAccount, forgetAccountOnDevice,
  markAccountDeleted, mayBeGone, onDeletedInAnotherTab, reauthErrorKey, reauthMethod, serverErrorKey,
  takeAccountDeletedNotice, tellOtherTabs, type DeletionSteps,
} from './accountDeletion';
import { t } from './i18n';

const fail = (code: string, details?: unknown) => Object.assign(new Error(code), { code, details });

describe('the typed word', () => {
  it('in any case, with or without its diacritics', () => {
    expect(confirmationMatches('ȘTERGE', 'ȘTERGE')).toBe(true);
    expect(confirmationMatches('sterge', 'ȘTERGE')).toBe(true);
    expect(confirmationMatches('  Șterge ', 'ȘTERGE')).toBe(true);
    expect(confirmationMatches('loschen', 'LÖSCHEN')).toBe(true);
    expect(confirmationMatches('delete', 'DELETE')).toBe(true);
  });

  it('but not another word, part of it, or nothing', () => {
    expect(confirmationMatches('STERG', 'ȘTERGE')).toBe(false);
    expect(confirmationMatches('DELETE ME', 'DELETE')).toBe(false);
    expect(confirmationMatches('', 'DELETE')).toBe(false);
    expect(confirmationMatches('', '')).toBe(false);
  });

  it('every language has a word, and it is one a keyboard can type in capitals', () => {
    for (const lang of ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']) {
      const word = t('deleteAccountWord', lang);
      expect(word.trim(), lang).not.toBe('');
      expect(word, lang).toBe(word.toUpperCase());
      expect(t('deleteAccountTypeWord', lang), lang).toContain('{word}');
      expect(t('deletedAccountName', lang), lang).toContain('{name}');
    }
  });
});

describe('proving who you are again', () => {
  it('the password when the account has one, else Google', () => {
    expect(reauthMethod(['password'])).toBe('password');
    expect(reauthMethod(['google.com', 'password'])).toBe('password');
    expect(reauthMethod(['google.com'])).toBe('google');
  });

  it('a closed popup says nothing; a blocked one says how to fix it; a wrong password says so', () => {
    expect(reauthErrorKey(fail('auth/popup-closed-by-user'), 'google')).toBeNull();
    expect(reauthErrorKey(fail('auth/cancelled-popup-request'), 'google')).toBeNull();
    expect(reauthErrorKey(fail('auth/popup-blocked'), 'google')).toBe('deleteAccountPopupBlocked');
    expect(reauthErrorKey(fail('auth/wrong-password'), 'password')).toBe('deleteAccountWrongPassword');
    expect(reauthErrorKey(fail('auth/invalid-credential'), 'password')).toBe('deleteAccountWrongPassword');
    expect(reauthErrorKey(fail('auth/too-many-requests'), 'password')).toBe('authTooManyRequests');
    expect(reauthErrorKey(fail('auth/network-request-failed'), 'password')).toBe('deleteAccountOffline');
    expect(reauthErrorKey(new Error('?'), 'password')).toBe('deleteAccountReauthFailed');
  });

  it('"another account" means a different Google account was picked; with a password it is not that', () => {
    expect(reauthErrorKey(fail('auth/user-mismatch'), 'google')).toBe('deleteAccountWrongGoogle');
    expect(reauthErrorKey(fail('auth/user-mismatch'), 'password')).toBe('deleteAccountReauthFailed');
  });

  it('which failures could mean the account is already gone (measured on the Auth emulator)', () => {
    for (const c of ['auth/user-mismatch', 'auth/user-not-found', 'auth/user-token-expired', 'auth/invalid-credential']) {
      expect(mayBeGone(fail(c)), c).toBe(true);
    }
    for (const c of ['auth/popup-closed-by-user', 'auth/too-many-requests', 'auth/network-request-failed']) {
      expect(mayBeGone(fail(c)), c).toBe(false);
    }
  });
});

describe('what the server said', () => {
  it('its two refusals by their reason; anything else may have run part way', () => {
    expect(serverErrorKey(fail('functions/failed-precondition', { reason: 'recent-sign-in-required' }))).toBe('deleteAccountSignInAgain');
    expect(serverErrorKey(fail('functions/failed-precondition', { reason: 'admin-account' }))).toBe('deleteAccountAdmin');
    expect(serverErrorKey(fail('functions/unavailable'))).toBe('deleteAccountFailed');
    expect(serverErrorKey(fail('functions/internal'))).toBe('deleteAccountFailed');
    expect(serverErrorKey(null)).toBe('deleteAccountFailed');
  });
});

describe('does the account still exist', () => {
  it('a reload that works: here; one that says the account is gone: gone; anything else: unknown', async () => {
    expect(await accountStateFrom(async () => undefined)).toBe('here');
    expect(await accountStateFrom(() => Promise.reject(fail('auth/user-token-expired')))).toBe('gone');
    expect(await accountStateFrom(() => Promise.reject(fail('auth/user-not-found')))).toBe('gone');
    expect(await accountStateFrom(() => Promise.reject(fail('auth/network-request-failed')))).toBe('unknown');
    expect(await accountStateFrom(() => Promise.reject(new Error('?')))).toBe('unknown');
  });
});

describe('the order', () => {
  function steps(over: Partial<DeletionSteps> = {}) {
    const calls: string[] = [];
    const reports: string[] = [];
    const s: DeletionSteps = {
      onLine: true,
      method: 'password',
      reauthenticate: async () => { calls.push('reauth'); },
      drainWrites: async () => { calls.push('drain'); },
      callDelete: async () => { calls.push('delete'); },
      accountState: async () => { calls.push('state'); return 'here'; },
      afterDeleted: async () => { calls.push('after'); },
      report: (_e, context) => { reports.push(context); },
      drainMs: 50,
      ...over,
    };
    return { s, calls, reports };
  }

  it('prove who you are, let the queued writes land, delete, and only then clear the device', async () => {
    const { s, calls } = steps();
    expect(await deleteOwnAccount(s)).toEqual({ ok: true });
    expect(calls).toEqual(['reauth', 'drain', 'delete', 'after']);
  });

  it('the proof comes before ANY wait: a Google popup opened later is blocked as not from the click', async () => {
    const order: string[] = [];
    const { s } = steps({
      reauthenticate: async () => { order.push('reauth'); },
      drainWrites: () => { order.push('drain'); return Promise.resolve(); },
    });
    const p = deleteOwnAccount(s);
    // Synchronously, before any await of ours: the popup call has already been made.
    expect(order).toEqual(['reauth']);
    await p;
  });

  it('offline: nothing is asked or done', async () => {
    const { s, calls } = steps({ onLine: false });
    expect(await deleteOwnAccount(s)).toEqual({ ok: false, key: 'deleteAccountOffline' });
    expect(calls).toEqual([]);
  });

  it('a wrong password stops there, unreported, once the account is known to exist', async () => {
    const wrong = steps({ reauthenticate: () => Promise.reject(fail('auth/wrong-password')) });
    expect(await deleteOwnAccount(wrong.s)).toEqual({ ok: false, key: 'deleteAccountWrongPassword' });
    expect(wrong.calls).toEqual(['state']);
    expect(wrong.reports).toEqual([]);
  });

  it('an unexpected failure to prove it is reported, and asks nothing about the account', async () => {
    const odd = steps({ reauthenticate: () => Promise.reject(fail('auth/internal-error')) });
    expect(await deleteOwnAccount(odd.s)).toEqual({ ok: false, key: 'deleteAccountReauthFailed' });
    expect(odd.calls).toEqual([]);
    expect(odd.reports).toEqual(['Settings.deleteAccount.reauth']);
  });

  it('a retry after a deletion whose answer was lost: the account is gone, so the device is cleared', async () => {
    const { s, calls, reports } = steps({
      reauthenticate: () => Promise.reject(fail('auth/user-mismatch')),
      accountState: async () => { calls.push('state'); return 'gone'; },
    });
    expect(await deleteOwnAccount(s)).toEqual({ ok: true });
    expect(calls).toEqual(['state', 'after']);
    expect(reports).toEqual([]);
  });

  it('writes that never land: no deletion, and the device keeps everything', async () => {
    const { s, calls } = steps({ drainWrites: () => new Promise(() => {}) });
    expect(await deleteOwnAccount(s)).toEqual({ ok: false, key: 'deleteAccountPending' });
    expect(calls).toEqual(['reauth']);
  });

  it('a write the server refused has landed too: that is no reason to stop', async () => {
    const { s, calls } = steps({ drainWrites: () => Promise.reject(new Error('refused')) });
    expect(await deleteOwnAccount(s)).toEqual({ ok: true });
    expect(calls).toEqual(['reauth', 'delete', 'after']);
  });

  it('the server failing with the account still there: signed in, able to try again, reported', async () => {
    const { s, calls, reports } = steps({ callDelete: () => Promise.reject(fail('functions/unavailable')) });
    expect(await deleteOwnAccount(s)).toEqual({ ok: false, key: 'deleteAccountFailed' });
    expect(calls).toEqual(['reauth', 'drain', 'state']);
    expect(reports).toEqual(['Settings.deleteAccount']);
  });

  it('the answer lost but the account gone: it WAS deleted, so the device is cleared, nothing reported', async () => {
    const { s, calls, reports } = steps({
      callDelete: () => Promise.reject(fail('functions/internal')),
      accountState: async () => { calls.push('state'); return 'gone'; },
    });
    expect(await deleteOwnAccount(s)).toEqual({ ok: true });
    expect(calls).toEqual(['reauth', 'drain', 'state', 'after']);
    expect(reports).toEqual([]);
  });

  it('the answer lost and the account cannot be checked: says so, rather than "try again"', async () => {
    const { s, calls } = steps({
      callDelete: () => Promise.reject(fail('functions/internal')),
      accountState: async () => { calls.push('state'); return 'unknown'; },
    });
    expect(await deleteOwnAccount(s)).toEqual({ ok: false, key: 'deleteAccountUnknown' });
    expect(calls).not.toContain('after');
  });

  it('a refusal by reason is not second-guessed', async () => {
    const { s, calls } = steps({ callDelete: () => Promise.reject(fail('functions/failed-precondition', { reason: 'admin-account' })) });
    expect(await deleteOwnAccount(s)).toEqual({ ok: false, key: 'deleteAccountAdmin' });
    expect(calls).toEqual(['reauth', 'drain']);
  });

  it('a clean-up that throws does not leave the dialog spinning or call the deletion a failure', async () => {
    const { s } = steps({ afterDeleted: async () => { throw new Error('signOut failed'); } });
    expect(await deleteOwnAccount(s)).toEqual({ ok: true });
  });
});

describe('what this device forgets', () => {
  it('every key it keeps for that account, and nobody else’s', () => {
    const store = new Map<string, string>([
      ['ourdays.walletLedger:u1', '{}'], ['warlord_save_u1', '{}'], ['warlord_rev_u1', '3'],
      ['warlord_pvp_applied_u1', '[]'], ['ourDays_draftEvent', '{}'],
      ['ourdays.walletLedger:u2', '{}'], ['warlord_save_u2', '{}'], ['ourDays_language', 'ro-RO'],
    ]);
    forgetAccountOnDevice('u1', { removeItem: (k: string) => { store.delete(k); } });
    expect([...store.keys()].sort()).toEqual(['ourDays_language', 'ourdays.walletLedger:u2', 'warlord_save_u2']);
    expect(accountKeys('u1')).toContain('ourdays.walletLedger:u1');
  });

  it('a storage that throws has nothing to forget', () => {
    expect(() => forgetAccountOnDevice('u1', { removeItem: () => { throw new Error('private'); } })).not.toThrow();
    expect(() => forgetAccountOnDevice('u1', null)).not.toThrow();
  });
});

describe('the other tabs', () => {
  it('are told through a key that is set and removed at once, and reload on it alone', () => {
    const writes: string[] = [];
    tellOtherTabs({ setItem: (k) => { writes.push(`set ${k}`); }, removeItem: (k) => { writes.push(`remove ${k}`); } });
    expect(writes).toEqual(['set ourdays.accountDeletedHere', 'remove ourdays.accountDeletedHere']);

    const listeners: ((e: Event) => void)[] = [];
    let reloads = 0;
    const stop = onDeletedInAnotherTab({
      addEventListener: (_t: string, l: (e: Event) => void) => { listeners.push(l); },
      removeEventListener: () => { listeners.length = 0; },
    } as unknown as Window, () => { reloads++; });
    const fire = (key: string, newValue: string | null) => listeners.forEach((l) => l({ key, newValue } as unknown as Event));
    fire('ourdays.accountDeletedHere', null); // the removal that follows: not a second signal
    fire('ourdays.language', 'ro-RO');
    expect(reloads).toBe(0);
    fire('ourdays.accountDeletedHere', '1759600000000');
    expect(reloads).toBe(1);
    stop();
    expect(listeners).toHaveLength(0);
  });
});

describe('the notice after the reload', () => {
  it('is said once', () => {
    const m = new Map<string, string>();
    const store = {
      setItem: (k: string, v: string) => { m.set(k, v); },
      getItem: (k: string) => m.get(k) ?? null,
      removeItem: (k: string) => { m.delete(k); },
    };
    expect(takeAccountDeletedNotice(store)).toBe(false);
    markAccountDeleted(store);
    expect(takeAccountDeletedNotice(store)).toBe(true);
    expect(takeAccountDeletedNotice(store)).toBe(false);
  });

  it('and a storage that throws only loses the courtesy', () => {
    const broken = { setItem: () => { throw new Error('x'); }, getItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(() => markAccountDeleted(broken)).not.toThrow();
    expect(takeAccountDeletedNotice(broken)).toBe(false);
  });
});
