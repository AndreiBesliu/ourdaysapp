// src/offline/OfflineCards.tsx
//
// The offline Cards page (28.09.2026). Served by the service worker when a page of the app cannot be
// loaded, and at /offline/cards.html. It shows the Wallet's cards from the copy the app keeps
// (utils/offlineWallet.ts) and draws their codes with the SAME component the Wallet uses.
//
// Deliberately without Firebase, sign-in or the app's store: at a till with no signal it has to
// appear in about a second, and every one of those would wait for a network first. Read-only.
// It never navigates or reloads by itself; "Open the full app" acts only when tapped.
//
// An open card is a dialog like every other in the app (hooks/useDialog.ts, review 28.09): Android Back
// and Escape close it without leaving the page — which, launched offline from the icon, would close the
// app at the till — and focus returns to the card. It floats OVER the list rather than replacing it, so
// the card button it returns focus to still exists.

import { useEffect, useState } from 'react';
import AssetBarcode from '../components/AssetBarcode';
import { t } from '../utils/i18n';
import { rememberedLanguage } from '../utils/languagePref';
import { readOfflineWallet, type OfflineCard, type OfflineWallet } from '../utils/offlineWallet';
import { bannerFor, rowsFor, whenLabel } from './offlineView';
import { useDialog } from '../hooks/useDialog';

export default function OfflineCards({ initial }: { initial?: OfflineWallet | null }) {
  const language = rememberedLanguage();
  const [wallet, setWallet] = useState<OfflineWallet | null>(() => (initial !== undefined ? initial : readOfflineWallet()));
  const [open, setOpen] = useState<OfflineCard | null>(null);
  // "Now" for the freshness line, taken when the copy is (re)read rather than on every render.
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const { dialogRef, dialogProps } = useDialog(open !== null, () => setOpen(null), { label: open?.name });

  // Another tab of the app may rewrite the copy while this page is open.
  useEffect(() => {
    const reread = () => { setWallet(readOfflineWallet()); setNow(Date.now()); };
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('storage', reread);
    window.addEventListener('focus', reread);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('storage', reread);
      window.removeEventListener('focus', reread);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const banner = bannerFor(wallet, now);
  const rows = rowsFor(wallet, language);

  const openFullApp = () => {
    // Served in place of a page that failed to load: try that page again. Opened directly: the Wallet.
    const direct = window.location.pathname.startsWith('/offline/');
    window.location.assign(direct ? '/wallet' : window.location.href);
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="bg-white border-b border-zinc-200 px-4 py-3">
        <h1 className="text-xl font-bold">{t('offlineCardsTitle', language)}</h1>
        {banner === 'fresh' && wallet?.confirmedAt != null && (
          <p className="text-sm text-zinc-500 mt-1">
            {t('offlineCardsChecked', language).replace('{when}', whenLabel(wallet.confirmedAt, language))}
          </p>
        )}
        {banner === 'stale' && wallet?.confirmedAt != null && (
          <p className="text-sm text-amber-700 mt-1">
            {t('offlineCardsStale', language).replace('{when}', whenLabel(wallet.confirmedAt, language))}
          </p>
        )}
        {banner === 'never' && <p className="text-sm text-amber-700 mt-1">{t('offlineCardsNever', language)}</p>}
        {wallet?.pending && <p className="text-sm text-amber-700 mt-1">{t('offlineCardsPending', language)}</p>}
      </header>

      <main className="p-4 flex flex-col gap-2 max-w-xl mx-auto">
        {banner === 'none' || rows.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-10">{t('offlineCardsNone', language)}</p>
        ) : (
          rows.map((row) => {
            const card = wallet?.cards.find((c) => c.id === row.id) || null;
            return (
              <button
                key={row.id}
                type="button"
                disabled={!row.openable}
                onClick={() => card && setOpen(card)}
                className={`w-full text-left p-4 rounded-xl border ${row.openable ? 'bg-white border-zinc-200' : 'bg-zinc-100 border-zinc-200 text-zinc-500'}`}
              >
                <span className="block font-medium">{row.name}</span>
                {!row.openable && <span className="block text-xs mt-1">{t('offlineCardsNoCode', language)}</span>}
              </button>
            );
          })
        )}

        <button
          type="button"
          onClick={openFullApp}
          className={`mt-6 w-full py-3 rounded-xl text-sm font-medium ${online ? 'bg-blue-600 text-white' : 'bg-zinc-200 text-zinc-700'}`}
        >
          {t('offlineCardsOpenApp', language)}
        </button>
      </main>
      {open && (
        <div className="fixed inset-0 bg-white flex flex-col">
          <div ref={dialogRef} {...dialogProps} className="flex-1 flex flex-col outline-none">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-200">
              <h2 className="text-lg font-semibold text-zinc-900 truncate">{open.name}</h2>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="shrink-0 px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium"
              >
                {t('closeAction', language)}
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
              <AssetBarcode value={open.code} format={open.format} size="lg" language={language} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
