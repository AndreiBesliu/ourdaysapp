// src/utils/primaryTokens.test.ts
//
// The accent colour and the text that has to read on it, from whatever is stored on the account.
//
// `App.tsx` did this inline, with its own HSL→RGB conversion and its own luminance sum sitting
// beside the copy in `themeContrast.ts`. Two implementations of one piece of arithmetic, and the
// reachable-by-nothing one trusted its input: `parseFloat('#3b82f6')` is `NaN`, everything after
// it is `NaN`, and `NaN > 0.179` is **false** — so a malformed accent silently chose the LIGHT
// foreground, while the same malformed string went into `--primary` and made
// `hsl(var(--primary))` invalid. Near-white text on no background at all.
//
// Not hypothetical: both signup paths once wrote `theme.primaryColor` as a hex, and `App.tsx`
// still carries a comment warning about that shape.

import { describe, it, expect } from 'vitest';
import {
  primaryTokens, hslTripletToRgb, relativeLuminance,
  DEFAULT_PRIMARY, FG_DARK, FG_LIGHT,
} from './themeContrast';

describe('parsing the triplet Tailwind consumes', () => {
  it('reads the shipped default', () => {
    expect(hslTripletToRgb('221.2 83.2% 53.3%')).toEqual({ r: 37, g: 99, b: 235 });
  });

  it('reads the owner-pickable presets', () => {
    // Amber, from Settings.tsx, anchored on a value computed BY HAND rather than read back
    // from the function under test:
    //   a = 0.96 x min(0.5, 0.5) = 0.48
    //   g: k = (8 + 43/30) mod 12 = 9.4333 -> min(6.4333, -0.4333, 1) = -0.4333
    //      0.5 - 0.48 x (-0.4333) = 0.708 -> 180.54 -> 181
    // My first draft asserted 182, guessed rather than derived, and this test caught me.
    expect(hslTripletToRgb('43 96% 50%')).toEqual({ r: 250, g: 181, b: 5 });
  });

  it('refuses a HEX — the shape signup actually wrote', () => {
    expect(hslTripletToRgb('#3b82f6')).toBeNull();
  });

  it('refuses every other malformed shape instead of returning NaN', () => {
    for (const bad of ['', '   ', 'hsl(221 83% 53%)', '221 83 53', '221 83% ', 'a b% c%',
                       '221 83% 53% 1', null, undefined, 42, {}, []]) {
      const out = hslTripletToRgb(bad as unknown);
      expect(out, JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses out-of-range percentages', () => {
    expect(hslTripletToRgb('221 -5% 53%')).toBeNull();
    expect(hslTripletToRgb('221 83% 140%')).toBeNull();
  });
});

describe('choosing the foreground', () => {
  it('puts DARK text on a light accent and LIGHT text on a dark one', () => {
    expect(primaryTokens('43 96% 50%').foreground).toBe(FG_DARK);    // amber
    expect(primaryTokens('221.2 83.2% 53.3%').foreground).toBe(FG_LIGHT); // blue
    expect(primaryTokens('270 60% 30%').foreground).toBe(FG_LIGHT);  // deep purple
  });

  it('switches sides exactly at the 0.179 luminance threshold', () => {
    // Pinned against the arithmetic rather than against itself: compute the luminance, then assert
    // the branch agrees. A test that only compared two outputs would follow the code anywhere.
    for (const hsl of ['160 84% 39%', '215 16% 47%', '84 81% 44%', '343 90% 60%']) {
      const lum = relativeLuminance(hslTripletToRgb(hsl)!);
      expect(primaryTokens(hsl).foreground, `${hsl} lum=${lum}`)
        .toBe(lum > 0.179 ? FG_DARK : FG_LIGHT);
    }
  });
});

describe('what happens when the stored value is unusable', () => {
  it('substitutes the default accent instead of writing an invalid one', () => {
    // This is the half that matters most. A bad `--primary` is not merely an odd colour: Tailwind
    // wraps it as `hsl(var(--primary))`, which is invalid at computed-value time, so the accent
    // BACKGROUND disappears everywhere it is used.
    const out = primaryTokens('#3b82f6');
    expect(out.primary).toBe(DEFAULT_PRIMARY);
    expect(out.fellBack).toBe(true);
  });

  it('gives that default the foreground that actually reads on it', () => {
    // The old code returned the light foreground for anything malformed, because `NaN > 0.179` is
    // false. Here the fallback's own luminance decides.
    const out = primaryTokens(undefined);
    expect(out.foreground).toBe(
      relativeLuminance(hslTripletToRgb(DEFAULT_PRIMARY)!) > 0.179 ? FG_DARK : FG_LIGHT);
  });

  it('never returns a non-finite or empty token', () => {
    for (const bad of [null, undefined, '', 'nope', '#fff', NaN, 0]) {
      const out = primaryTokens(bad as unknown);
      expect(out.primary).toBe(DEFAULT_PRIMARY);
      expect([FG_DARK, FG_LIGHT]).toContain(out.foreground);
      expect(hslTripletToRgb(out.primary)).not.toBeNull();
    }
  });

  it('does not claim a fallback when the value was fine', () => {
    // `fellBack` drives an error report. If it were always true the log would fill with noise and
    // stop being read, which is the same as not reporting at all.
    expect(primaryTokens('43 96% 50%').fellBack).toBe(false);
    expect(primaryTokens('  43 96% 50%  ').fellBack).toBe(false);   // ...and tolerates padding
    expect(primaryTokens('  43 96% 50%  ').primary).toBe('43 96% 50%');
  });
});
