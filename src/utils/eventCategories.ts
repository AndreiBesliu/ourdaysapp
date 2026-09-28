// src/utils/eventCategories.ts
//
// What an event's category looks like in the calendar: its icon, and its tint when the event has no
// colour of its own. One place, used by the month grid, the day list and Today's Overview.
//
// ── What this replaces (28.09.2026, "UI fals" from the backlog, chosen by Andrei) ──────────────
//
// Those three places each had their own `switch (ev.categoryId)` over `family`, `appointments` and
// `important`. The event form saves `family_time` and `health`, not `family` or `appointments`, and
// so does the server's AI classifier (functions/src/index.ts, `validCategories`). Measured on live the
// same day: 27 events — chores 7, other 8, work 5, health 5, family_time 2, and none with the ids the
// calendar looked for. Every "Group Time" and "Health" event therefore rendered as a grey circle,
// like "Other", although the form shows each with its own colour.

import { Briefcase, Users, Wrench, HeartPulse, Star, Circle, type LucideIcon } from 'lucide-react';
import { eventColorClass, type EventColor } from './eventColors';

/** The ids the event form saves and the server's classifier returns, in the form's order. */
export const EVENT_CATEGORY_IDS = ['work', 'family_time', 'chores', 'health', 'other'] as const;

/** The calendar's own birthday events carry this one; nobody can pick it. */
export const BIRTHDAY_CATEGORY_ID = 'important';

// The colour is one of the ten event colours, so its classes are the literal ones Tailwind can see
// (utils/eventColors.ts). The same colours the form's category chips use.
const LOOK: Record<string, { color: EventColor | null; icon: LucideIcon }> = {
  work: { color: 'blue', icon: Briefcase },
  family_time: { color: 'emerald', icon: Users },
  chores: { color: 'amber', icon: Wrench },
  health: { color: 'rose', icon: HeartPulse },
  other: { color: null, icon: Circle },
  [BIRTHDAY_CATEGORY_ID]: { color: 'violet', icon: Star },
};

/** The tint of an event with neither its own colour nor a coloured category. */
export const NEUTRAL_TINT = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';

function lookOf(categoryId: unknown) {
  return typeof categoryId === 'string' && Object.prototype.hasOwnProperty.call(LOOK, categoryId)
    ? LOOK[categoryId]
    : null;
}

/** The icon for a category; a circle for "other" and for anything unknown. */
export function categoryIcon(categoryId: unknown): LucideIcon {
  return lookOf(categoryId)?.icon ?? Circle;
}

/** An event's tint: its own colour first, then its category's, then neutral. */
export function eventTint(ev: { color?: unknown; categoryId?: unknown }): string {
  const byCategory = lookOf(ev.categoryId)?.color;
  return eventColorClass(ev.color, byCategory ? eventColorClass(byCategory, NEUTRAL_TINT) : NEUTRAL_TINT);
}
