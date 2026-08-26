// src/components/NewVersionNotice.tsx
//
// Tells you when the tab you are looking at is running an older build than the server has.
//
// It never reloads for you. This app is a chat: an automatic reload while someone is halfway
// through a message throws that message away, and the person has no idea why. So the notice states
// the fact and leaves the moment to them.
//
// It is dismissible per version — closing it means "not now, for THIS build", and the next deploy
// asks again. Dismissal is kept in sessionStorage rather than localStorage on purpose: it should
// not outlive the tab it was about.

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';
import { checkForNewVersion } from '../utils/appVersion';

const CHECK_EVERY_MS = 15 * 60 * 1000;
const DISMISS_KEY = 'ourdays.updateDismissed';

export default function NewVersionNotice() {
  const { language } = useThemeStore();
  const [stale, setStale] = useState(false);
  // A check in flight must not be started twice by a visibility change landing on top of the timer.
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const look = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await checkForNewVersion();
        // `unknown` (offline, dev, unparsable) deliberately does NOT clear an existing notice:
        // once we have seen a newer build, going offline does not make it go away.
        if (!cancelled && result === 'new') setStale(true);
      } finally {
        busy.current = false;
      }
    };

    void look();
    const timer = window.setInterval(look, CHECK_EVERY_MS);
    // The interesting moment is coming back to a tab left open overnight, which is exactly when a
    // background timer may have been throttled to nothing.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void look();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!stale) return null;

  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode or a locked-down webview: showing the notice is the safe side of that failure.
  }
  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Nothing to do; the notice simply reappears on the next check.
    }
    setStale(false);
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 px-4 py-3 shadow-lg w-[calc(100vw-2rem)] sm:w-auto sm:max-w-[calc(100vw-2rem)]"
    >
      {/* No truncate: on a 375px phone the sentence is the whole point, and ellipsising it left
          "A aparut o versiune mai...". It wraps instead; the pill is rare enough to afford a line. */}
      <span className="text-sm text-white dark:text-zinc-900 leading-snug">
        {t('newVersionAvailable', language)}
      </span>
      <div className="flex items-center gap-2 sm:contents">
      <button
        onClick={() => window.location.reload()}
        className="flex-1 sm:flex-none shrink-0 flex items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {t('newVersionReload', language)}
      </button>
      <button
        onClick={dismiss}
        aria-label={t('newVersionDismiss', language)}
        title={t('newVersionDismiss', language)}
        className="shrink-0 p-1 text-zinc-400 hover:text-white dark:hover:text-zinc-900 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      </div>
    </div>
  );
}
