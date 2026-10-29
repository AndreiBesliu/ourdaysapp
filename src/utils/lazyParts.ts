// src/utils/lazyParts.ts
//
// Loaders for the parts of screens that load on demand (29.10.2026, BACKLOG "Bundle-ul"): the
// barcode and QR libraries, which only a card's code and a group invitation's QR use, stayed in the
// chunk every person loads at boot. Named here, apart from the components, for two reasons:
//   * the app fetches the same chunks while it is idle (App.tsx, `warmRoutes`), so a code opened
//     later at the till — offline, or after a deploy replaced the chunk — is already in memory;
//   * what boot imports from here is these functions only. A VALUE re-exported from the components
//     would pull them back into what loads at boot (`scripts/check-split.mjs` refuses that build).

export const loadAssetBarcode = () => import('../components/AssetBarcode');
export const loadInviteFamilyModal = () => import('../components/InviteFamilyModal');
