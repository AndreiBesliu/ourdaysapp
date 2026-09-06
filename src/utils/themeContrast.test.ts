// src/utils/themeContrast.test.ts
//
// The property that matters is not "the maths is right" — it is that the derivation AGREES with
// the toggle for every coherent theme and only overrides an incoherent one. A fix that quietly
// changed how correct themes look would be a worse bug than the one it replaced.

import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  compositeOver,
  effectiveBackground,
  effectiveTextContrast,
  shouldUseLightText,
  isUnreadableBackground,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
  AA_TEXT,
} from './themeContrast';

const base = { isDarkMode: false, customThemeIsDark: false };

describe('the colour maths', () => {
  it('parses both hex forms and refuses everything else', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#09090b')).toEqual({ r: 9, g: 9, b: 11 });
    expect(hexToRgb('09090b')).toEqual({ r: 9, g: 9, b: 11 });
    for (const bad of ['', 'red', '#12', '#1234567', null, undefined, 42, {}]) {
      expect(hexToRgb(bad as unknown), String(bad)).toBeNull();
    }
  });

  it('agrees with the WCAG anchors', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 2);
  });

  it('composites, and clamps an alpha outside 0..1 instead of producing a colour that cannot exist', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(compositeOver(black, white, 0)).toEqual(black);
    expect(compositeOver(black, white, 1)).toEqual(white);
    expect(compositeOver(black, white, 0.5).r).toBeCloseTo(127.5, 1);
    expect(compositeOver(black, white, 5)).toEqual(white);
    expect(compositeOver(black, white, -3)).toEqual(black);
  });
});

describe('a coherent theme is left exactly alone', () => {
  // This is the load-bearing test. If any of these flip, the fix has changed how a theme that was
  // already fine looks — which is not a fix.
  it('dark surfaces on a dark background still render light text', () => {
    const t = { ...base, customThemeIsDark: true, backgroundColor: '#09090b' };
    expect(shouldUseLightText(t)).toBe(true);
    expect(effectiveTextContrast(t)).toBeGreaterThan(AA_TEXT);
  });

  it('light surfaces on a white background still render dark text', () => {
    const t = { ...base, backgroundColor: '#ffffff' };
    expect(shouldUseLightText(t)).toBe(false);
    expect(effectiveTextContrast(t)).toBeGreaterThan(AA_TEXT);
  });

  it('no custom background at all follows the toggle, exactly as before', () => {
    expect(shouldUseLightText({ ...base, customThemeIsDark: true })).toBe(true);
    expect(shouldUseLightText({ ...base, customThemeIsDark: false })).toBe(false);
  });

  it('the global dark switch wins and ignores the custom background', () => {
    // App.tsx paints zinc-950 flat in this branch and drops the custom colour, so the derivation
    // must not be talked out of light text by a white picker that is not being painted.
    const t = { ...base, isDarkMode: true, customThemeIsDark: false, backgroundColor: '#ffffff' };
    expect(shouldUseLightText(t)).toBe(true);
    expect(effectiveTextContrast(t)).toBeGreaterThan(AA_TEXT);
  });
});

describe('the incoherent theme — the bug', () => {
  // Measured against the app's own Tailwind tokens before the fix existed.
  it('dark toggle + white background was invisible at a low overlay, and is now readable', () => {
    const t = { ...base, customThemeIsDark: true, backgroundColor: '#ffffff', backgroundOverlay: 0 };
    // What it used to do: the toggle said dark, so light text landed on white.
    const before = contrastRatio(TEXT_ON_DARK, effectiveBackground(t));
    expect(before).toBeLessThan(1.5);
    // What it does now: the background decides, so the text flips to dark and becomes readable.
    expect(shouldUseLightText(t)).toBe(false);
    expect(effectiveTextContrast(t)).toBeGreaterThan(AA_TEXT);
  });

  it('light toggle + black background, likewise', () => {
    const t = { ...base, customThemeIsDark: false, backgroundColor: '#000000', backgroundOverlay: 0 };
    expect(contrastRatio(TEXT_ON_LIGHT, effectiveBackground(t))).toBeLessThan(1.5);
    expect(shouldUseLightText(t)).toBe(true);
    expect(effectiveTextContrast(t)).toBeGreaterThan(AA_TEXT);
  });

  it('picks the better of the two text colours at EVERY overlay step, never the worse one', () => {
    for (const pct of [0, 10, 20, 30, 40, 50, 60, 75, 90, 100]) {
      for (const bg of ['#ffffff', '#000000', '#7f7f7f', '#101828', '#f5f5f5']) {
        for (const customThemeIsDark of [true, false]) {
          const t = { ...base, customThemeIsDark, backgroundColor: bg, backgroundOverlay: pct };
          const eff = effectiveBackground(t);
          const chosen = shouldUseLightText(t) ? TEXT_ON_DARK : TEXT_ON_LIGHT;
          const other = shouldUseLightText(t) ? TEXT_ON_LIGHT : TEXT_ON_DARK;
          expect(
            contrastRatio(chosen, eff),
            `${bg} @${pct}% dark=${customThemeIsDark}`,
          ).toBeGreaterThanOrEqual(contrastRatio(other, eff));
        }
      }
    }
  });
});

describe('what it refuses to promise', () => {
  it('a mid-grey background cannot be rescued by either text colour, and says so', () => {
    // Honest limit: at #7f7f7f neither zinc-100 nor zinc-900 reaches AA. Flipping the toggle
    // cannot fix that, so the screen has to tell the user rather than silently pick a loser.
    const t = { ...base, backgroundColor: '#7f7f7f', backgroundOverlay: 0 };
    expect(isUnreadableBackground(t)).toBe(true);
    expect(effectiveTextContrast(t)).toBeLessThan(AA_TEXT);
  });

  it('a good background is not reported as unreadable', () => {
    expect(isUnreadableBackground({ ...base, backgroundColor: '#ffffff' })).toBe(false);
    expect(isUnreadableBackground({ ...base, customThemeIsDark: true, backgroundColor: '#09090b' })).toBe(false);
  });

  it('survives malformed input from a live colour picker instead of throwing mid-render', () => {
    for (const bad of ['#', '#12', 'rgb(1,2,3)', '', null, undefined]) {
      const t = { ...base, backgroundColor: bad as unknown as string, overlayColor: bad as unknown as string };
      expect(Number.isFinite(effectiveTextContrast(t))).toBe(true);
    }
    // A NaN slider must not poison the composite.
    const t = { ...base, backgroundColor: '#ffffff', backgroundOverlay: NaN };
    expect(Number.isFinite(effectiveTextContrast(t))).toBe(true);
  });
});
