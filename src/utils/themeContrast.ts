// src/utils/themeContrast.ts
// Which text colour can actually be READ on the background this user built?
//
// ── Why this exists ───────────────────────────────────────────────────────────────────
//
// The `dark` class on <html> flips every `dark:` text colour in the app. It was decided by
// `isDarkMode || customThemeIsDark` — a TOGGLE. The background underneath the text is decided by
// something else entirely: a free colour picker (`backgroundColor`), optionally a background
// image, and always an overlay (`overlayColor` at `backgroundOverlay`%, default 50).
//
// Nothing tied the two together, and the two controls sit next to each other in Settings. So
// "dark theme on, and my own light background" — an ordinary thing to want — produced light text
// on a light background across the whole app. Measured, with the app's own Tailwind tokens
// (zinc-100 on / zinc-900 off):
//
//     overlay   dark toggle ON + white bg     dark toggle OFF + black bg
//       0-20%   1.01 – 1.46  invisible        1.01 – 1.46  invisible
//         50%   3.62         below AA         4.46         below AA
//        100%   19.11        fine             17.72        fine
//
// The default overlay is black when the toggle is dark and white when it is light, so at 50% it
// half-MASKS the mistake — which is why this never looked like an obvious bug. The slider goes to
// 0, where nothing masks it. And a correct pairing plus a chosen overlay colour reaches 3.40 on
// its own, with no mismatch at all.
//
// So the decision moves off the toggle and onto the thing the text actually sits on. This is the
// same technique `App.tsx` already uses twelve lines above to pick `--primary-foreground`; it was
// simply never applied to the page background.
//
// Pure and DOM-free on purpose: the headless suite can exercise every combination, which is the
// only way to check a matrix like this without a browser and an account.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb`. Returns null for anything else — callers decide the fallback, because
 *  a half-typed colour from a live picker must never throw inside a render effect. */
export function hexToRgb(hex: unknown): Rgb | null {
  if (typeof hex !== 'string') return null;
  const s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  return null;
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** `over` painted at `alpha` on top of `base` — the composite the eye actually receives. */
export function compositeOver(base: Rgb, over: Rgb, alpha: number): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    r: over.r * a + base.r * (1 - a),
    g: over.g * a + base.g * (1 - a),
    b: over.b * a + base.b * (1 - a),
  };
}

/** The app's two body defaults, matching App.tsx. */
export const DEFAULT_DARK_BG: Rgb = { r: 0x09, g: 0x09, b: 0x0b }; // zinc-950
export const DEFAULT_LIGHT_BG: Rgb = { r: 0xff, g: 0xff, b: 0xff };

/** The Tailwind tokens the app actually renders body text in. */
export const TEXT_ON_DARK: Rgb = { r: 0xf4, g: 0xf4, b: 0xf5 }; // zinc-100, used when `dark` is on
export const TEXT_ON_LIGHT: Rgb = { r: 0x18, g: 0x18, b: 0x1b }; // zinc-900, used when `dark` is off

export interface ThemeInput {
  /** The global dark switch. When on, App.tsx paints the body zinc-950 and ignores the custom background. */
  isDarkMode: boolean;
  /** The user's manual "dark surfaces" toggle for their custom theme. */
  customThemeIsDark: boolean;
  /** Free colour picker; null when unset. */
  backgroundColor?: string | null;
  /** Free colour picker for the overlay; null falls back to black/white by `customThemeIsDark`. */
  overlayColor?: string | null;
  /** 0..100, default 50. */
  backgroundOverlay?: number | null;
  /** Only its PRESENCE matters here — we cannot sample an image's pixels, so the overlay is the estimate. */
  backgroundImage?: string | null;
}

/**
 * The colour body text will actually sit on.
 *
 * With a background IMAGE the true answer is unknowable without sampling the image, so the overlay
 * over the chosen (or default) colour is used as the estimate — which is honest, because at a high
 * overlay the overlay IS what you see, and at a low one the caller is told the estimate is weak.
 */
export function effectiveBackground(t: ThemeInput): Rgb {
  // The global switch wins: App.tsx paints zinc-950 flat and drops the custom background entirely.
  if (t.isDarkMode) return DEFAULT_DARK_BG;

  const base =
    hexToRgb(t.backgroundColor) ?? (t.customThemeIsDark ? DEFAULT_DARK_BG : DEFAULT_LIGHT_BG);

  // Same fallback App.tsx uses: black over a dark theme, white over a light one.
  const overlay =
    hexToRgb(t.overlayColor) ?? (t.customThemeIsDark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });

  const pct = typeof t.backgroundOverlay === 'number' && Number.isFinite(t.backgroundOverlay)
    ? t.backgroundOverlay
    : 50;

  return compositeOver(base, overlay, pct / 100);
}

/**
 * Should the `dark` class be on — i.e. should the app render LIGHT text?
 *
 * Decided by which of the two text tokens actually reads better on the effective background,
 * rather than by a toggle that has no relationship to it. For a coherent theme this agrees with
 * the toggle and nothing changes; it only disagrees where the toggle and the background
 * contradict each other, which is exactly the case that was broken.
 */
export function shouldUseLightText(t: ThemeInput): boolean {
  const bg = effectiveBackground(t);
  return contrastRatio(TEXT_ON_DARK, bg) > contrastRatio(TEXT_ON_LIGHT, bg);
}

/**
 * The contrast the user will actually get, so a screen can say so.
 *
 * Returned even when it is fine: the caller decides what to show, and a number that only appears
 * on failure cannot be checked against a number that appears always.
 */
export function effectiveTextContrast(t: ThemeInput): number {
  const bg = effectiveBackground(t);
  return contrastRatio(shouldUseLightText(t) ? TEXT_ON_DARK : TEXT_ON_LIGHT, bg);
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5;

/**
 * True when even the BETTER of the two text colours cannot reach AA on this background.
 *
 * Note what this does NOT claim: that the theme is unusable. It claims the app cannot pick a text
 * colour that reads properly, which is a fact about the background the user chose — and the only
 * honest thing to tell them, since flipping the toggle will not fix it.
 */
export function isUnreadableBackground(t: ThemeInput): boolean {
  return effectiveTextContrast(t) < AA_TEXT;
}
