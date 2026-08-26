import { create } from 'zustand';

// The chosen language lives in the user's Firestore document, which is only read AFTER sign-in.
// That left two windows in permanent English for everyone else: the whole login screen, and the
// moment between boot and the profile arriving on every reload. Neither is a translation gap —
// the strings exist — so the fix belongs here, not in the dictionary.
//
// It is a UI preference and nothing else: no identifier, no personal data. Firestore stays the
// source of truth; this is only what to render before it answers, and it is corrected the moment
// it does.
const LANG_KEY = 'ourdays.language';

function rememberedLanguage(): string {
  try {
    return localStorage.getItem(LANG_KEY) || 'en-US';
  } catch {
    // Private mode, disabled storage, an embedded webview: none of them are worth a crash at boot.
    return 'en-US';
  }
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
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  setTheme: (color: string, isDark: boolean) => void;
  setAdvancedTheme: (theme: Partial<ThemeState>) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  primaryColor: '221.2 83.2% 53.3%',
  isDarkMode: true,
  customThemeIsDark: true,
  backgroundImage: null,
  backgroundColor: null,
  backgroundStyle: 'stretch',
  backgroundOverlay: 50,
  overlayColor: null,
  language: rememberedLanguage(),
  soundEnabled: true,
  hapticsEnabled: true,
  setTheme: (color, isDark) => set({ primaryColor: color, isDarkMode: isDark }),
  setAdvancedTheme: (theme) => {
    remember(theme.language);
    set((state) => ({ ...state, ...theme }));
  },
}));
