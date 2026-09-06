// src/store.test.ts
// Signing out has to take the account's appearance with it.
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// The theme store is a plain module-scope zustand `create()`. Signing out is `signOut(auth)` plus
// an SPA navigate — no page reload — so the module keeps every value it had. Nothing reset it.
//
// On the next sign-in only the LANGUAGE was restored unconditionally; the background photo,
// background colour, overlay, dark-surfaces toggle, sound and haptics all sat behind
// `if (data.primaryColor || data.isDarkMode !== undefined)`, and those two fields are written only
// by the colour picker. So an account that had never opened Settings inherited whatever the
// previous person on that device had left there — including their background photograph.
//
// The language is the deliberate exception: it belongs to the device and to whoever is reading the
// login screen, not to the session. Resetting it would drop the next person back to English on
// their way in. That asymmetry is the part worth pinning, because it looks like an oversight.

import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './store';

const CUSTOM = {
  primaryColor: '350 90% 40%',
  isDarkMode: false,
  customThemeIsDark: true,
  backgroundImage: 'https://example.invalid/a-personal-photo.jpg',
  backgroundColor: '#123456',
  backgroundStyle: 'contain' as const,
  backgroundOverlay: 12,
  overlayColor: '#abcdef',
  soundEnabled: false,
  hapticsEnabled: false,
};

describe('resetTheme', () => {
  beforeEach(() => {
    useThemeStore.getState().setAdvancedTheme(CUSTOM);
  });

  it('the fixture really does dirty the store, so the assertions below mean something', () => {
    const s = useThemeStore.getState();
    expect(s.backgroundImage).toBe(CUSTOM.backgroundImage);
    expect(s.soundEnabled).toBe(false);
    expect(s.primaryColor).toBe(CUSTOM.primaryColor);
  });

  it('clears every field one account could have personalised', () => {
    useThemeStore.getState().resetTheme();
    const s = useThemeStore.getState();
    expect(s.backgroundImage, 'a background PHOTO must not follow the next account in').toBeNull();
    expect(s.backgroundColor).toBeNull();
    expect(s.overlayColor).toBeNull();
    expect(s.backgroundStyle).toBe('stretch');
    expect(s.backgroundOverlay).toBe(50);
    expect(s.primaryColor).toBe('221.2 83.2% 53.3%');
    expect(s.isDarkMode).toBe(true);
    expect(s.customThemeIsDark).toBe(true);
    expect(s.soundEnabled).toBe(true);
    expect(s.hapticsEnabled).toBe(true);
  });

  it('keeps the language on purpose — the login screen is read before anyone signs in', () => {
    useThemeStore.getState().setAdvancedTheme({ language: 'ro-RO' });
    useThemeStore.getState().resetTheme();
    expect(useThemeStore.getState().language).toBe('ro-RO');
  });

  it('leaves the actions callable afterwards', () => {
    // A reset that replaced the whole state object would drop the functions with it.
    useThemeStore.getState().resetTheme();
    const s = useThemeStore.getState();
    expect(typeof s.setTheme).toBe('function');
    expect(typeof s.setAdvancedTheme).toBe('function');
    expect(typeof s.resetTheme).toBe('function');
    s.setTheme('120 50% 50%', false);
    expect(useThemeStore.getState().primaryColor).toBe('120 50% 50%');
  });
});
