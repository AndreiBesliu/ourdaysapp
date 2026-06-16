// Memory Match themed icon packs. Each pack is 8 distinct Lucide icon NAMES
// (8 pairs → a 16-card board). The names are resolved to actual icon components
// by MemoryMatch's ICON_MAP. Shared by the game and the create flow so the board
// and the renderer always agree.
export const THEME_PACKS: Record<string, { labelKey: string; icons: string[] }> = {
  classic: { labelKey: 'memThemeClassic', icons: ['Gamepad2', 'Rocket', 'Star', 'Heart', 'Flame', 'Zap', 'Camera', 'Music'] },
  animals: { labelKey: 'memThemeAnimals', icons: ['Cat', 'Dog', 'Bird', 'Fish', 'Rabbit', 'Turtle', 'Snail', 'Bug'] },
  food: { labelKey: 'memThemeFood', icons: ['Apple', 'Cherry', 'Carrot', 'Pizza', 'Cake', 'Coffee', 'Egg', 'Cookie'] },
  travel: { labelKey: 'memThemeTravel', icons: ['Plane', 'Car', 'Ship', 'Train', 'Bike', 'Anchor', 'Tent', 'Compass'] },
  nature: { labelKey: 'memThemeNature', icons: ['Sun', 'Moon', 'Cloud', 'Umbrella', 'Snowflake', 'Droplet', 'Wind', 'Rainbow'] },
};

export const DEFAULT_THEME = 'classic';
export const THEME_IDS = Object.keys(THEME_PACKS);

// Build a freshly shuffled 16-card board for a theme (8 pairs, Fisher-Yates).
export function buildMemoryBoard(themeId: string) {
  const pack = THEME_PACKS[themeId] || THEME_PACKS[DEFAULT_THEME];
  const deck = [...pack.icons, ...pack.icons];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map((icon, idx) => ({ id: idx, iconName: icon, isMatched: false }));
}
