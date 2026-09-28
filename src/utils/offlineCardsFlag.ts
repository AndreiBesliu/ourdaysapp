// src/utils/offlineCardsFlag.ts
//
// The kill switch for the offline Cards page (28.09.2026). Built with VITE_OFFLINE_CARDS=0, the app
// stops keeping the card copy and removes any copy already on the device, and scripts/stamp-offline.mjs
// stamps the service worker 'off', which deletes the stored page and declines navigations as before.
// One flag, read in one place, so the two halves cannot disagree.

export function offlineCardsEnabled(
  flag: unknown = (import.meta.env as unknown as Record<string, unknown>).VITE_OFFLINE_CARDS,
): boolean {
  return flag !== '0';
}
