// functions/src/aiScope.ts
// What one caller is allowed to see, derived fresh, every time.
//
// ── Why this is a TYPE and not a convention ────────────────────────────────────────────
//
// `Scope` is branded and `deriveScope` is its only constructor. Nothing else in the codebase
// can produce one, so "a fetcher was handed a stale or forged scope" is a compile error rather
// than a review comment somebody has to notice. `functions/tsconfig.json` has `strict: true`
// and the build is a real `tsc`, so the check actually runs.
//
// ── Why it is re-derived on EVERY turn, never cached ───────────────────────────────────
//
// Group membership is the only cross-user grant in the whole app, and it can be revoked with
// no signal at all: `handleRemoveMember` is a bare `arrayRemove`, there is no trigger, no
// notification, and nothing writes a `joinedAt`. There is therefore nothing a cache could
// listen to for invalidation. Re-deriving costs one query and removes the entire class.
//
// ── Why `groups/{id}.get()` is forbidden outside this file ─────────────────────────────
//
// Reading a group document the caller is not a member of is a read they could not perform
// themselves (firestore.rules restricts `groups` read to members). So the ONLY group read in
// the assistant is the membership query below. An event whose `groupId` is not in the derived
// scope gets a fixed translated label — never a name fetched behind the caller's back.

import * as admin from "firebase-admin";

/** Most groups one turn will look across. Anyone can create groups without limit, so this is
 *  an axis the user sets for free and it has to be bounded. */
export const SCOPE_FANOUT_CAP = 25;

declare const scopeBrand: unique symbol;

export interface Scope {
  readonly [scopeBrand]: true;
  /** Groups the caller is a member of RIGHT NOW, capped at the fan-out limit. */
  readonly groupIds: readonly string[];
  readonly groupNames: Readonly<Record<string, string>>;
  /** Everyone the caller shares a group with, for resolving display names. */
  readonly memberUids: readonly string[];
  /** How many groups they are actually in, so a truncated answer can say so. */
  readonly totalGroups: number;
  readonly truncated: boolean;
  readonly uid: string;
}

/**
 * THE root derivation. One query, and it is the only place a group document is read.
 *
 * A group id is validated as a non-empty string before it is ever used in a path:
 * `groups/${null}` is a VALID Firestore path that resolves to a missing document, so an
 * unguarded id turns an authorisation question into a silent "no data".
 */
export async function deriveScope(uid: string): Promise<Scope> {
  const db = admin.firestore();
  const snap = await db
    .collection("groups")
    .where("members", "array-contains", uid)
    .limit(200)
    .get();

  const all = snap.docs.filter((d) => typeof d.id === "string" && d.id.length > 0);
  const kept = all.slice(0, SCOPE_FANOUT_CAP);

  const groupIds: string[] = [];
  const groupNames: Record<string, string> = {};
  const members = new Set<string>([uid]);

  for (const doc of kept) {
    groupIds.push(doc.id);
    const data = doc.data() || {};
    groupNames[doc.id] = typeof data.name === "string" && data.name ? data.name : "Group";
    for (const m of Array.isArray(data.members) ? data.members : []) {
      if (typeof m === "string" && m) members.add(m);
    }
  }

  return {
    groupIds,
    groupNames,
    memberUids: [...members],
    totalGroups: all.length,
    truncated: all.length > kept.length,
    uid,
  } as unknown as Scope;
}

/** Does this scope currently include that group? The only question callers may ask of it. */
export function inScope(scope: Scope, groupId: unknown): boolean {
  return typeof groupId === "string" && !!groupId && scope.groupIds.includes(groupId);
}

/**
 * Split a list into chunks. Firestore's `in` / `array-contains-any` take at most 10 values, and
 * the existing digest's per-document loop does up to 50 round trips for the same job.
 */
export function chunk<T>(items: readonly T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Display names, from `profiles/{uid}` and never from `users/{uid}`.
 *
 * The existing digest reads `users/` — data the caller could not read themselves
 * (firestore.rules keeps `users` owner-only, while `profiles` is the public face). Using the
 * wrong collection is how an assistant ends up more privileged than the person asking it.
 */
export async function fetchNames(scope: Scope): Promise<Record<string, string>> {
  const db = admin.firestore();
  const out: Record<string, string> = {};
  const groups = chunk(scope.memberUids, 10);
  const snaps = await Promise.all(
    groups.map((ids) =>
      db.collection("profiles").where(admin.firestore.FieldPath.documentId(), "in", ids).get()
    )
  );
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const name = typeof d.name === "string" && d.name ? d.name : "";
      if (name) out[doc.id] = name;
    }
  }
  return out;
}
