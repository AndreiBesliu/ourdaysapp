// src/components/DeleteAccountDialog.tsx
//
// "Delete my account", from Settings (Andrei, 04.10.2026). Says what goes and what stays, asks for
// a typed word and the password (or Google) again, then hands over to the server. The order and the
// messages are decided in utils/accountDeletion.ts; this is the form around them.

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { waitForPendingWrites } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';
import { useDialog } from '../hooks/useDialog';
import { reportError } from '../reportError';
import { deleteMyAccount } from '../serverActions';
import { accountStateFrom, confirmationMatches, deleteOwnAccount, reauthMethod } from '../utils/accountDeletion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Clears this device and signs out. Called only once the account is gone from the server, with its
   * uid read before: by then Auth may have signed the session out on its own.
   */
  afterDeleted(uid: string): Promise<void>;
}

export default function DeleteAccountDialog({ isOpen, onClose, afterDeleted }: Props) {
  const { language } = useThemeStore();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing closes the dialog while the deletion runs: a half-told outcome is worse than a wait. The
  // `false` tells the Back button the dialog stayed, so its history entry is put back
  // (hooks/useOverlayHistory.ts): otherwise the next Back would leave Settings mid-deletion, and a
  // failure would be told to nobody.
  const close = (): boolean | void => {
    if (busy) return false;
    setTyped('');
    setPassword('');
    setError(null);
    onClose();
  };
  const { dialogRef, dialogProps } = useDialog(isOpen, close, { label: t('deleteAccountTitle', language) });

  if (!isOpen) return null;

  const user = auth.currentUser;
  const method = reauthMethod((user?.providerData ?? []).map((p) => p.providerId));
  const word = t('deleteAccountWord', language);
  const ready = !!user && confirmationMatches(typed, word) && (method !== 'password' || password.length > 0) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !user) return;
    const uid = user.uid;
    setBusy(true);
    setError(null);
    const outcome = await deleteOwnAccount({
      onLine: navigator.onLine,
      method,
      reauthenticate: () => (method === 'password'
        ? reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password))
        : reauthenticateWithPopup(user, new GoogleAuthProvider())),
      drainWrites: () => waitForPendingWrites(db),
      callDelete: () => deleteMyAccount(),
      accountState: () => accountStateFrom(() => user.reload()),
      afterDeleted: () => afterDeleted(uid),
      report: (err, context) => reportError(err instanceof Error ? err.message : String(err), {
        context,
        stack: (err as { code?: string } | null)?.code ? `code=${(err as { code: string }).code}` : undefined,
      }),
    });
    // On success the page is already leaving (afterDeleted reloads to the sign-in screen).
    if (!outcome.ok) {
      setBusy(false);
      setError(outcome.key ? t(outcome.key, language) : null);
    }
  };

  return (
    <div onClick={close} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-500" />
            {t('deleteAccountTitle', language)}
          </h3>
          <button aria-label={t('closeAction', language)} onClick={close} disabled={busy} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          <ul className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 list-disc pl-5">
            <li>{t('deleteAccountGone', language)}</li>
            <li>{t('deleteAccountGroups', language)}</li>
            <li>{t('deleteAccountEvents', language)}</li>
            <li>{t('deleteAccountMessages', language)}</li>
          </ul>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t('deleteAccountIrreversible', language)}</p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('deleteAccountTypeWord', language).replace('{word}', word)}
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm rounded-lg p-2 outline-none focus:ring-2 focus:ring-red-500/40"
            />
          </label>

          {method === 'password' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{t('deleteAccountPassword', language)}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm rounded-lg p-2 outline-none focus:ring-2 focus:ring-red-500/40"
              />
            </label>
          ) : (
            <p className="text-xs text-zinc-500">{t('deleteAccountGoogleHint', language)}</p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-3">{error}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={close} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50">
              {t('cancel', language)}
            </button>
            <button type="submit" disabled={!ready} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              {busy && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
              {busy ? t('deleteAccountWorking', language) : t('deleteAccountConfirm', language)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
