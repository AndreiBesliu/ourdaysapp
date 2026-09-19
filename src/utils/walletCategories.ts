// src/utils/walletCategories.ts
//
// A wallet card's categories live in TWO fields, and the screen reads them in a definite order.
//
// ── The defect ───────────────────────────────────────────────────────────────────────
//
// `categories: string[]` is what every read path uses — the filter bar, the grouping, the picker.
// `category: string` is the older single field, kept because cards written before the array still
// carry it. Saving writes both: `categories: selected`, `category: selected[0] || 'Uncategorized'`.
//
// Renaming a category learned this the hard way and now patches both, selecting the cards by
// either field. **Deleting one never did.** It reads:
//
//     const affected = assets.filter((a) => a.category === catName && a.ownerId === uid);
//     await Promise.all(affected.map((a) => updateDoc(ref(a.id), { category: 'Uncategorized' })));
//
// Two faults in three lines. It FINDS cards only by the legacy field, so a card whose array holds
// the name is never touched; and it WRITES only the legacy field, so the array keeps the name on
// the cards it does touch. Either way the name survives on the card while disappearing from the
// list — and the grouping reads `categories[0]`, so the card goes on sitting under a heading you
// can no longer filter by, rename, or delete. There is no way back to it from the screen.
//
// Measured read-only on 19.09: of 18 cards, five carry a name their owner's list does not have
// ("Cards", "Loyalty", "Groceries/Alimente"). That count says the orphans exist; it does not by
// itself say this code made them, since an older version of the screen could have. What is
// certain from reading it is that this code cannot clean one up and will make more.
//
// (Four more carry "Uncategorized", which is the by-design fallback and never in anybody's list.)
//
// ── Why a module rather than three lines in the screen ────────────────────────────────
//
// Because the rule is now written in four places — save, rename, delete, and the grouping — and
// the one that was written separately is the one that went wrong. Pure: no React, no Firestore.

/** What a card gets when nothing else is left. Never in anybody's category list, by design. */
export const UNCATEGORIZED = 'Uncategorized';

export interface CategorisedAsset {
  id?: string;
  ownerId?: unknown;
  categories?: unknown;
  category?: unknown;
}

const name = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Every category name one card carries, newest field first, deduplicated.
 *
 * The array wins where both exist, which is the order every read path on the screen already uses.
 */
export function categoriesOf(asset: CategorisedAsset | null | undefined): string[] {
  if (!asset) return [];
  const out: string[] = [];
  const arr = Array.isArray(asset.categories) ? asset.categories : [];
  for (const c of arr) if (name(c) && !out.includes(c)) out.push(c);
  if (name(asset.category) && !out.includes(asset.category)) out.push(asset.category);
  return out;
}

/** The cards this person owns that carry `catName` in EITHER field. */
export function affectedByRemoval<T extends CategorisedAsset>(
  assets: readonly T[],
  catName: unknown,
  uid: string,
): T[] {
  if (!name(catName)) return [];
  return assets.filter((a) => a && a.ownerId === uid && categoriesOf(a).includes(catName));
}

/**
 * What one card's two fields become when `catName` goes.
 *
 * The legacy field follows the head of the array, exactly as the save path writes it, so a card
 * that has just been cleaned and a card that has just been saved look the same.
 */
export function afterRemoval(
  asset: CategorisedAsset,
  catName: string,
): { categories: string[]; category: string } {
  const next = categoriesOf(asset).filter((c) => c !== catName);
  return { categories: next, category: next[0] || UNCATEGORIZED };
}

/**
 * Names sitting on this person's own cards that their category list no longer contains.
 *
 * These are the ones with no way back: the screen groups by them but offers no control for them.
 * Listing them is what makes them removable — a repair the owner performs, not one I perform on
 * their data.
 *
 * `UNCATEGORIZED` is excluded: it is where cards GO, not a category anybody manages.
 */
export function orphanCategories(
  assets: readonly CategorisedAsset[],
  listed: readonly string[],
  uid: string,
): string[] {
  const known = new Set(listed.filter(name));
  const out: string[] = [];
  for (const a of assets) {
    if (!a || a.ownerId !== uid) continue;
    for (const c of categoriesOf(a)) {
      if (c === UNCATEGORIZED || known.has(c) || out.includes(c)) continue;
      out.push(c);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * What one card's two fields become when `oldName` is renamed to `newName`.
 *
 * Deduplicated, because a rename can also be a MERGE: fold the orphan "Loyalty" into the
 * existing "Financial" and a card carrying both would otherwise end up with it twice.
 */
export function afterRename(
  asset: CategorisedAsset,
  oldName: string,
  newName: string,
): { categories: string[]; category: string } {
  const out: string[] = [];
  for (const c of categoriesOf(asset)) {
    const next = c === oldName ? newName : c;
    if (!out.includes(next)) out.push(next);
  }
  return { categories: out, category: out[0] || UNCATEGORIZED };
}

/**
 * The stored category list after that rename.
 *
 * The point of the last line: renaming an ORPHAN has to ADOPT it. An orphan is by definition
 * absent from the list, so `map` leaves the list untouched, the write stores the same entries,
 * and the cards land under a brand-new orphan — the pencil button was inert by construction.
 * Found by an adversarial review on 19.09, hours after the orphans were first made visible.
 */
export function listAfterRename(
  listed: readonly string[],
  oldName: string,
  newName: string,
): string[] {
  const out: string[] = [];
  for (const c of listed) {
    const next = c === oldName ? newName : c;
    if (name(next) && !out.includes(next)) out.push(next);
  }
  if (name(newName) && !out.includes(newName)) out.push(newName);
  return out;
}
