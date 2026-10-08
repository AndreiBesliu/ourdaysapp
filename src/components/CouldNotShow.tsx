// src/components/CouldNotShow.tsx
//
// What a window shows instead of itself when what it was opened on cannot be drawn (08.10.2026): a
// note and a way out, over the screen it was opened from, which keeps working. Used as the `fallback`
// of the ErrorBoundary around the event windows; the crash itself is reported by the boundary.

import { X } from 'lucide-react';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';

export default function CouldNotShow({ messageKey, onClose }: { messageKey: string; onClose: () => void }) {
  const { language } = useThemeStore();
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl p-5 flex items-start gap-3">
        <p role="alert" className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">{t(messageKey, language)}</p>
        <button onClick={onClose} aria-label={t('closeAction', language)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
