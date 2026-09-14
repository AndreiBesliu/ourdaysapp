// src/utils/assetSharing.ts
// Who may see a wallet asset, and what the card should say about it.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// The wallet has had a "Shared / Private" toggle since the beginning. It wrote
// `sharedWithFamily: true`, painted a green family icon, and the word **Shared** on the card.
// Nobody could ever read that asset: the Firestore rule is `ownerId == request.auth.uid` and
// always has been, and no listener anywhere queried for anything else. The control was not
// broken in an edge case — it was never connected to anything, in every case.
//
// ── The share target is a GROUP, not a boolean ────────────────────────────────────────
//
// "Shared with family" cannot be answered by a boolean the moment a person belongs to two
// families. `AddEventModal` already knew this and threw it away: it wrote
// `sharedWithFamily: selectedGroupId !== 'personal'` — it had the group id in its hand and
// stored a bit instead.
//
// So an asset now carries `sharedGroupId`. Absent or null means private.
//
// ── Why a group id and not a list of user ids ─────────────────────────────────────────
//
// The obvious alternative is `allowedUserIds: string[]` with `uid in resource.data.allowedUserIds`,
// which needs one `array-contains` listener instead of one per group. It was rejected because
// that list goes STALE: leave a group and you keep reading its loyalty cards until something
// rewrites every asset that named you. That something is a Cloud Function on group membership,
// a fan-out write, and a window in which the revocation has not happened yet.
//
// A group id is resolved AT READ by `isMemberOfGroup` in the rule. Leaving a group revokes
// access in the same instant, with nothing to maintain and nothing to forget — the same reason
// group membership is resolved at read everywhere else in this codebase.
//
// The price is one listener per group instead of one. That price is small (a family app's
// groups are counted on one hand) and it is paid in a place that cannot silently be wrong.
//
// Pure: no React, no Firestore, no DOM.

/** The share state of one asset, as the card needs to render it. */
export type ShareKind =
  /** Owned by me, shared with nobody. */
  | 'private'
  /** Owned by me, readable by one group's members. */
  | 'shared'
  /** Owned by somebody else, visible to me because we are both in the group. */
  | 'fromOthers'
  /**
   * Owned by me, carrying the OLD `sharedWithFamily: true` and no group.
   *
   * It is private — it always was — but the card used to claim otherwise, so saying only
   * "Private" would look like this change took something away. It says the truth instead.
   */
  | 'neverShared';

export interface AssetLike {
  id?: string;
  ownerId?: string | null;
  sharedGroupId?: string | null;
  /** Legacy. Derived from `sharedGroupId` on every write from now on. */
  sharedWithFamily?: boolean;
}

export interface GroupLike {
  id: string;
  name?: string;
}

/** `sharedGroupId`, but only when it is a usable group id. Everything else is private. */
export function shareTargetOf(asset: AssetLike | null | undefined): string | null {
  const raw = asset?.sharedGroupId;
  return typeof raw === 'string' && raw.trim() !== '' && raw !== 'personal' ? raw : null;
}

export function isOwnedBy(asset: AssetLike | null | undefined, uid: string | null | undefined): boolean {
  return !!uid && !!asset && asset.ownerId === uid;
}

/** Only the owner may edit, delete, transfer or re-share. The rules say the same thing. */
export function canEdit(asset: AssetLike | null | undefined, uid: string | null | undefined): boolean {
  return isOwnedBy(asset, uid);
}

export function shareKindOf(asset: AssetLike | null | undefined, uid: string | null | undefined): ShareKind {
  if (!isOwnedBy(asset, uid)) return 'fromOthers';
  if (shareTargetOf(asset)) return 'shared';
  return asset?.sharedWithFamily === true ? 'neverShared' : 'private';
}

export function groupNameOf(groups: GroupLike[], groupId: string | null): string | null {
  if (!groupId) return null;
  const g = groups.find((x) => x.id === groupId);
  return (g?.name && g.name.trim()) || null;
}

/**
 * What a write must put on the document.
 *
 * `sharedWithFamily` is kept, and kept DERIVED. Dropping it would leave old documents claiming
 * a sharing that no longer exists in any reader, and writing it independently would let the two
 * fields disagree — which is how this feature got here in the first place.
 */
export function shareFieldsFor(groupId: string | null | undefined): {
  sharedGroupId: string | null;
  sharedWithFamily: boolean;
} {
  const target = shareTargetOf({ sharedGroupId: groupId ?? null });
  return { sharedGroupId: target, sharedWithFamily: target !== null };
}

/**
 * One list out of the owned listener and the per-group listeners.
 *
 * Deduped by id and OWNED-FIRST, deliberately: an asset I own and shared arrives from both
 * listeners, and the copy that wins must be the one the edit controls belong to. Sorting is the
 * caller's business; the order here is only "mine, then everyone else's", which keeps the
 * wallet's own contents from being pushed below other people's.
 */
export function mergeAssets<T extends AssetLike>(owned: T[], shared: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const group of [owned, ...shared]) {
    for (const a of group) {
      const id = a?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(a);
    }
  }
  return out;
}

/**
 * The groups whose shared assets we may listen for.
 *
 * Empty in, empty out — and that matters: `where('sharedGroupId','in',[])` throws, and a caller
 * that mapped over an empty list would instead open zero listeners, which is correct.
 */
export function shareListenerGroupIds(groups: GroupLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g?.id || g.id === 'personal' || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g.id);
  }
  return out;
}
