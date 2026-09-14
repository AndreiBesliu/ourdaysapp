// src/screens/JoinInvite.tsx
// What somebody sees when they open an invitation link.
//
// This is the ONLY route in the app that renders signed out, and it has to be: the person opening
// it may have no account at all, which is the entire reason link invitations exist. So it does
// the two halves in order — say what the invitation is FIRST, ask for an account second. A
// stranger who lands on a login form with no explanation closes the tab.
//
// `peekGroupInviteLink` is the callable that makes that possible: it runs unauthenticated and
// returns only what a paper invitation would carry — who invited you, and to what. Never the
// member list, never anybody's email.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { UserPlus, CheckCircle2, AlertCircle, LogIn, Loader2 } from 'lucide-react';
import { auth } from '../firebase';
import { peekGroupInviteLink, redeemGroupInviteLink } from '../serverActions';
import { reportError } from '../reportError';
import { useThemeStore } from '../store';
import { t } from '../utils/i18n';

/** Where the code waits while somebody signs up. Read by App.tsx after login. */
export const PENDING_INVITE_KEY = 'ourdays.pendingInvite';

export function rememberPendingInvite(code: string): void {
  try { localStorage.setItem(PENDING_INVITE_KEY, code); } catch { /* private mode */ }
}

/** Read WITHOUT consuming — App uses this to decide where to send somebody after login. */
export function peekPendingInvite(): string | null {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || null; } catch { return null; }
}

export function takePendingInvite(): string | null {
  try {
    const code = localStorage.getItem(PENDING_INVITE_KEY);
    if (code) localStorage.removeItem(PENDING_INVITE_KEY);
    return code || null;
  } catch {
    // Storage can throw outright, not just return null (private windows, blocked site data).
    // An invitation that cannot be remembered is a worse outcome than a crash here would be.
    return null;
  }
}

type Phase = 'loading' | 'preview' | 'joining' | 'done' | 'error';

export default function JoinInvite() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { language } = useThemeStore();

  const [phase, setPhase] = useState<Phase>('loading');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [joinedGroup, setJoinedGroup] = useState(false);
  const [problem, setProblem] = useState<string>('');

  useEffect(() => onAuthStateChanged(auth, (u) => setSignedIn(!!u)), []);

  // Arriving here IS the pending invitation being served, so the note to self is torn up now
  // rather than after a successful join: a code left behind would hijack the next login.
  useEffect(() => { takePendingInvite(); }, []);

  // What is this invitation for? Asked before anything else, and without needing an account.
  useEffect(() => {
    let cancelled = false;
    if (!code) { setPhase('error'); setProblem(t('joinInvalid', language)); return; }
    (async () => {
      try {
        const info = await peekGroupInviteLink(code);
        if (cancelled) return;
        setInvitedBy(info.invitedBy);
        setGroupName(info.groupName);
        if (info.alreadyJoined) {
          // A link is good for one registration, so the person who used it IS the use. Reopening
          // their own link out of a chat thread is ordinary, and must not be answered with an
          // error about the invitation being spent.
          setPhase('done');
          return;
        }
        if (!info.valid) {
          setPhase('error');
          setProblem(t(
            info.reason === 'expired' ? 'joinExpired'
              : info.reason === 'spent' ? 'joinSpent'
                : info.reason === 'revoked' ? 'joinRevoked'
                  : 'joinInvalid',
            language,
          ));
          return;
        }
        setPhase('preview');
      } catch (err) {
        if (cancelled) return;
        reportError(err instanceof Error ? err.message : String(err), { context: 'JoinInvite.peek' });
        setPhase('error');
        setProblem(t('joinInvalid', language));
      }
    })();
    return () => { cancelled = true; };
  }, [code, language]);

  const accept = async () => {
    setPhase('joining');
    try {
      const res = await redeemGroupInviteLink(code);
      setInvitedBy(res.invitedBy || invitedBy);
      setGroupName(res.groupName || groupName);
      setJoinedGroup(res.joinedGroup);
      setPhase('done');
    } catch (err: any) {
      reportError(err instanceof Error ? err.message : String(err), { context: 'JoinInvite.redeem' });
      setPhase('error');
      // The server's codes carry the reason; anything else gets the generic line rather than a
      // raw server string, which would be English in a six-language app.
      const code0 = String(err?.code || '');
      setProblem(
        code0.includes('resource-exhausted') ? t('joinSpent', language)
          : code0.includes('failed-precondition') ? t('joinExpired', language)
            : code0.includes('not-found') ? t('joinInvalid', language)
              : t('joinFailed', language),
      );
    }
  };

  const goSignIn = () => {
    rememberPendingInvite(code);
    navigate('/login');
  };

  const line = (() => {
    if (!invitedBy) return t('joinGenericInvite', language);
    return groupName
      ? t('joinInvitesYouToGroup', language).replace('{name}', invitedBy).replace('{group}', groupName)
      : t('joinInvitesYou', language).replace('{name}', invitedBy);
  })();

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl w-full max-w-sm p-7 flex flex-col items-center gap-5 text-center">

        {phase === 'loading' && (
          <Loader2 className="w-8 h-8 text-primary animate-spin" aria-hidden="true" />
        )}

        {phase === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-red-500" aria-hidden="true" />
            <p className="text-zinc-900 dark:text-zinc-100 font-medium">{problem}</p>
            <button
              onClick={() => navigate('/')}
              className="w-full py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              {t('joinOpenApp', language)}
            </button>
          </>
        )}

        {phase === 'preview' && (
          <>
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <UserPlus className="w-7 h-7 text-primary" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{t('joinTitle', language)}</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{line}</p>
            </div>

            {signedIn === false && (
              <>
                <p className="text-xs text-zinc-500">{t('joinSignInToAccept', language)}</p>
                <button
                  onClick={goSignIn}
                  className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  {t('joinSignInButton', language)}
                </button>
              </>
            )}

            {signedIn === true && (
              <button
                onClick={accept}
                className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold hover:opacity-90 transition-opacity"
              >
                {t('joinAccept', language)}
              </button>
            )}
          </>
        )}

        {phase === 'joining' && (
          <>
            <Loader2 className="w-8 h-8 text-primary animate-spin" aria-hidden="true" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('joinAccepting', language)}</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-500" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{t('joinWelcome', language)}</h1>
              {joinedGroup && groupName && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {t('joinJoinedGroup', language).replace('{group}', groupName)}
                </p>
              )}
              {invitedBy && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {t('joinNowFriends', language).replace('{name}', invitedBy)}
                </p>
              )}
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold hover:opacity-90 transition-opacity"
            >
              {t('joinOpenApp', language)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
