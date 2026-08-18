// Cloud sync for the Warlord single-player domain (economy/army). Makes the game a
// real per-user account: the domain lives in Firestore at warlordDomains/{uid}, so it
// follows the user across devices instead of being trapped in one browser's localStorage.
//
// Strategy: localStorage (warlord_save_{uid}) is a write-through CACHE; Firestore is the
// durable copy. Both carry a monotonic REVISION so neither can silently clobber the other:
//   • load  → take whichever side has the higher rev (and push local up if it wins)
//   • save  → bump the local rev BEFORE writing, so a write that fails while offline
//             leaves local ahead and it gets promoted on the next successful load.
// The rev is what makes offline play safe: Firestore's getDoc can resolve from its
// IndexedDB cache when offline, and without a rev an old cached blob would be adopted
// and then written back over newer cloud progress.
import { doc, getDocFromServer, setDoc, serverTimestamp } from 'firebase/firestore';
import { inspectSave } from '@warlord/logic/saveSchema';
import { db } from './firebase';

const domainRef = (uid: string) => doc(db, 'warlordDomains', uid);
const localKey = (uid: string) => `warlord_save_${uid}`;
const revKey = (uid: string) => `warlord_rev_${uid}`;

function readLocalRev(uid: string): number {
  const n = Number(localStorage.getItem(revKey(uid)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readLocalSave(uid: string): unknown | null {
  try {
    const raw = localStorage.getItem(localKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Pull the newer of (cloud, local) into localStorage so the game's synchronous hydrate
// picks it up. Best-effort: on any error we keep whatever is already cached locally.
export async function loadWarlordDomain(uid: string): Promise<void> {
  let cloudSave: unknown | undefined;
  let cloudRev = -1; // -1 = no cloud doc at all
  try {
    // Prefer the SERVER copy: getDoc would happily resolve from the offline cache,
    // and adopting a stale cached blob is how progress gets overwritten.
    const snap = await getDocFromServer(domainRef(uid));
    if (snap.exists()) {
      cloudSave = snap.data()?.save;
      cloudRev = Number(snap.data()?.rev ?? 0);
    }
  } catch (e) {
    // Offline (or blocked): play from the local cache and do NOT touch the cloud —
    // the local rev stays ahead, so this device's progress is promoted once online.
    console.error('Warlord cloud load unavailable (using local cache):', e);
    return;
  }

  const localRev = readLocalRev(uid);
  const localSave = readLocalSave(uid);

  // THE SCHEMA OUTRANKS THE REV, in both directions.
  //
  // `rev` is a per-DEVICE counter, not a global clock: a tab running an old build can sit at
  // a higher rev than the cloud purely by having ticked more days locally. Comparing revs
  // alone therefore lets an older build's blob — already missing every field it never heard
  // of — be promoted over a newer one. The game's own guard stops that tab from WRITING once
  // it has read a newer save, but it cannot help a tab whose local cache is old and whose
  // rev happens to be ahead.
  //
  // So: a lower schema never wins, whatever the rev says. Ties fall through to the rev rule
  // below, which is still right.
  // `-1` for "no save on this side at all", so an absent copy can never out-rank a present
  // one. `inspectSave` reports a MISSING blob as the current schema, which would read as
  // "as new as it gets" and is exactly the wrong answer here.
  const cloudSchema = cloudSave !== undefined ? inspectSave(cloudSave).schema : -1;
  const localSchema = localSave !== null ? inspectSave(localSave).schema : -1;

  if (cloudSave !== undefined && cloudSchema > localSchema) {
    localStorage.setItem(localKey(uid), JSON.stringify(cloudSave));
    // The rev must not go BACKWARDS here or the next write would look stale to this device.
    localStorage.setItem(revKey(uid), String(Math.max(cloudRev, localRev)));
    return;
  }
  if (localSave !== null && localSchema < cloudSchema) return; // never push the older shape up

  // STRICTLY greater: after a successful write both sides sit at the same rev, and
  // localStorage is written synchronously on every state change while the cloud write is
  // debounced. On a tie the local copy is therefore never older — adopting the cloud
  // would silently throw away whatever happened inside the last debounce window.
  if (cloudSave !== undefined && cloudRev > localRev) {
    localStorage.setItem(localKey(uid), JSON.stringify(cloudSave));
    localStorage.setItem(revKey(uid), String(cloudRev));
    return;
  }
  // Local is ahead (offline progress, or a pre-cloud save being migrated) → promote it.
  if (localSave) await saveWarlordDomain(uid, localSave);
}

export async function saveWarlordDomain(uid: string, blob: unknown): Promise<void> {
  // Bump the rev BEFORE the write: if this write fails (offline), local stays ahead of
  // the cloud and wins the next comparison instead of being silently overwritten.
  const rev = readLocalRev(uid) + 1;
  localStorage.setItem(revKey(uid), String(rev));
  try {
    await setDoc(domainRef(uid), { save: blob, rev, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error('Warlord cloud save failed (kept locally, will retry):', e);
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
