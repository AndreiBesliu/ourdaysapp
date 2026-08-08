import { useEffect, useMemo, useState } from 'react';
import { useThemeStore } from '../store';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import WarlordApp from '@warlord/App';
import PvpPanel from '../warlordPvp/PvpPanel';
import { loadWarlordDomain, createDomainSync } from '../warlordCloud';
import { loadWarlordConfig } from '../warlordAdmin/configApi';
import WarlordAdminPanel from '../warlordAdmin/WarlordAdminPanel';
import { adminCheck } from '../serverActions';
import type { GameConfigOverrides } from '@warlord/logic/config';

// Embedded Warlord game, mounted as its own full-width route. Two views:
//  • Domain — the single-player game. State is CLOUD-BACKED (warlordDomains/{uid} in
//    Firestore, cached in localStorage) so a user's kingdom follows them across devices.
//  • PvP — server-authoritative battles vs other users (Firestore + callables).
// Only ONE view is mounted at a time: the PvP write-back edits the local save (and
// pushes to the cloud), which is only safe while the Domain game is unmounted.
export default function Warlord() {
  const navigate = useNavigate();
  const [view, setView] = useState<'DOMAIN' | 'PVP' | 'ADMIN'>('DOMAIN');
  // Admin entry is UI-only sugar; the Firestore rules are what actually gate the write.
  const [isAdmin, setIsAdmin] = useState(false);
  // Admin-tuned balance values, loaded once alongside the domain (null = pure defaults).
  const [config, setConfig] = useState<GameConfigOverrides | null>(null);
  // Switching away from the admin unmounts it and discards every unsaved edit. The
  // natural way to check a balance change is to go and look at the game — so the natural
  // action was also the one that threw the work away, silently.
  const [adminDirty, setAdminDirty] = useState(false);
  // The game now has its own theme, driven by tokens, so it can finally follow the app
  // instead of being pinned to light. (It was pinned because every Warlord component
  // used stock light Tailwind classes: in dark mode its un-coloured text went white on white.)
  const { isDarkMode, customThemeIsDark } = useThemeStore();
  const dark = isDarkMode || customThemeIsDark;
  const realUid = auth.currentUser?.uid;
  const saveKey = `warlord_save_${realUid ?? 'anon'}`;

  // Debounced cloud writer for this user's domain (null for a signed-out visitor).
  const sync = useMemo(() => (realUid ? createDomainSync(realUid) : null), [realUid]);

  // Load the cloud domain into localStorage BEFORE mounting the game (so its synchronous
  // hydrate picks it up). `ready` gates the mount so the async load can't race the game.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!realUid) { setReady(true); return; } // anon plays locally, no cloud (and no config: rules require sign-in)
    // One-time migration of the pre-uid-scoping local save into this user's key.
    const legacy = localStorage.getItem('warlord_save');
    if (legacy && !localStorage.getItem(saveKey)) {
      localStorage.setItem(saveKey, legacy);
      localStorage.removeItem('warlord_save');
    }
    setReady(false);
    // The config must be in hand BEFORE the game mounts: GameConfig is read synchronously
    // by prices and tables during the first render, so a late arrival would show defaults.
    Promise.all([loadWarlordDomain(realUid), loadWarlordConfig()])
      .then(([, cfg]) => { if (alive) setConfig(cfg); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; sync?.flush(); }; // push the last state on unmount
  }, [realUid, saveKey, sync]);

  useEffect(() => {
    let alive = true;
    if (!realUid) { setIsAdmin(false); return; }
    adminCheck().then((ok) => { if (alive) setIsAdmin(ok); }).catch(() => {});
    return () => { alive = false; };
  }, [realUid]);

  function leaveAdmin(next: 'DOMAIN' | 'PVP' | 'ADMIN'): void {
    if (view === 'ADMIN' && next !== 'ADMIN' && adminDirty) {
      if (!confirm('You have unsaved balance changes. Leaving the admin discards them. Leave anyway?')) return;
      setAdminDirty(false);
    }
    setView(next);
  }

  // Leaving the Domain view (e.g. to PvP) flushes any pending cloud write immediately.
  useEffect(() => { if (view !== 'DOMAIN') sync?.flush(); }, [view, sync]);

  // React unmount does NOT run when the tab is closed, the app is swiped away, or the
  // OS backgrounds a webview — so without this, anything saved inside the last debounce
  // window (2.5s) never reached the cloud and the next device loaded an older kingdom.
  useEffect(() => {
    if (!sync) return;
    const onHide = () => { if (document.visibilityState === 'hidden') sync.flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', sync.flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', sync.flush);
    };
  }, [sync]);

  return (
    <div className={`warlord${dark ? ' dark' : ''} min-h-screen bg-wl-surface text-wl-ink`}>
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 border-b border-wl-line bg-wl-panel/90 backdrop-blur">
        <button
          onClick={() => {
            if (view === 'ADMIN' && adminDirty && !confirm('You have unsaved balance changes. Leaving discards them. Leave anyway?')) return;
            navigate('/');
          }}
          className="px-3 py-1 rounded border border-wl-line bg-wl-panel hover:bg-wl-panel-muted text-sm text-wl-ink"
        >
          ← Back to Our Days
        </button>
        <span className="text-sm text-wl-muted">Warlord</span>
        <div className="ml-auto flex gap-1">
          {([['DOMAIN', '🏰 Domain'], ['PVP', '⚔ PvP'], ...(isAdmin ? [['ADMIN', '⚙ Admin'] as const] : [])] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => leaveAdmin(k)}
              className={`px-3 py-1 rounded text-sm border ${view === k ? 'bg-wl-accent text-wl-accent-ink border-wl-accent' : 'bg-wl-panel text-wl-ink border-wl-line hover:bg-wl-panel-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!ready ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-wl-line border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === 'ADMIN' ? (
        <WarlordAdminPanel onSaved={setConfig} onDirtyChange={setAdminDirty} />
      ) : view === 'DOMAIN' ? (
        // key={saveKey}: an auth change while mounted remounts the game so it re-hydrates
        // from the new user's key. onPersist mirrors every save to the cloud (debounced).
        <WarlordApp key={saveKey} saveKey={saveKey} onPersist={sync?.onPersist} config={config} theme={dark ? 'dark' : 'light'} />
      ) : (
        <div className="p-6 max-w-6xl mx-auto">
          {realUid
            ? <PvpPanel key={realUid} myUid={realUid} />
            : <p className="text-sm text-wl-muted">Sign in to play PvP battles.</p>}
        </div>
      )}
    </div>
  );
}
