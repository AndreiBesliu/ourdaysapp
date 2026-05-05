import { create } from 'zustand';

interface ThemeState {
  primaryColor: string;
  isDarkMode: boolean;
  backgroundImage?: string | null;
  backgroundStyle?: 'stretch' | 'repeat' | 'contain';
  backgroundOverlay?: number;
  setTheme: (color: string, isDark: boolean) => void;
  setAdvancedTheme: (theme: Partial<ThemeState>) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  primaryColor: '221.2 83.2% 53.3%',
  isDarkMode: false,
  backgroundImage: null,
  backgroundStyle: 'stretch',
  backgroundOverlay: 50,
  setTheme: (color, isDark) => set({ primaryColor: color, isDarkMode: isDark }),
  setAdvancedTheme: (theme) => set((state) => ({ ...state, ...theme })),
}));
