// src/utils/bootstrapWrites.ts
//
// What the app writes about the signed-in account at every start (App.tsx), decided here (04.10.2026).
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// Each start reads `users/{uid}` and then writes: `email` and `lastLogin`, the name and time zone when
// the account has none, the public mirror `profiles/{uid}` (name, photo, birthday), and an empty
// `familyMembers` when the field is missing. Every one of those "when it has none" questions was asked
// of the read — and when the read FAILED (no connection and nothing cached, or a refused request) the
// answer was `null`, which read as "a brand-new account with nothing". Reproduced on the real App.tsx
// against the emulators (DEVLOG 04.10): once the network came back the queued writes replaced the name
// with the old Auth display name, the chosen zone with the device's, `familyMembers` with [], and the
// public photo and birthday with null.
//
// A read served from the CACHE has the same flaw, less often: a cache last filled before a change made
// on another device (a new photo, a zone picked in Settings) would write that older state back over it.
//
// ── The rule ─────────────────────────────────────────────────────────────────────────
//
// Only the SERVER's answer may decide what the account lacks — and "not from the cache" is not yet the
// server's word while this device has its own unconfirmed write on the document (`serverConfirmed`,
// the lesson of the birthday flash, 28.09). Without that answer, the start writes what it knows for
// itself — `email` (from Auth) and `lastLogin` — and POSTPONES the rest to the first answer the server
// confirms in the same session (`laterWrites`; App.tsx listens for it). Postponed, not dropped: a
// brand-new account whose first read missed the server still gets its zone, name and mirror within
// seconds (review 04.10). A missing document is the server's word too: that is a new account.
//
// Pure: no Firebase, no clock, no device. App.tsx gives it the read, the Auth user, the time and the
// device's zone (already validated with the server's own predicate, eventTime.isValidZone).

import { publicMirrorFor, type MirrorFields } from './publicProfile';
import { serverConfirmed } from './ownUserDoc';

/** How the boot read of `users/{uid}` ended. */
export type ProfileRead =
  | { kind: 'failed' }
  | { kind: 'cached'; exists: boolean; data: Record<string, unknown> }
  | { kind: 'server'; exists: boolean; data: Record<string, unknown> };

/** The parts of a Firestore DocumentSnapshot this needs (so it stays testable without Firebase). */
export interface SnapshotLike {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}

export function profileReadOf(snap: SnapshotLike | null): ProfileRead {
  if (!snap) return { kind: 'failed' };
  const exists = snap.exists();
  const data = (exists ? snap.data() : undefined) ?? {};
  return serverConfirmed(snap.metadata) ? { kind: 'server', exists, data } : { kind: 'cached', exists, data };
}

export interface UserUpdate {
  email: string | null;
  lastLogin: string;
  name?: string;
  timezone?: string;
}

export interface BootstrapPlan {
  /** Merged into `users/{uid}`. */
  userUpdate: UserUpdate;
  /** Merged into `profiles/{uid}`, or null: not written at all. */
  mirror: MirrorFields | null;
  /** Whether `familyMembers: []` is set (the field is missing on the server's document). */
  initFamilyMembers: boolean;
}

export function bootstrapPlan(
  read: ProfileRead,
  user: { email: string | null; displayName: string | null },
  nowIso: string,
  /** The device's zone, already validated; null when it is not one the server accepts. */
  deviceZone: string | null,
): BootstrapPlan {
  const userUpdate: UserUpdate = { email: user.email, lastLogin: nowIso };
  if (read.kind !== 'server') return { userUpdate, mirror: null, initFamilyMembers: false };

  const data = read.data;
  // Backfill the name from Auth when the account has none, so member lists and birthday titles show
  // the real name instead of the e-mail prefix.
  if (!data.name && user.displayName) userUpdate.name = user.displayName;
  // Backfill the zone ONCE, when the account has none: without it `sendDueReminders` falls back to
  // UTC (three hours late in Bucharest). Only when absent — a zone chosen in Settings is a statement
  // about where the person is, and overwriting it on every start would make that picker decorative.
  if (!data.timezone && deviceZone) userUpdate.timezone = deviceZone;

  return {
    userUpdate,
    // The public mirror, from the server's document plus what this start adds. It never INVENTS a
    // name (publicMirrorFor): an omitted key leaves whatever is there.
    mirror: publicMirrorFor({ ...data, ...userUpdate }, user.displayName),
    initFamilyMembers: !read.exists || !data.familyMembers,
  };
}

/** What a postponed plan still has to write: everything but `email` and `lastLogin`, already written. */
export interface LaterWrites {
  userFields: { name?: string; timezone?: string };
  mirror: MirrorFields | null;
  initFamilyMembers: boolean;
}

/** The part of a plan, made from a later SERVER answer, that the start could not write itself. */
export function laterWrites(plan: BootstrapPlan): LaterWrites {
  const userFields: LaterWrites['userFields'] = {};
  if (plan.userUpdate.name !== undefined) userFields.name = plan.userUpdate.name;
  if (plan.userUpdate.timezone !== undefined) userFields.timezone = plan.userUpdate.timezone;
  return { userFields, mirror: plan.mirror, initFamilyMembers: plan.initFamilyMembers };
}
