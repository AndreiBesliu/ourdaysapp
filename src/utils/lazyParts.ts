// src/utils/lazyParts.ts
//
// Loaders for the parts of screens that load on demand (29.10.2026, BACKLOG "Bundle-ul"): the
// calendar's windows — adding an event, an event's details, the arcade, the invitation — and the card
// codes, with the libraries only they use (the code drawers, drag-and-drop, the date parser), all of
// which sat in the chunk every person loads at boot. Named here, apart from the components, for two
// reasons:
//   * the app fetches the same chunks while it is idle (App.tsx, `warmRoutes`), so a window opened
//     later — offline, or after a deploy replaced the chunk — is already in memory;
//   * what boot imports from here is these functions only. A VALUE re-exported from the components
//     would pull them back into what loads at boot (`scripts/check-split.mjs` refuses that build).

export const loadAssetBarcode = () => import('../components/AssetBarcode');
export const loadInviteFamilyModal = () => import('../components/InviteFamilyModal');
export const loadAddEventModal = () => import('../components/AddEventModal');
export const loadEventDetailsModal = () => import('../components/EventDetailsModal');
export const loadGamesHubModal = () => import('../components/games/GamesHubModal');

/** Every loader above: what the app fetches while idle. */
export const LAZY_PARTS = [loadAssetBarcode, loadInviteFamilyModal, loadAddEventModal, loadEventDetailsModal, loadGamesHubModal];
