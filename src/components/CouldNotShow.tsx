// src/components/CouldNotShow.tsx
//
// What a window shows instead of itself when what it was opened on cannot be drawn (08.10.2026): a
// note and a way out, over the screen it was opened from, which keeps working. Used as the `fallback`
// of the ErrorBoundary around the event windows; the crash itself is reported by the boundary.
//
// A note that tells the person to reload the page also offers the reload (07.11.2026). Those notes are
// the windows whose code could not be loaded, and on Chromium nothing short of a reload fetches a failed
// chunk again (the browser keeps the failure for the life of the page; components/GroupChatWidgetOnDemand.tsx).
// An offer, never by itself: somebody may be typing in another window.

import { X } from 'lucide-react';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';

/** The notes whose text asks for a reload, and so carry the button (lazyWindows.test.tsx holds the two together). */
export const NOTES_ASKING_FOR_RELOAD: readonly string[] = ['windowCouldNotOpen', 'inviteCouldNotOpen'];

export default function CouldNotShow({ messageKey, onClose }: { messageKey: string; onClose: () => void }) {
  const { language } = useThemeStore();
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl p-5 flex items-start gap-3">
        <div className="flex-1">
          <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300">{t(messageKey, language)}</p>
          {NOTES_ASKING_FOR_RELOAD.includes(messageKey) && (
            <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-[44px] px-4 rounded-lg bg-primary text-white text-sm font-medium">
              {t('errorReload', language)}
            </button>
          )}
        </div>
        <button onClick={onClose} aria-label={t('closeAction', language)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
