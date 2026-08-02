// Dev-only entry: the game on its own, with no auth, no Firebase and no cloud sync.
// It exists so the game can be iterated on (and verified in a browser) without booting
// the whole app and signing in — the reason a separate standalone repo used to exist.
// It mounts the SAME `WarlordApp` the /warlord route mounts, so there is exactly one
// copy of the game code. Not part of the production build (see vite.config.ts).
import { createRoot } from 'react-dom/client'
import '../index.css'
import WarlordApp from './WarlordApp'

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-white text-zinc-900 [color-scheme:light]">
    <div className="px-4 py-2 border-b bg-amber-50 text-xs text-amber-900">
      Warlord — standalone dev harness (localStorage save <code>warlord_dev</code>, no cloud, no auth)
    </div>
    <WarlordApp saveKey="warlord_dev" />
  </div>,
)
