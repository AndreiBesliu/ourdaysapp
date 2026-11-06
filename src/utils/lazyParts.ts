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

/**
 * A loader that keeps what it brought (06.11.2026), for a part that must be drawn in the render that mounts it once it
 * is here, rather than a render later. Calls while it loads share the one load; a failed load is forgotten, so the
 * next call asks again. Asks the BROWSER again: Firefox (155+) fetches again, Chromium keeps a failed module fetch for
 * the life of the page and answers at once with the same failure (the review of 06.11.2026 measured it), so there the
 * part comes back only with a reload.
 */
export function keptOnArrival<T>(importer: () => Promise<{ default: T }>) {
  let kept: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    // A load that succeeded stays the answer: its promise is kept, and resolves at once from then on.
    load(): Promise<T> {
      pending ??= importer().then(
        (m) => (kept = m.default),
        (error: unknown) => { pending = null; throw error; },
      );
      return pending;
    },
    /** What has arrived, else null. */
    loaded: (): T | null => kept,
  };
}

/** The calendar's floating chat (components/GroupChatWidgetOnDemand.tsx). */
const chatWidget = keptOnArrival(() => import('../components/GroupChatWidget'));
export const loadGroupChatWidget = chatWidget.load;
export const loadedGroupChatWidget = chatWidget.loaded;

/** Every loader above: what the app fetches while idle. */
export const LAZY_PARTS = [loadAssetBarcode, loadInviteFamilyModal, loadAddEventModal, loadEventDetailsModal, loadGamesHubModal, loadGroupChatWidget];
