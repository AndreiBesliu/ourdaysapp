// Cloud sync for the Warlord single-player domain (economy/army). Makes the game a
// real per-user account: the domain lives in Firestore at warlordDomains/{uid}, so it
// follows the user across devices instead of being trapped in one browser's localStorage.
//
// Strategy: localStorage (warlord_save_{uid}) is a write-through CACHE and offline
// fallback; Firestore is the durable source of truth. On load we pull the cloud doc
// into localStorage so the game's synchronous hydrate picks it up unchanged; on every
// save the game writes localStorage AND we debounce-write the cloud. This keeps the
// synced game code (useGameState) storage-agnostic — it just calls onPersist(blob).
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const domainRef = (uid: string) => doc(db, 'warlordDomains', uid);
const localKey = (uid: string) => `warlord_save_${uid}`;

// Pull the cloud domain into localStorage (so the game hydrates from it). If the cloud
// is empty but a local save exists (a pre-cloud player, or the legacy migration), push
// that up so nothing is lost. Best-effort: on any error we fall back to the local cache.
export async function loadWarlordDomain(uid: string): Promise<void> {
  try {
    const snap = await getDoc(domainRef(uid));
    const cloud = snap.exists() ? snap.data()?.save : undefined;
    if (cloud) {
      localStorage.setItem(localKey(uid), JSON.stringify(cloud));
      return;
    }
  } catch (e) {
    console.error('Warlord cloud load failed (using local cache):', e);
    return; // keep whatever is in localStorage
  }
  // Cloud empty → migrate an existing local save up (first-ever cloud write).
  const local = localStorage.getItem(localKey(uid));
  if (local) {
    try {
      await setDoc(domainRef(uid), { save: JSON.parse(local), updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error('Warlord cloud migrate failed:', e);
    }
  }
}

export async function saveWarlordDomain(uid: string, blob: unknown): Promise<void> {
  try {
    await setDoc(domainRef(uid), { save: blob, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error('Warlord cloud save failed:', e);
  }
}

export interface DomainSync {
  onPersist: (blob: unknown) => void; // debounced cloud writer (wire to useGameState)
  flush: () => void; // force any pending write now (call on unmount / view switch)
}

// Debounced per-user cloud saver. The game saves frequently (every state change +
// the 5-min tick); debouncing collapses bursts into one write. localStorage is written
// synchronously by the game regardless, so a dropped/delayed cloud write never loses
// data locally — flush() on unmount pushes the last state up.
export function createDomainSync(uid: string, ms = 2500): DomainSync {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown = null;
  let hasPending = false;
  const commit = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!hasPending) return;
    const blob = pending;
    hasPending = false;
    pending = null;
    void saveWarlordDomain(uid, blob);
  };
  return {
    onPersist: (blob) => {
      pending = blob;
      hasPending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, ms);
    },
    flush: commit,
  };
}
