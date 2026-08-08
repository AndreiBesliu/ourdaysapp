// Dev-only entry that renders the Warlord admin panel on its own.
//
// The panel sits behind auth (`/warlord` → admin check), which made it a rendering blind
// spot: typecheck, tests and build can all be green while the panel is visually broken or
// crashed on an ErrorBoundary. This mounts the real component with no auth, inside the
// same `.warlord` theme root the app gives it, with a light/dark switch — so it can be
// LOOKED AT. Firestore reads fail for a signed-out visitor and the panel falls back to
// defaults, which is exactly the state we need for judging layout and interaction.
//
// Not part of the production build: warlord-admin.html is not in rollupOptions.input.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '@warlord/styles/tokens.css'
import WarlordAdminPanel from './WarlordAdminPanel'
import type { ConfigLoad } from './configApi'

// `?demo=1` feeds the panel a successful load so the editor itself can be exercised
// without a signed-in admin. Without it the harness shows the (correct) refusal screen,
// because a signed-out read is denied.
const demoLoad = async (): Promise<ConfigLoad> => ({
  ok: true,
  overrides: { buildingCost: { BLACKSMITH: 1234567 } },
  updatedBy: 'demo',
  updatedAt: null,
})

function Harness() {
  const [dark, setDark] = useState(true)
  return (
    <div className={`warlord${dark ? ' dark' : ''} min-h-screen bg-wl-surface text-wl-ink`}>
      <div className="flex items-center gap-3 px-4 py-2 border-b border-wl-line bg-wl-panel">
        <span className="text-sm text-wl-muted">Warlord admin — dev harness (no auth, no writes)</span>
        <button
          className="ml-auto px-3 py-1.5 rounded border border-wl-line bg-wl-panel text-wl-ink hover:bg-wl-panel-muted"
          onClick={() => setDark((d) => !d)}
        >
          {dark ? '☀ light' : '☾ dark'}
        </button>
      </div>
      <WarlordAdminPanel loader={new URLSearchParams(location.search).has('demo') ? demoLoad : undefined} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
