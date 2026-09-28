// src/components/OfflineCardsStatus.tsx
//
// One line on the Wallet: whether these cards can be shown with no network, and a link to the
// offline Cards page itself (bookmarkable, and the instant path with signal but no data). 28.09.2026.
//
// Ready means both halves are on this device: the copy of THIS account's cards
// (utils/offlineWallet.ts) and the page, stored by the service worker (public/sw.js). Nothing is
// shown where the browser has no service worker at all: a line that can never turn green says nothing.

import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { t } from '../utils/i18n';
import { readOfflineWallet } from '../utils/offlineWallet';
import { offlineCardsEnabled } from '../utils/offlineCardsFlag';
import { offlineStatus } from '../utils/offlineStatus';
import { whenLabel } from '../offline/offlineView';

// Optional because the theme store types it so; `t()` falls back to en-US.
export default function OfflineCardsStatus({ language }: { language?: string }) {
  const [copy, setCopy] = useState(() => readOfflineWallet());
  const [pageStored, setPageStored] = useState<boolean | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    let live = true;
    const reread = () => setCopy(readOfflineWallet());
    const check = async () => {
      try {
        if (!navigator.serviceWorker?.controller || typeof caches === 'undefined') { if (live) setPageStored(null); return; }
        const hit = await caches.match('/offline/cards.html');
        if (live) setPageStored(!!hit);
      } catch {
        if (live) setPageStored(null);
      }
    };
    void check();
    // The copy is written by this same tab, which raises no 'storage' event here: re-read on a timer.
    const id = window.setInterval(() => { reread(); void check(); }, 10_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('storage', reread);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener('storage', reread);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!offlineCardsEnabled()) return null;
  const status = offlineStatus(copy, auth.currentUser?.uid ?? null, pageStored, online);
  if (status.kind === 'unsupported') return null;
  if (status.kind === 'ready') {
    if (status.when === null) {
      // Kept, but never confirmed by the server: offline it shows what this browser last held.
      return (
        <a href="/offline/cards.html" className="self-start text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline">
          {t('walletOfflineUnconfirmed', language)}
        </a>
      );
    }
    return (
      <a href="/offline/cards.html" className="self-start text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
        {t('walletOfflineReady', language).replace('{when}', whenLabel(status.when, language || 'en-US'))}
      </a>
    );
  }
  return (
    <p className="text-xs text-zinc-500">
      {status.kind === 'preparing' ? t('walletOfflinePreparing', language) : t('walletOfflineNotReady', language)}
    </p>
  );
}
