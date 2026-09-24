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
//     "peste 2 monday" and moved the event to Monday 21.09 — in the past. A number before it now
//     makes it months. ("mai" has the same double meaning, "more", but chrono never parsed a bare
//     "may", so that one never misfired. It is guarded the same way anyway, and pinned by a test,
//     so no later rule can start to.)
//   * "meeting at 3" typed at nine in the morning, with forwardDate on, moves the event to TOMORROW
//     (three o'clock has passed). A bare time says nothing about the day, so a result counts only
//     when the day, the weekday or the month was actually stated.
//
// And the form overwrote a date the person had already picked, on every keystroke. That part is
// the form's (`AddEventModal`), which now stops listening once the date field is edited by hand.

import * as chrono from 'chrono-node';

/** Lower case, diacritics removed: "Mâine, marți" → "maine, marti". ș and ş, ț and ţ alike. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Applied to text that has already been stripped, so every Romanian spelling meets one pattern.
// Order matters where one word contains another: "poimaine" before "maine", "astazi" before "azi".
const WORDS: Array<[RegExp, string]> = [
  // "luni" is Monday AND the plural of "month" — "peste 2 luni" is "in 2 months". A number
  // before it decides, the same way it does for "mai". Before the weekday rule, so it wins.
  [/\bpeste\b/g, 'in'],
  [/(\d+)\s+luni\b/g, '$1 months'],
  [/(\d+)\s+saptamani\b/g, '$1 weeks'],
  [/(\d+)\s+zile\b/g, '$1 days'],
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
  // "mai" only beside a number: "1 mai", "mai 5". Otherwise it is "more".
  [/(\d{1,2})\s+mai\b/g, '$1 may'],
  [/\bmai\s+(\d{1,2})\b/g, 'may $1'],
  [/\biunie\b/g, 'june'],
  [/\biulie\b/g, 'july'],
  [/\bseptembrie\b/g, 'september'],
  [/\boctombrie\b/g, 'october'],
  [/\bnoiembrie\b/g, 'november'],
  [/\bdecembrie\b/g, 'december'],
];

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
