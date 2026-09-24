// src/utils/titleDate.test.ts
//
// Dates written in a title, read with THURSDAY 24.09.2026 at 09:00 as today — the reference day
// the audit measured the old parser on. See the header of titleDate.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { titleDate, stripDiacritics, restoredDateLock } from './titleDate';

const TODAY = new Date(2026, 8, 24, 9, 0); // local: Thursday

// `npm run test:tz` runs this file under Bucharest and New York and sets EXPECT_TZ. A zone that
// silently failed to apply would make that a third UTC run reporting green, so it is asserted.
describe(`the zone this run was asked for`, () => {
  it('took effect', () => {
    const expected = process.env.EXPECT_TZ;
    if (expected) expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(expected);
  });
});

describe('never in the past', () => {
  it.each([
    ['dentist luni', '2026-09-28'],        // was 21.09, the Monday that had passed
    ['concediu 1 mai', '2027-05-01'],      // was 01.05.2026
    ['5 septembrie', '2027-09-05'],        // was 05.09
    ['ziua mamei 8 martie', '2027-03-08'],
  ])('%s → %s', (title, want) => {
    expect(titleDate(title, TODAY)).toBe(want);
  });
});

describe('Romanian as it is written, with its diacritics', () => {
  it.each([
    ['cină mâine', '2026-09-25'],
    ['ședință marți', '2026-09-29'],
    ['piață sâmbătă', '2026-09-26'],
    ['vizită poimâine', '2026-09-26'],
    ['duminică la bunici', '2026-09-27'],
    ['mâine', '2026-09-25'],
    // And without them, as people also type on a phone.
    ['cina maine', '2026-09-25'],
    ['sedinta marti', '2026-09-29'],
  ])('%s → %s', (title, want) => {
    expect(titleDate(title, TODAY)).toBe(want);
  });

  it('strips both kinds of s-comma and t-comma, and the rest', () => {
    // ș (comma below) and ş (cedilla) are different characters; people type both.
    expect(stripDiacritics('Șșşţțăâî')).toBe('sssttaai');
  });
});

describe('words that are not dates', () => {
  it('"mai" is May only after a number — a pin: chrono never parsed a bare "may", keep it so', () => {
    expect(titleDate('cumpăr mai multe', TODAY)).toBeNull();
    expect(titleDate('mai târziu', TODAY)).toBeNull();
  });

  it('"mai" BEFORE a number is "N more", not May', () => {
    // Pinned the other way until the pre-deploy review of 24.09.2026: "mai 3" was 3 May. That
    // same rule made "mai 10 ouă" (ten more eggs) a date in May.
    expect(titleDate('mai 10 ouă', TODAY)).toBeNull();
    expect(titleDate('mai 3 sticle', TODAY)).toBeNull();
    expect(titleDate('mai 3', TODAY)).toBeNull();
  });

  it('"N mai" followed by a comparison is not a date', () => {
    expect(titleDate('2 mai multe', TODAY)).toBeNull();
    expect(titleDate('cumpără 3 mai puține', TODAY)).toBeNull();
    expect(titleDate('vin 2 mai târziu', TODAY)).toBeNull();
    // …while the date itself still is one, followed by anything else.
    expect(titleDate('concediu 1 mai la munte', TODAY)).toBe('2027-05-01');
  });

  it('"peste/în N luni" is months, not Monday — the old code made it Monday 21.09, in the past', () => {
    expect(titleDate('concediu peste 2 luni', TODAY)).toBe('2026-11-24');
    expect(titleDate('concediu în 2 luni', TODAY)).toBe('2026-11-24');
    expect(titleDate('peste 3 zile', TODAY)).toBe('2026-09-27');
    expect(titleDate('peste o săptămână', TODAY)).toBe('2026-10-01');
  });

  it('a bare number before "luni" is a clock, not months', () => {
    expect(titleDate('ședință la ora 10 luni', TODAY)).toBe('2026-09-28');
  });

  it('a count of days is a duration, not a date', () => {
    expect(titleDate('concediu 5 zile', TODAY)).toBeNull();
    expect(titleDate('tratament 10 zile', TODAY)).toBeNull();
  });

  it('a bare time says nothing about the day', () => {
    // With forwardDate on, "at 3" typed at 09:00 would otherwise be TOMORROW at 03:00.
    expect(titleDate('meeting at 3', TODAY)).toBeNull();
    expect(titleDate('ședință la 15:00', TODAY)).toBeNull();
  });

  it('nothing at all', () => {
    for (const t of ['', '   ', 'dentist', null, undefined, 42]) {
      expect(titleDate(t, TODAY), String(t)).toBeNull();
    }
  });
});

describe('the form stops listening once the date is picked by hand', () => {
  // A source check — the weaker net, used because the form cannot be mounted here. It pins the
  // three lines the lock is made of: typing "Meeting at 3" used to reset a hand-picked date.
  const src = readFileSync(resolve(process.cwd(), 'src/components/AddEventModal.tsx'), 'utf8');

  it('the title only moves the date while the lock is off', () => {
    expect(src).toMatch(/if \(!editEvent && !dateChosenByHand\.current\) \{\s*const day = titleDate\(newTitle, new Date\(\)\);/);
  });

  it('editing the date field sets the lock, and opening the form clears it', () => {
    expect(src).toMatch(/const next = e\.target\.value;\s*dateChosenByHand\.current = true;/);
    expect(src).toMatch(/dateChosenByHand\.current = false;/);
  });

  it("a restored draft brings its OWN lock, not the previous event's", () => {
    // Until 24.09.2026 the lock was cleared only when no draft was restored.
    expect(src).toMatch(/if \(parsed\.eventDate\) setEventDate\(parsed\.eventDate\);[\s\S]{0,160}dateChosenByHand\.current = restoredDateLock\(parsed\);/);
    expect(src).toMatch(/dateChosenByHand: dateChosenByHand\.current,/);
  });
});

describe('the lock a draft carries', () => {
  it('is on only when the draft says the date was picked by hand', () => {
    expect(restoredDateLock({ eventDate: '2026-10-01', dateChosenByHand: true })).toBe(true);
    expect(restoredDateLock({ eventDate: '2026-10-01', dateChosenByHand: false })).toBe(false);
    // A draft saved before the field existed says nothing — and nothing is not a hand.
    expect(restoredDateLock({ eventDate: '2026-10-01' })).toBe(false);
    expect(restoredDateLock({ dateChosenByHand: 'true' })).toBe(false);
    expect(restoredDateLock(null)).toBe(false);
  });
});
