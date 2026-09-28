// src/utils/languagePref.ts
//
// The language remembered on this device, readable before (and without) the app's store. Moved out
// of store.ts on 28.09.2026 so the offline Cards page (src/offline/) can speak the person's language
// without pulling in the store and everything it imports. Same key, same behaviour.
//
// The chosen language lives in the user's Firestore document, which is only read AFTER sign-in.
// That left two windows in permanent English for everyone else: the whole login screen, and the
// moment between boot and the profile arriving on every reload. It is a UI preference and nothing
// else: no identifier, no personal data. Firestore stays the source of truth.

export const LANG_KEY = 'ourdays.language';

export function rememberedLanguage(): string {
  try {
    return localStorage.getItem(LANG_KEY) || 'en-US';
  } catch {
    // Private mode, disabled storage, an embedded webview: none of them are worth a crash at boot.
    return 'en-US';
  }
}
