// src/components/SeriesScopeDialog.tsx
//
// "Delete only this one, or the whole series?" — with a real way to say neither.
//
// It replaced a `window.confirm` whose Cancel button deleted the occurrence; see the header of
// `utils/deleteScope.ts`. Every way of dismissing this dialog — Cancel, the X, Escape, the Back
// button, a tap on the backdrop — reports `cancel`, and `cancel` writes nothing.

import { Repeat, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { t } from '../utils/i18n';
import type { DeleteScope } from '../utils/deleteScope';

interface SeriesScopeDialogProps {
  isOpen: boolean;
  language?: string;
  onChoose: (scope: DeleteScope) => void;
}

export default function SeriesScopeDialog({ isOpen, language, onChoose }: SeriesScopeDialogProps) {
  const dismiss = () => onChoose('cancel');
  // Above the early return, always: a hook below `if (!isOpen) return null` is React #310.
  const { dialogRef, dialogProps } = useDialog(isOpen, dismiss, {
    label: t('deleteSeriesScopeTitle', language),
  });

  if (!isOpen) return null;

  // The backdrop STOPS the click. This dialog renders inside EventDetailsModal, whose backdrop
  // closes it, and React bubbles through the component tree: a tap beside this question used to
  // close the event window as well. See SeriesScopeDialog.test.ts.
  return (
    <div onClick={(e) => { e.stopPropagation(); dismiss(); }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[210] flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} ref={dialogRef} {...dialogProps} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Repeat className="w-5 h-5 text-red-500" />
            {t('deleteSeriesScopeTitle', language)}
          </h3>
          <button type="button" aria-label={t('closeAction', language)} onClick={dismiss} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-200 dark:bg-zinc-800 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('deleteSeriesScopeBody', language)}</p>
          <button type="button" onClick={() => onChoose('one')} className="w-full py-2.5 rounded-xl font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
            {t('deleteOnlyThisOccurrence', language)}
          </button>
          <button type="button" onClick={() => onChoose('series')} className="w-full py-2.5 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 transition-colors">
            {t('deleteWholeSeries', language)}
          </button>
          {/* Cancel is a full-width button, not a small link: it is the answer people reach for
              when they did not mean it, and it used to be the one that deleted things. */}
          <button type="button" onClick={dismiss} className="w-full py-2.5 rounded-xl font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            {t('cancel', language)}
          </button>
        </div>
      </div>
    </div>
  );
}
