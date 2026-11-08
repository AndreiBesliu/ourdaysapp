// src/components/ConfirmItsYouDialog.tsx
//
// "Confirm it's you" (07.11.2026): the owner's actions in the admin need a sign-in from the last few minutes
// (functions/src/recentSignIn.ts). Asks for the password, or for Google once more, then hands back. What the steps are
// and what each failure says are in utils/recentSignIn.ts; this is the form around them. English, like the admin.

import { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { useDialog } from '../hooks/useDialog';
import { reportError } from '../reportError';
import { reauthMethod } from '../utils/accountDeletion';
import { confirmFailureRow, confirmItsYou } from '../utils/recentSignIn';

interface Props {
  isOpen: boolean;
  /** `true` once the person has signed in again and the session carries it; `false` when they closed the dialog. */
  onDone(confirmed: boolean): void;
}

export default function ConfirmItsYouDialog({ isOpen, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Not closed while it works: the answer would land on nobody (the same rule as DeleteAccountDialog).
  const close = (): boolean | void => {
    if (busy) return false;
    setPassword('');
    setError(null);
    onDone(false);
  };
  const { dialogRef, dialogProps } = useDialog(isOpen, close, { label: "Confirm it's you" });

  if (!isOpen) return null;

  const user = auth.currentUser;
  const method = reauthMethod((user?.providerData ?? []).map((p) => p.providerId));
  const ready = !!user && (method !== 'password' || password.length > 0) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !user) return;
    setBusy(true);
    setError(null);
    const outcome = await confirmItsYou({
      method,
      reauthenticate: () => (method === 'password'
        ? reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password))
        : reauthenticateWithPopup(user, new GoogleAuthProvider())),
      refreshToken: () => user.getIdToken(true),
    });
    setBusy(false);
    if (outcome.ok) {
      setPassword('');
      onDone(true);
      return;
    }
    if (outcome.report) {
      const row = confirmFailureRow(outcome);
      reportError(row.message, { context: 'Admin.confirmItsYou', stack: row.stack });
    }
    setError(outcome.message);
  };

  return (
    <div onClick={close} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[210] flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Confirm it&apos;s you
          </h3>
          <button aria-label="Close" onClick={close} disabled={busy} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This needs a sign-in from the last 5 minutes, like changing the admins, a broadcast, raising the AI budget,
            and deleting, re-enabling or verifying an account.
          </p>
          {method === 'password' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Your password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm rounded-lg p-2 outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">You will be asked to sign in with Google once more.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-3">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={close} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={!ready} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
              {busy && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
              {method === 'password' ? 'Confirm' : 'Continue with Google'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
