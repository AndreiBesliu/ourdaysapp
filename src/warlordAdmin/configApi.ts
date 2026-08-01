// Warlord game configuration — read by every player, written only by admins.
//
// ONE shared world ⇒ ONE configuration document (`warlordConfig/live`). Firestore rules
// enforce the write side (admins/{uid} must exist); this module is only the transport.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { GameConfigOverrides } from '../warlord/logic/config';

const configRef = () => doc(db, 'warlordConfig', 'live');

export interface WarlordConfigDoc {
  overrides: GameConfigOverrides;
  updatedAt?: unknown;
  updatedBy?: string;
}

// Best-effort: a config that fails to load must never block play — the game falls back
// to its built-in defaults, which is exactly today's behaviour.
export async function loadWarlordConfig(): Promise<GameConfigOverrides | null> {
  try {
    const snap = await getDoc(configRef());
    if (!snap.exists()) return null;
    const o = snap.data()?.overrides;
    return o && typeof o === 'object' ? (o as GameConfigOverrides) : null;
  } catch (e) {
    console.error('Warlord config load failed (using defaults):', e);
    return null;
  }
}

export async function saveWarlordConfig(overrides: GameConfigOverrides, uid: string): Promise<void> {
  await setDoc(configRef(), { overrides, updatedAt: serverTimestamp(), updatedBy: uid });
}

export async function loadWarlordConfigMeta(): Promise<{ updatedBy?: string; updatedAt?: Date | null }> {
  try {
    const snap = await getDoc(configRef());
    if (!snap.exists()) return {};
    const d = snap.data() as { updatedBy?: string; updatedAt?: { toDate?: () => Date } };
    return { updatedBy: d.updatedBy, updatedAt: d.updatedAt?.toDate?.() ?? null };
  } catch {
    return {};
  }
}

// Strip empty branches so the stored doc only ever contains what an admin actually
// changed — that keeps "reset to defaults" honest and the diff view readable.
export function pruneOverrides(o: GameConfigOverrides): GameConfigOverrides {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'object') {
      const inner: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 == null) continue;
        if (typeof v2 === 'object' && Object.keys(v2 as object).length === 0) continue;
        inner[k2] = v2;
      }
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out as GameConfigOverrides;
}
