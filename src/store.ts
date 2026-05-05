import { create } from 'zustand';

interface ThemeState {
  primaryColor: string;
  isDarkMode: boolean;
  setTheme: (color: string, isDark: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  primaryColor: '221.2 83.2% 53.3%', // Default to Tailwind blue-500 HSL
  isDarkMode: false,
  setTheme: (color, isDark) => set({ primaryColor: color, isDarkMode: isDark }),
}));
