// src/utils/eventColors.ts
// The ten event colours, written out so they exist.
//
// ── Why this file has to be so boring ────────────────────────────────────────────────
//
// Three of the ten colours the picker offered — orange, fuchsia and pink — produced no colour at
// all. Not a wrong colour: none. The event rendered with no tint, and the swatch in the picker was
// invisible too, so choosing one looked like choosing nothing.
//
// The cause is that the classes were built from a variable:
//
//     colorClass = `text-${ev.color}-500 bg-${ev.color}-50 dark:bg-${ev.color}-500/10`;
//
// Tailwind generates CSS by scanning source files for LITERAL class strings. It cannot see through
// a template literal, so none of these ten classes were ever generated on purpose. Seven of them
// worked by accident, because those exact strings happen to appear elsewhere in the app — a red
// button, an amber badge. The three with no such accident produced nothing.
//
// Measured before the fix, in dist/assets/index-*.css: red, amber, emerald, blue, indigo, violet
// and rose present; orange, fuchsia and pink absent.
//
// So the map below is deliberately repetitive. Every class is a complete literal, and that is the
// entire point: a shorter version that composed the strings would be exactly the bug again.

export const EVENT_COLORS = [
  'red', 'orange', 'amber', 'emerald', 'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'rose',
] as const;

export type EventColor = (typeof EVENT_COLORS)[number];

/** How an event is tinted in the calendar grid and the day list. */
const EVENT_CLASS: Record<EventColor, string> = {
  red: 'text-red-500 bg-red-50 dark:bg-red-500/10',
  orange: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10',
  amber: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10',
  emerald: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10',
  blue: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10',
  indigo: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10',
  violet: 'text-violet-500 bg-violet-50 dark:bg-violet-500/10',
  fuchsia: 'text-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-500/10',
  pink: 'text-pink-500 bg-pink-50 dark:bg-pink-500/10',
  rose: 'text-rose-500 bg-rose-50 dark:bg-rose-500/10',
};

/** The filled circle in the picker. Same reasoning: one literal per colour. */
const SWATCH_CLASS: Record<EventColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  fuchsia: 'bg-fuchsia-500',
  pink: 'bg-pink-500',
  rose: 'bg-rose-500',
};

export function isEventColor(value: unknown): value is EventColor {
  return typeof value === 'string' && (EVENT_COLORS as readonly string[]).includes(value);
}

/**
 * Classes for an event's tint, or `fallback` when it has no colour of its own.
 *
 * An unrecognised value also falls back — a colour saved by an older build, or edited by hand,
 * should render as a normal event rather than as an invisible one.
 */
export function eventColorClass(color: unknown, fallback = ''): string {
  return isEventColor(color) ? EVENT_CLASS[color] : fallback;
}

/** The picker's swatch. */
export function eventSwatchClass(color: unknown): string {
  return isEventColor(color) ? SWATCH_CLASS[color] : '';
}
