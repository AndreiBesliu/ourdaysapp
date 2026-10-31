// src/hooks/useHorizontalSwipe.test.ts — the calendar's swipe, without framer-motion (31.10.2026).
//
// The decision is framer's, ported: past 50 px, or fast enough (|distance| × speed over 10 000), and
// only when it is more sideways than up or down, so a phone still scrolls the page.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { swipeDirection } from './useHorizontalSwipe';

describe('swipeDirection', () => {
  it('left is the next period, right the previous one, past 50 px whatever the speed', () => {
    expect(swipeDirection(-51, 0, 2000)).toBe('next');
    expect(swipeDirection(51, 0, 2000)).toBe('prev');
    expect(swipeDirection(-50, 0, 2000)).toBeNull();
    expect(swipeDirection(50, 0, 2000)).toBeNull();
  });

  it('a short flick counts when it is fast: 30 px in 50 ms is 30 × 600 px/s = 18 000', () => {
    expect(swipeDirection(-30, 0, 50)).toBe('next');
    expect(swipeDirection(30, 0, 50)).toBe('prev');
    expect(swipeDirection(-30, 0, 200)).toBeNull(); // 30 × 150 = 4 500
  });

  it('more up or down than sideways is a scroll, not a swipe', () => {
    expect(swipeDirection(-80, 90, 100)).toBeNull();
    expect(swipeDirection(80, -80, 100)).toBeNull();
    expect(swipeDirection(-80, 79, 100)).toBe('next');
  });

  it('a tap is nothing, and a zero-length time does not divide by zero', () => {
    expect(swipeDirection(0, 0, 0)).toBeNull();
    // Time counts as at least 1 ms: 3 px is 3 × 3 000 = 9 000, under the line; 4 px is 4 × 4 000 = 16 000.
    expect(swipeDirection(-3, 1, 0)).toBeNull();
    expect(swipeDirection(-4, 1, 0)).toBe('next');
  });
});

describe('framer-motion is gone from the app', () => {
  it('no file of the app imports it (the warlord submodule is its own app)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'warlord' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(p);
      }
    };
    walk('src');
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => /from ['"](?:framer-motion|motion)(?:\/[^'"]*)?['"]/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('the month grid slides in by class and swipes through the hook, scrolling left free', () => {
    const grid = readFileSync('src/components/CalendarGrid.tsx', 'utf8');
    expect(grid).toContain("direction > 0 ? 'ourdays-slide-next' : direction < 0 ? 'ourdays-slide-prev' : ''");
    expect(grid).toContain("style={{ touchAction: 'pan-y' }}");
    expect(grid).toContain('{...swipe}');
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/\.ourdays-slide-next \{ animation: ourdays-slide-from-right/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.ourdays-slide-next, \.ourdays-slide-prev \{ animation: none; \}/);
  });
});
