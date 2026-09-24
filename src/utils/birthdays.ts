// src/utils/birthdays.ts
//
// On which days a birthday falls, in the years the calendar is showing.
//
// Two defects, both measured in the audit of 24.09.2026:
//
//   * Birthdays were generated for the CURRENT year only. Browse into January of next year and
//     every birthday there was missing; browse back into December and the same.
//   * A birthday on 29 February became `2026-02-29`, which does not exist, and JavaScript rolled it
//     silently into 1 March. Andrei, 24.09: in a year without the 29th it is shown on the 28th.
//
// Accepts the public form `0000-MM-DD` (profiles carry no year — see `publicBirthday`) and a full
// `yyyy-MM-dd` (a person's own birthday, read from their own user document).

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** The `yyyy-MM-dd` of this birthday in each of `years`, in the same order. Empty for garbage. */
export function birthdayDaysIn(birthday: unknown, years: readonly number[]): string[] {
  if (typeof birthday !== 'string') return [];
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(birthday.trim());
  if (!m) return [];
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return [];
  const out: string[] = [];
  for (const y of years) {
    if (!Number.isInteger(y)) continue;
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    // 29 February in a year without one is the 28th — not the 1st of March. Any other day past the
    // end of its month is not a real birthday and produces nothing.
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
    if (d > last) continue;
    out.push(`${y}-${m[1]}-${String(d).padStart(2, '0')}`);
  }
  return out;
}
