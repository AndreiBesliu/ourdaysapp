// src/utils/walletAsset.ts
//
// A wallet card as the screens may use it (08.10.2026). A card shared with a group is shown to every
// member: in their Wallet on load, in the card picker of a new event, and on any event that links it.
// Until that day the rules typed none of its fields, so a member could share a card whose `name` was a
// map and put the whole app on the recovery screen for the whole group, with no way back inside the app.
// The rules now take only text, lists and booleans where the app writes them (`assetFieldsOk`), and
// every listener and read passes the card through here, so a card stored before that reaches the
// screens as text.
//
// The fields keep exactly what `fieldsOf` (walletLedger.ts) reads of them, so the ledger's verdict on a
// card is the same before and after: a string stays the same string, and only what is not of the
// app's kind becomes '' or null. The photo link stays as stored when it is text (an edit re-sends it,
// and turning it into null would delete the photo); the screens show it only through `assetImageSrc`.

import { storageUrlOrNull } from './chatMessage';
import { clampText } from './eventShape';

/** The web form's limits on a card's name and a category name. The FORM's only: the rules judge both by
 *  their kind (`assetFieldsOk`), because the installed APK has none, and it names a card after an event's
 *  title or a checklist line when it saves a photo to the wallet — a refused card there loses the event. */
export const ASSET_NAME_MAX = 1000;
export const ASSET_CATEGORY_MAX = 100;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function normaliseAsset<T extends Record<string, any>>(raw: T): T & { name: string; categories: string[] } {
  return {
    ...raw,
    name: text(raw.name),
    categories: Array.isArray(raw.categories) ? raw.categories.filter((c: unknown): c is string => typeof c === 'string') : [],
    category: text(raw.category),
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : null,
    barcodeValue: nonEmpty(raw.barcodeValue),
    barcodeFormat: nonEmpty(raw.barcodeFormat),
    sharedGroupId: nonEmpty(raw.sharedGroupId),
    ownerId: text(raw.ownerId),
  };
}

/** The photo to show, or null: only a Firebase Storage download link, the only kind the app stores.
 *  Anything else would be fetched by the browser of every member who opens the Wallet. */
export function assetImageSrc(asset: { imageUrl?: unknown } | null | undefined): string | null {
  return storageUrlOrNull(asset?.imageUrl);
}

/** A card's name cut to the form's limit, for the names the app makes up from other text (an event's
 *  title, a checklist item). */
export function assetNameFrom(textValue: unknown, fallback: string): string {
  return clampText(typeof textValue === 'string' && textValue ? textValue : fallback, ASSET_NAME_MAX);
}
