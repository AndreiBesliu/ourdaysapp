// Warlord game configuration — read by every player, written only by admins.
//
// ONE shared world ⇒ ONE configuration document (`warlordConfig/live`). Firestore rules
// enforce the write side (admins/{uid} must exist); this module is the transport.
import { doc, getDoc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { GameConfigOverrides } from '@warlord/logic/config';

const configRef = () => doc(db, 'warlordConfig', 'live');

export interface WarlordConfigDoc {
  overrides: GameConfigOverrides;
  updatedAt?: unknown;
  updatedBy?: string;
}

/**
 * A load either succeeded (with possibly-empty overrides) or it did not.
 *
 * These two used to collapse into `null`, which was the panel's worst bug: a failed read
 * looked exactly like "no overrides configured yet", the editor filled with defaults, and
 * the next Save replaced the whole live document — wiping every tuned value for every
 * player, while showing "Saved ✓".
 */
export type ConfigLoad =
  | { ok: true; overrides: GameConfigOverrides; updatedBy?: string; updatedAt: Timestamp | null }
  | { ok: false; error: string };

export async function loadWarlordConfigFull(): Promise<ConfigLoad> {
  try {
    const snap = await getDoc(configRef());
    if (!snap.exists()) return { ok: true, overrides: {}, updatedAt: null };
    const d = snap.data() as { overrides?: unknown; updatedBy?: string; updatedAt?: Timestamp };
    const o = d?.overrides;
    return {
      ok: true,
      overrides: o && typeof o === 'object' ? (o as GameConfigOverrides) : {},
      updatedBy: d?.updatedBy,
      updatedAt: d?.updatedAt instanceof Timestamp ? d.updatedAt : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The players' read path. Here a failure genuinely IS "play on the built-in defaults" —
 * a config that won't load must never stop someone playing — so it still collapses to
 * null. The editor uses `loadWarlordConfigFull` instead, because for an editor the
 * difference between "empty" and "unknown" is the difference between safe and destructive.
 */
export async function loadWarlordConfig(): Promise<GameConfigOverrides | null> {
  const r = await loadWarlordConfigFull();
  if (!r.ok) {
    console.error('Warlord config load failed (using defaults):', r.error);
    return null;
  }
  return Object.keys(r.overrides).length > 0 ? r.overrides : null;
}

export class ConfigConflictError extends Error {
  constructor() {
    super('Someone else saved this configuration while you were editing it.');
    this.name = 'ConfigConflictError';
  }
}

/**
 * Writes the whole overrides document, but only if nobody else has written since the copy
 * being edited was loaded. Without the precondition, two admins (or two tabs) silently
 * overwrite each other and the loser never finds out.
 */
export async function saveWarlordConfig(
  overrides: GameConfigOverrides,
  uid: string,
  baseUpdatedAt: Timestamp | null,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(configRef());
    const live = snap.exists() ? (snap.data()?.updatedAt as Timestamp | undefined) : undefined;
    const liveMs = live instanceof Timestamp ? live.toMillis() : null;
    const baseMs = baseUpdatedAt instanceof Timestamp ? baseUpdatedAt.toMillis() : null;
    if (liveMs !== baseMs) throw new ConfigConflictError();
    tx.set(configRef(), { overrides, updatedAt: serverTimestamp(), updatedBy: uid });
  });
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
