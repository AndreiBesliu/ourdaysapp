// src/utils/birthdays.test.ts
//
// Andrei's decision of 24.09.2026: the PUBLIC profile carries day and month, never the year, in the
// form `0000-MM-DD`. Plus two calendar defects from the audit: birthdays existed only in the
// current year, and 29 February rolled into 1 March.

import { describe, it, expect } from 'vitest';
import { birthdayDaysIn } from './birthdays';
import { publicBirthday, publicMirrorFor } from './publicProfile';

describe('what the public profile carries', () => {
  it('day and month only, from a full date', () => {
    expect(publicBirthday('1987-05-12')).toBe('0000-05-12');
    expect(publicBirthday('2000-02-29')).toBe('0000-02-29');
  });

  it('keeps an already-public value as it is', () => {
    expect(publicBirthday('0000-05-12')).toBe('0000-05-12');
  });

  it('never MM-DD — the calendar splits on "-" and reads positions 1 and 2', () => {
    // `'05-12'.split('-')` puts the DAY where the calendar reads the month. The one format that
    // survives that split, in the web app and in any installed copy with that code, is 0000-MM-DD.
    const [, month, day] = publicBirthday('1987-05-12')!.split('-');
    expect([month, day]).toEqual(['05', '12']);
  });

  it('nothing for garbage', () => {
    for (const v of ['', '12.05.1987', '1987-13-01', '1987-00-10', '1987-05-00', '1987-5-12', null, 19870512]) {
      expect(publicBirthday(v), String(v)).toBeNull();
    }
  });

  it('is what the login mirror writes', () => {
    expect(publicMirrorFor({ birthday: '1987-05-12' }, 'Ana').birthday).toBe('0000-05-12');
    expect(publicMirrorFor({}, 'Ana').birthday).toBeNull();
  });
});

describe('on which days the calendar shows it', () => {
  it('in every year on screen, not only this one', () => {
    expect(birthdayDaysIn('0000-01-03', [2026, 2027])).toEqual(['2026-01-03', '2027-01-03']);
  });

  it('29 February on the 28th in a year without it — it used to roll into 1 March', () => {
    expect(birthdayDaysIn('0000-02-29', [2026, 2027, 2028])).toEqual(['2026-02-28', '2027-02-28', '2028-02-29']);
    // And a century year that is not a leap year.
    expect(birthdayDaysIn('0000-02-29', [2100])).toEqual(['2100-02-28']);
  });

  it('reads a full date the same way, since one’s own birthday comes from the user record', () => {
    expect(birthdayDaysIn('1987-05-12', [2026])).toEqual(['2026-05-12']);
  });

  it('nothing for a day that no month has, or for garbage', () => {
    expect(birthdayDaysIn('0000-04-31', [2026])).toEqual([]);
    for (const v of [null, '', '05-12', 'x', 7]) expect(birthdayDaysIn(v, [2026]), String(v)).toEqual([]);
  });
});
