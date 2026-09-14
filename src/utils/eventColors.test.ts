// src/utils/eventColors.test.ts
//
// The defect was three colours that produced no CSS, because the classes were composed from a
// variable and Tailwind only sees literals. The test that matters is therefore not "does this
// function return a string" — it is "does every offered colour have a complete literal behind it",
// and it is enforced by reading the source of the module itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVENT_COLORS, eventColorClass, eventSwatchClass, isEventColor,
} from './eventColors';

const RAW = readFileSync(join(__dirname, 'eventColors.ts'), 'utf8');
/**
 * The module with its comments stripped.
 *
 * Its header QUOTES the buggy template literal as the explanation, so the check below matched
 * the prose and failed on a file that was correct. The test caught itself; this is the repair.
 * A regex, deliberately — building it from a newline literal is what broke the previous attempt.
 */
const SOURCE = RAW.replace(/^\s*\/\/.*$/gm, '');

describe('every colour the picker offers actually exists', () => {
  it('offers the ten the picker shows', () => {
    expect(EVENT_COLORS).toEqual([
      'red', 'orange', 'amber', 'emerald', 'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'rose',
    ]);
  });

  it('has a tint and a swatch for each', () => {
    for (const c of EVENT_COLORS) {
      expect(eventColorClass(c), c).not.toBe('');
      expect(eventSwatchClass(c), c).not.toBe('');
    }
  });

  it('writes every class as a LITERAL in this file, which is the whole fix', () => {
    // Tailwind generates CSS by scanning for literal class strings. A clever refactor that built
    // these with `${}` would typecheck, pass every other test here, and reintroduce the exact bug:
    // three colours silently rendering as nothing. So the source itself is the assertion.
    for (const c of EVENT_COLORS) {
      for (const cls of [`text-${c}-500`, `bg-${c}-50`, `dark:bg-${c}-500/10`, `bg-${c}-500`]) {
        expect(SOURCE.includes(cls), `${cls} must appear literally in eventColors.ts`).toBe(true);
      }
    }
  });

  it('contains no template-literal class construction', () => {
    expect(SOURCE).not.toMatch(/`[^`]*(text|bg|border)-\$\{/);
  });
});

describe('falling back', () => {
  it('uses the fallback when the event has no colour', () => {
    expect(eventColorClass(null, 'default-class')).toBe('default-class');
    expect(eventColorClass(undefined, 'default-class')).toBe('default-class');
  });

  it('uses the fallback for a colour this build does not know', () => {
    // A value saved by an older build should render as a normal event, never as an invisible one.
    expect(eventColorClass('chartreuse', 'default-class')).toBe('default-class');
    expect(eventColorClass('RED', 'default-class')).toBe('default-class');
  });

  it('survives junk', () => {
    for (const junk of [42, {}, [], true]) {
      expect(() => eventColorClass(junk, 'x')).not.toThrow();
      expect(eventColorClass(junk, 'x')).toBe('x');
      expect(eventSwatchClass(junk)).toBe('');
    }
  });

  it('isEventColor agrees with the list', () => {
    for (const c of EVENT_COLORS) expect(isEventColor(c)).toBe(true);
    for (const c of ['', 'gray', 'Red', null, 7]) expect(isEventColor(c)).toBe(false);
  });
});
