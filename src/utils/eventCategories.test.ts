// src/utils/eventCategories.test.ts
//
// One list of event categories for the calendar's icons and tints (utils/eventCategories.ts), the
// same list the event form saves and the server's classifier returns. Before 28.09.2026 three
// screens each switched over `family` / `appointments`, which nothing saves; measured on live, 7 of
// 27 events (health, family_time) rendered as grey circles.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Circle, Star } from 'lucide-react';
import {
  EVENT_CATEGORY_IDS, BIRTHDAY_CATEGORY_ID, NEUTRAL_TINT, categoryIcon, eventTint,
} from './eventCategories';
import { eventColorClass } from './eventColors';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('one list, three places that must agree', () => {
  it('the ids are exactly what the event form offers, in its order', () => {
    const src = read('src/components/AddEventModal.tsx');
    const block = /const CATEGORIES = \[([\s\S]*?)\];/.exec(src)![1];
    const formIds = [...block.matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(formIds).toEqual([...EVENT_CATEGORY_IDS]);
  });

  it("and exactly what the server's classifier may return", () => {
    const src = read('functions/src/index.ts');
    const list = /const validCategories = \[([^\]]*)\]/.exec(src)![1];
    const serverIds = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(serverIds).toEqual([...EVENT_CATEGORY_IDS]);
  });
});

describe('the look', () => {
  it('every category but "other" has its own icon and its own tint', () => {
    for (const id of EVENT_CATEGORY_IDS) {
      if (id === 'other') continue;
      expect(categoryIcon(id), id).not.toBe(Circle);
      expect(eventTint({ categoryId: id }), id).not.toBe(NEUTRAL_TINT);
    }
  });

  it('the two that were grey on live are not any more', () => {
    expect(eventTint({ categoryId: 'health' })).toBe(eventColorClass('rose'));
    expect(eventTint({ categoryId: 'family_time' })).toBe(eventColorClass('emerald'));
  });

  it("\"other\", and ids nothing saves, are a neutral circle", () => {
    for (const id of ['other', 'family', 'appointments', 'nope', undefined, null, 7, '__proto__', 'toString']) {
      expect(categoryIcon(id), String(id)).toBe(Circle);
      expect(eventTint({ categoryId: id }), String(id)).toBe(NEUTRAL_TINT);
    }
  });

  it("an event's own colour wins over its category's", () => {
    expect(eventTint({ color: 'pink', categoryId: 'work' })).toBe(eventColorClass('pink'));
    // An unknown colour falls back to the category, not to nothing.
    expect(eventTint({ color: 'plaid', categoryId: 'work' })).toBe(eventColorClass('blue'));
  });

  it("the calendar's birthdays keep their star", () => {
    expect(categoryIcon(BIRTHDAY_CATEGORY_ID)).toBe(Star);
    expect(eventTint({ categoryId: BIRTHDAY_CATEGORY_ID })).toBe(eventColorClass('violet'));
  });
});

describe('the screens use it', () => {
  it('no screen switches over category ids of its own any more', () => {
    for (const f of ['src/components/CalendarGrid.tsx', 'src/screens/CalendarHome.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/switch \(ev\.categoryId\)/);
      expect(src, f).toContain('const Icon = categoryIcon(ev.categoryId);');
      expect(src, f).toContain('const colorClass = eventTint(ev);');
    }
    expect(read('src/components/CalendarGrid.tsx').match(/categoryIcon\(ev\.categoryId\)/g)).toHaveLength(2);
  });

  it("the calendar's birthday events use the shared id", () => {
    expect(read('src/screens/CalendarHome.tsx')).toContain('categoryId: BIRTHDAY_CATEGORY_ID,');
  });
});
