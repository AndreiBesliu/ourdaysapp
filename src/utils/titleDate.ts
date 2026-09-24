// src/utils/titleDate.ts
//
// A date written in an event's title — "dentist luni", "concediu 1 mai" — read the way the person
// meant it.
//
// ── What it did before, measured with Thursday 24.09.2026 as today ──────────────────────────
//
//   * "dentist luni" → Monday 21.09: the Monday that had ALREADY passed. "concediu 1 mai" → 1 May
//     of THIS year, five months ago; "5 septembrie" → the 5th, three weeks ago. Nobody schedules
//     into the past by typing a weekday; `forwardDate` is what "luni" means.
//   * The Romanian words were matched with `\bmaine\b` and friends — ASCII only. So "mâine",
//     "marți", "sâmbătă", "poimâine", written the way Romanian is written, matched nothing.
//   * "luni" was always Monday. It is also the plural of "month": "concediu peste 2 luni" became
//     "peste 2 monday" and moved the event to Monday 21.09 — in the past. "peste/în N luni" is now
//     months; see below for why ONLY that phrase.
//   * "meeting at 3" typed at nine in the morning, with forwardDate on, moves the event to TOMORROW
//     (three o'clock has passed). A bare time says nothing about the day, so a result counts only
//     when the day, the weekday or the month was actually stated.
//
// And the form overwrote a date the person had already picked, on every keystroke. That part is
// the form's (`AddEventModal`), which now stops listening once the date field is edited by hand.
//
// ── What the first repair got wrong, found by the pre-deploy review the same day ────────────
//
// It read any number before "luni", "zile" or "mai" as a date, and a number is far more often a
// quantity or a clock. Measured on that version:
//   * "ședință la ora 10 luni" → 10 MONTHS away. It is ten o'clock on Monday.
//   * "concediu 5 zile" → the event moved five days. It is a five-day holiday, not a date.
//   * "mai 10 ouă", "mai 3 sticle" → May. "mai" before a number is "N more".
//   * "2 mai multe" → 2 May. "N mai" followed by "mult", "puțin", "devreme"… is a comparison.
// So a count of months, weeks or days is a date only after "peste" or "în" — "in N …" is exactly
// what those say — and "mai" is May only AFTER a number, never before, and not when a comparison
// follows it.

import * as chrono from 'chrono-node';

/** Lower case, diacritics removed: "Mâine, marți" → "maine, marti". ș and ş, ț and ţ alike. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Applied to text that has already been stripped, so every Romanian spelling meets one pattern.
// Order matters where one word contains another: "poimaine" before "maine", "astazi" before "azi".
const WORDS: Array<[RegExp, string]> = [
  // "luni" is Monday AND the plural of "month". Months only in "peste/în N luni" — a bare number
  // before it is as likely a clock ("la ora 10 luni"). Before the weekday rule, so it wins.
  [/\b(?:peste|in)\s+(\d+)\s+luni\b/g, 'in $1 months'],
  [/\b(?:peste|in)\s+(\d+)\s+saptamani\b/g, 'in $1 weeks'],
  [/\b(?:peste|in)\s+(\d+)\s+zile\b/g, 'in $1 days'],
  [/\b(?:peste|in)\s+(?:o|1)\s+luna\b/g, 'in 1 month'],
  [/\b(?:peste|in)\s+(?:o|1)\s+saptamana\b/g, 'in 1 week'],
  [/\b(?:peste|in)\s+(?:o|1)\s+zi\b/g, 'in 1 day'],
  [/\bpoimaine\b/g, 'in 2 days'],
  [/\bmaine\b/g, 'tomorrow'],
  [/\bastazi\b/g, 'today'],
  [/\bazi\b/g, 'today'],
  [/\bluni\b/g, 'monday'],
  [/\bmarti\b/g, 'tuesday'],
  [/\bmiercuri\b/g, 'wednesday'],
  [/\bjoi\b/g, 'thursday'],
  [/\bvineri\b/g, 'friday'],
  [/\bsambata\b/g, 'saturday'],
  [/\bduminica\b/g, 'sunday'],
  [/\bianuarie\b/g, 'january'],
  [/\bfebruarie\b/g, 'february'],
  [/\bmartie\b/g, 'march'],
  [/\baprilie\b/g, 'april'],
  // "mai" is May only AFTER a number ("1 mai"), and not when a comparison follows ("2 mai multe").
  // Before a number it is "N more": "mai 10 ouă". Otherwise it is "more" and is left alone.
  [/(\d{1,2})\s+mai\b(?!\s+(?:mult|multe|multi|multa|putin|putine|putini|putina|devreme|tarziu)\b)/g, '$1 may'],
  [/\biunie\b/g, 'june'],
  [/\biulie\b/g, 'july'],
  [/\bseptembrie\b/g, 'september'],
  [/\boctombrie\b/g, 'october'],
  [/\bnoiembrie\b/g, 'november'],
  [/\bdecembrie\b/g, 'december'],
];

/**
 * Whether a restored draft's date was picked by hand — and so must not be moved by the title.
 *
 * The form's lock is a ref that lives as long as the form, which is never unmounted. Until the
 * pre-deploy review of 24.09.2026 it was cleared only when NO draft was restored, so a restored
 * draft inherited the lock from whatever event was opened before it. The draft now carries its
 * own; one saved before it did says nothing, and nothing is not a hand.
 */
export function restoredDateLock(draft: unknown): boolean {
  return !!draft && typeof draft === 'object' && (draft as { dateChosenByHand?: unknown }).dateChosenByHand === true;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The `yyyy-MM-dd` a title names, on or after `today`, or null when it names no day.
 *
 * `today` is a parameter, not `new Date()`, so a test can fix it — and so the answer does not
 * depend on the moment the test happens to run.
 */
export function titleDate(title: unknown, today: Date): string | null {
  if (typeof title !== 'string' || !title.trim()) return null;
  let text = stripDiacritics(title);
  for (const [re, en] of WORDS) text = text.replace(re, en);

  for (const r of chrono.parse(text, today, { forwardDate: true })) {
    const c = r.start;
    if (!(c.isCertain('day') || c.isCertain('weekday') || c.isCertain('month'))) continue;
    const d = c.date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return null;
}
