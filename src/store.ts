import { create } from 'zustand';
import { localZone } from './utils/eventTime';
// The remembered language (and why it is remembered at all): utils/languagePref.ts, shared with the
// offline Cards page.
import { LANG_KEY, rememberedLanguage } from './utils/languagePref';
import { isLanguageReady, loadLanguage } from './utils/i18n';

// Remembered locally for the same reason the language is: it is needed to render times on
// the very first paint, before the user document has been read.
const TZ_KEY = 'ourdays.timezone';

function rememberedZone(): string {
  try {
    return localStorage.getItem(TZ_KEY) || localZone();
  } catch {
    return localZone();
  }
}

function rememberZone(timezone: string | undefined) {
  if (!timezone) return;
  try {
    localStorage.setItem(TZ_KEY, timezone);
  } catch { /* private mode */ }
}

function remember(language: string | undefined) {
  if (!language) return;
  try {
    localStorage.setItem(LANG_KEY, language);
  } catch {
    // Nothing to do — the app simply falls back to English next boot.
  }
}

interface ThemeState {
  primaryColor: string;
  isDarkMode: boolean; // Master override for default dark mode
  customThemeIsDark: boolean; // If custom theme uses dark UI
  backgroundImage?: string | null;
  backgroundColor?: string | null;
  backgroundStyle?: 'stretch' | 'repeat' | 'contain';
  backgroundOverlay?: number;
  overlayColor?: string | null;
  language?: string;
  /** IANA zone. Event wall-clock times and reminders are resolved against it. */
  timezone?: string;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  setTheme: (color: string, isDark: boolean) => void;
  setAdvancedTheme: (theme: Partial<ThemeState>) => void;
  /** Drop the signed-out account's appearance so it cannot follow the next one in. */
  resetTheme: () => void;
}

/**
 * The look every account starts from.
 *
 * Named rather than inlined so `resetTheme` restores exactly the same thing the app booted with —
 * a second literal would drift from this one the first time somebody changed a default.
 */
const DEFAULT_THEME = {
  primaryColor: '221.2 83.2% 53.3%',
  isDarkMode: true,
  customThemeIsDark: true,
  backgroundImage: null,
  backgroundColor: null,
  backgroundStyle: 'stretch' as const,
  backgroundOverlay: 50,
  overlayColor: null,
  soundEnabled: true,
  hapticsEnabled: true,
};

// ── The language shown is always one whose words are here (30.10.2026) ──────────────────────────
//
// Four of the six languages load on demand (utils/i18n.ts). `language` is what every screen renders
// with, so it only ever holds a READY one: asked for another — at boot from this device's memory, from
// the profile after sign-in, from Settings — the store keeps the current one, loads the new one and
// switches when it arrives, so nobody sees a screen half in English. The last ask wins. One that cannot
// load (no signal) leaves the current language; the choice is still remembered, and tried again at the
// next start.
let asked: string | undefined;

function ask(language: string, apply: (language: string) => void): Promise<void> {
  asked = language;
  if (isLanguageReady(language)) {
    apply(language);
    return Promise.resolve();
  }
  return loadLanguage(language).then((ok) => { if (ok && asked === language) apply(language); });
}

const bootLanguage = rememberedLanguage();

export const useThemeStore = create<ThemeState>((set) => ({
  ...DEFAULT_THEME,
  language: isLanguageReady(bootLanguage) ? bootLanguage : 'en-US',
  timezone: rememberedZone(),
  setTheme: (color, isDark) => set({ primaryColor: color, isDarkMode: isDark }),
  setAdvancedTheme: (theme) => {
    remember(theme.language);
    rememberZone(theme.timezone);
    const { language, ...rest } = theme;
    set((state) => ({ ...state, ...rest }));
    if (language !== undefined) void ask(language, (ready) => set({ language: ready }));
  },
  // The LANGUAGE deliberately survives. It is the one preference that belongs to the device and
  // the person reading the login screen, not to the session — resetting it would drop whoever is
  // about to sign in back to English on the way there.
  resetTheme: () => set({ ...DEFAULT_THEME }),
}));

/**
 * Settles once the language this device remembers is the one shown, or could not load. main.tsx waits
 * for it, briefly, before the first paint, so a French reader does not see the app in English first.
 */
export const bootLanguageReady: Promise<void> = ask(bootLanguage, (ready) => useThemeStore.setState({ language: ready }));
