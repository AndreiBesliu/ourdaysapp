import { create } from 'zustand';

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
  language: 'en-US',
  soundEnabled: true,
  hapticsEnabled: true,
  setTheme: (color, isDark) => set({ primaryColor: color, isDarkMode: isDark }),
  setAdvancedTheme: (theme) => set((state) => ({ ...state, ...theme })),
}));
