import { useNavigate } from 'react-router-dom';
import WarlordApp from '../warlord/WarlordApp';

// Embedded single-player Warlord game, mounted as its own full-width route so its
// multi-tab desktop layout isn't squeezed into the arcade modal. State is local
// (localStorage), no Firestore/backend. See src/warlord/ (kept in sync with the
// standalone games/warlord repo).
export default function Warlord() {
  const navigate = useNavigate();
  // Warlord is designed for a light theme (white cards, dark text) with stock Tailwind
  // classes and no `dark:` variants. OurDaysApp may run in dark mode (`.dark` on <html>),
  // which sets the inherited default text color to near-white via `--foreground`. Force a
  // light context here so Warlord's un-colored text stays dark and native inputs render light.
  return (
    <div className="min-h-screen bg-white text-zinc-900 [color-scheme:light]">
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 border-b bg-white/90 backdrop-blur">
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded border bg-white hover:bg-stone-50 text-sm text-zinc-800"
        >
          ← Back to Our Days
        </button>
        <span className="text-sm text-stone-500">Warlord (single-player)</span>
      </div>
      <WarlordApp />
    </div>
  );
}
