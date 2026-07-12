import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import WarlordApp from '../warlord/WarlordApp';

// Embedded single-player Warlord game, mounted as its own full-width route so its
// multi-tab desktop layout isn't squeezed into the arcade modal. State is local
// (localStorage), no Firestore/backend. See src/warlord/ (kept in sync with the
// standalone games/warlord repo).
export default function Warlord() {
  const navigate = useNavigate();

  // Per-user save so family members sharing one device don't share a domain.
  const realUid = auth.currentUser?.uid;
  const saveKey = `warlord_save_${realUid ?? 'anon'}`;

  // One-time migration: adopt the pre-uid-scoping save if this user has none yet.
  // ONLY for a real authenticated uid — an anon render must never consume the shared
  // legacy save (it would strand the family's progress under an unreachable key).
  const legacy = localStorage.getItem('warlord_save');
  if (realUid && legacy && !localStorage.getItem(saveKey)) {
    localStorage.setItem(saveKey, legacy);
    localStorage.removeItem('warlord_save');
  }

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
      {/* key={saveKey}: if the uid (and thus the storage key) ever changes while mounted
          (sign-out/sign-in in another tab), remount the whole game so every useState
          initializer re-hydrates from the NEW key — otherwise the persist effect would
          overwrite the new user's save with the previous user's in-memory state. */}
      <WarlordApp key={saveKey} saveKey={saveKey} />
    </div>
  );
}
