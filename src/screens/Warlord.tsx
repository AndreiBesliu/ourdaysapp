import { useNavigate } from 'react-router-dom';
import WarlordApp from '../warlord/WarlordApp';

// Embedded single-player Warlord game, mounted as its own full-width route so its
// multi-tab desktop layout isn't squeezed into the arcade modal. State is local
// (localStorage), no Firestore/backend. See src/warlord/ (kept in sync with the
// standalone games/warlord repo).
export default function Warlord() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 border-b bg-white/90 backdrop-blur">
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 rounded border bg-white hover:bg-stone-50 text-sm"
        >
          ← Back to Our Days
        </button>
        <span className="text-sm text-stone-500">Warlord (single-player)</span>
      </div>
      <WarlordApp />
    </div>
  );
}
