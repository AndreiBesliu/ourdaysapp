import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { MailWarning, X } from 'lucide-react';
import { auth } from '../firebase';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';

// Prompts email/password users to confirm their address. Google users are
// already verified so this never shows for them. Accepting invites / friend
// requests addressed to your EMAIL requires a verified address (server-enforced).
export default function VerifyEmailBanner() {
  const { language } = useThemeStore();
  const [verified, setVerified] = useState(auth.currentUser?.emailVerified ?? true);
  const [dismissed, setDismissed] = useState(false);
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillNot, setStillNot] = useState(false);

  if (verified || dismissed || !auth.currentUser) return null;

  const resend = async () => {
    try {
      await sendEmailVerification(auth.currentUser!);
      setResent(true);
      setStillNot(false);
    } catch (e) {
      console.error('Resend verification failed', e);
    }
  };

  const recheck = async () => {
    setChecking(true);
    setStillNot(false);
    try {
      await auth.currentUser!.reload();
      // Force a fresh ID token so the email_verified claim reaches rules / functions.
      await auth.currentUser!.getIdToken(true);
      const ok = auth.currentUser!.emailVerified;
      setVerified(ok);
      if (!ok) setStillNot(true); // tell the user the recheck found them still unverified
    } catch (e) {
      console.error('Recheck verification failed', e);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg shrink-0">
          <MailWarning className="w-5 h-5" />
        </div>
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{t('verifyEmailTitle', language)}</p>
          <p className={`text-sm ${stillNot ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>
            {stillNot ? t('stillNotVerified', language) : resent ? t('verifyEmailResent', language) : t('verifyEmailDesc', language)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={resend} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors">
          {t('resendEmail', language)}
        </button>
        <button onClick={recheck} disabled={checking} className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50">
          {t('iVerified', language)}
        </button>
        <button onClick={() => setDismissed(true)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
