// src/hooks/useHorizontalSwipe.test.ts — the calendar's swipe, without framer-motion (31.10.2026).
//
// The decision is framer's, ported: past 50 px, or fast enough (|distance| × speed over 10 000), and
// only when it is more sideways than up or down, so a phone still scrolls the page.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSwipeTracker, swipeDirection } from './useHorizontalSwipe';

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

describe('the gesture (review of 31.10.2026)', () => {
  let time = 0;
  const at = (x: number, y = 0, id = 1, isPrimary = true) => ({ button: 0, clientX: x, clientY: y, timeStamp: (time += 300), pointerId: id, isPrimary });
  const click = () => ({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
  const make = () => { const next = vi.fn(); const prev = vi.fn(); return { next, prev, t: createSwipeTracker({ next, prev }) }; };

  it('a swipe that ends with no click does not swallow the next tap on a day', () => {
    const { next, t } = make();
    t.onPointerDown(at(200)); t.onPointerUp(at(120));
    expect(next).toHaveBeenCalledTimes(1);
    t.onPointerDown(at(150)); t.onPointerUp(at(150));
    const c = click(); t.onClickCapture(c);
    expect(c.stopPropagation).not.toHaveBeenCalled();
  });

  it('the click that ends a swipe is swallowed, once', () => {
    const { t } = make();
    t.onPointerDown(at(200)); t.onPointerUp(at(120));
    const ending = click(); t.onClickCapture(ending);
    expect(ending.stopPropagation).toHaveBeenCalled();
    const later = click(); t.onClickCapture(later);
    expect(later.stopPropagation).not.toHaveBeenCalled();
  });

  it('a second finger is not a swipe, and it cancels the first one', () => {
    const { next, prev, t } = make();
    t.onPointerDown(at(150, 0, 1)); t.onPointerDown(at(230, 0, 2, false));
    t.onPointerUp(at(150, 0, 1)); t.onPointerUp(at(70, 0, 2, false));
    expect(next).not.toHaveBeenCalled();
    expect(prev).not.toHaveBeenCalled();
  });

  it('leaving the grid or a cancel ends the gesture: no phantom swipe from an old press', () => {
    const { next, t } = make();
    t.onPointerDown(at(200)); t.onPointerLeave();
    t.onPointerUp(at(100));
    t.onPointerDown(at(200)); t.onPointerCancel();
    t.onPointerUp(at(100));
    expect(next).not.toHaveBeenCalled();
  });

  it('a release of another pointer does not end this gesture', () => {
    const { next, t } = make();
    t.onPointerDown(at(200, 0, 7)); t.onPointerUp(at(100, 0, 8));
    expect(next).not.toHaveBeenCalled();
    t.onPointerUp(at(100, 0, 7));
    expect(next).toHaveBeenCalledTimes(1);
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
