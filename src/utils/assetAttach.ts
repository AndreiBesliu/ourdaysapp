// src/utils/assetAttach.ts
//
// Attaching a wallet card to a group event, and whether that shares it.
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// Reported by the live error log on 18.09, two occurrences, one person:
//
//   Missing or insufficient permissions.  ·  EventDetailsModal.checklistAssets
//
// An asset is readable by its owner, or by the members of the ONE group named in its
// `sharedGroupId` (firestore.rules). A checklist item can carry an `assetId`. Nothing made the two
// agree, so putting your loyalty card next to "buy milk" on a shared shopping list left everybody
// else in the group unable to read it — and the `catch` around that read swallowed the refusal, so
// the row simply appeared without its barcode.
//
// What is lost is precisely the useful half: the item's PICTURE is stored on the event and renders
// for everyone, while the CODE lives on the asset. The person at the till sees the photo of the
// card and not the thing you scan.
//
// Measured before the fix: 18 assets, NONE shared with any group; 2 attachments on group events,
// and for both of them a member of that group could not read the asset. Two out of two.
//
// ── The decision was already made, on the other branch ───────────────────────────────
//
// `AddEventModal` has two ways to put an image on an event. UPLOADING one, with "save to wallet"
// ticked, creates the asset with `...shareFieldsFor(selectedGroupId)` — that is, shared with the
// group the event is on. PICKING an existing card from the wallet touches nothing.
//
// So this is not a new policy. It is the same act — put this card on this group's event — doing
// two different things depending on which button you came in through. This module makes the second
// branch agree with the first.
//
// ── What it deliberately will NOT do ─────────────────────────────────────────────────
//
// A card shared with a DIFFERENT group is left alone. `sharedGroupId` names one group, so
// re-pointing it would silently revoke the other group's access to whatever it is attached to
// there — taking something away from people who are not in the room. That case is reported rather
// than performed, and `EventDetailsModal` now shows the code's absence instead of hiding it.

export interface AttachableAsset {
  id?: string;
  ownerId?: unknown;
  sharedGroupId?: unknown;
}

export type AttachDecision =
  /** Point the asset at this group, so the other members can read it. */
  | { share: true; assetId: string; sharedGroupId: string }
  | {
      share: false;
      /**
       * `personal-event`  — no group, nobody else to share with.
       * `not-mine`        — somebody else's card; the rules refuse the write, and rightly.
       * `already-here`    — already shared with this very group.
       * `other-group`     — shared elsewhere; see the note above.
       * `unknown-asset`   — the id names nothing the form can see.
       */
      reason: 'personal-event' | 'not-mine' | 'already-here' | 'other-group' | 'unknown-asset';
    };

const real = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** What attaching `assetId` to an event on `groupId` should do to that asset. */
export function shareOnAttach(
  assets: readonly AttachableAsset[],
  assetId: unknown,
  groupId: unknown,
  uid: string,
): AttachDecision {
  if (!real(groupId)) return { share: false, reason: 'personal-event' };
  if (!real(assetId)) return { share: false, reason: 'unknown-asset' };

  const asset = assets.find((a) => a && a.id === assetId);
  if (!asset) return { share: false, reason: 'unknown-asset' };
  if (asset.ownerId !== uid) return { share: false, reason: 'not-mine' };

  const current = asset.sharedGroupId;
  if (current === groupId) return { share: false, reason: 'already-here' };
  if (real(current)) return { share: false, reason: 'other-group' };

  return { share: true, assetId, sharedGroupId: groupId };
}

/**
 * Every attachment on one event, decided together.
 *
 * Deduplicated by asset id: the same card can be the event's image and a checklist item's, and
 * sharing it twice is one write too many.
 */
export function sharesForAttachments(
  assets: readonly AttachableAsset[],
  attachedIds: readonly unknown[],
  groupId: unknown,
  uid: string,
): { assetId: string; sharedGroupId: string }[] {
  const seen = new Set<string>();
  const out: { assetId: string; sharedGroupId: string }[] = [];
  for (const id of attachedIds) {
    if (!real(id) || seen.has(id)) continue;
    seen.add(id);
    const d = shareOnAttach(assets, id, groupId, uid);
    if (d.share) out.push({ assetId: d.assetId, sharedGroupId: d.sharedGroupId });
  }
  return out;
}

/**
 * The cards on an ALREADY SAVED event that this person could share with the event's group, and
 * has not.
 *
 * Sharing happens when somebody presses Save in `AddEventModal`. That covers every attachment
 * made from 18.09 onwards and nothing before it: measured on live the same day, all 18 assets
 * were private and both of the two attachments sitting on a group event were unreadable by a
 * member of that group. Those two events will not re-save themselves.
 *
 * The person who can repair it is also the only one who cannot see that anything is wrong: the
 * owner reads their own card, so the barcode renders for them exactly as it should, and it is
 * the OTHER members who get the refusal and the apology. So the notice belongs on the screen of
 * the one who sees nothing, and it has to be a gesture — opening a modal is not consent to
 * widen a read.
 *
 * The set of ids is the same one the save path uses, completed checklist items included: a
 * completed item hides its barcode but keeps its card, and ticking a box is not unattaching.
 */
export function unsharedAttachedCards(
  event: { groupId?: unknown; assetId?: unknown; checklistItems?: unknown } | null | undefined,
  loaded: readonly AttachableAsset[],
  uid: string,
): { assetId: string; sharedGroupId: string }[] {
  if (!event) return [];
  const items = Array.isArray(event.checklistItems) ? event.checklistItems : [];
  const ids = [event.assetId, ...items.map((i: { assetId?: unknown } | null) => i && i.assetId)];
  return sharesForAttachments(loaded, ids, event.groupId, uid);
}
