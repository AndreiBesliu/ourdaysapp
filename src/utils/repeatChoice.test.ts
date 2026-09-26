// src/utils/repeatChoice.test.ts
//
// The repeat dropdown and the labels that name a stored rule. "Weekdays" and "weekends" are not
// frequencies: they are a DAILY rule with a day filter (recurrenceCore.ts explains why). One value for
// the whole choice, so no second control can leave a filter behind on a weekly series.

import { describe, it, expect } from 'vitest';
import { REPEAT_CHOICES, isRepeatChoice, ruleForRepeatChoice, repeatLabelKey, draftFieldsForRepeat, repeatFromDraft } from './recurrence';
import { isFrequency } from './recurrenceCore';
import { translations } from './i18n';

describe('the repeat dropdown', () => {
  it('maps every choice to the rule it stores', () => {
    expect(ruleForRepeatChoice('none')).toBeNull();
    expect(ruleForRepeatChoice('daily')).toEqual({ frequency: 'daily' });
    expect(ruleForRepeatChoice('weekdays')).toEqual({ frequency: 'daily', onlyOn: 'weekdays' });
    expect(ruleForRepeatChoice('weekends')).toEqual({ frequency: 'daily', onlyOn: 'weekends' });
    expect(ruleForRepeatChoice('weekly')).toEqual({ frequency: 'weekly' });
    expect(ruleForRepeatChoice('monthly')).toEqual({ frequency: 'monthly' });
    expect(ruleForRepeatChoice('yearly')).toEqual({ frequency: 'yearly' });
  });

  it('only a daily rule ever carries a filter', () => {
    for (const c of REPEAT_CHOICES) {
      const rule = ruleForRepeatChoice(c);
      if (rule && 'onlyOn' in rule) expect(rule.frequency, c).toBe('daily');
    }
  });

  it('a draft value from another bundle is accepted only if this one knows it', () => {
    for (const c of REPEAT_CHOICES) expect(isRepeatChoice(c), c).toBe(true);
    for (const bad of ['Weekdays', 'mondays', '', null, undefined, 3, { frequency: 'daily' }]) {
      expect(isRepeatChoice(bad), String(bad)).toBe(false);
    }
  });
});

describe('the shared new-event draft, read by old and new tabs alike', () => {
  // What a tab from before 26.09 did with a draft: `if (parsed.repeat) setRepeat(parsed.repeat)`,
  // then stored `{ frequency: repeat }` for anything but 'none' — no check at all.
  const OLD_BUNDLE_CHOICES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

  it('an older tab never restores a value it would store as a frequency nobody reads', () => {
    for (const c of REPEAT_CHOICES) {
      const { repeat } = draftFieldsForRepeat(c);
      expect(OLD_BUNDLE_CHOICES, c).toContain(repeat);
      if (repeat !== 'none') expect(isFrequency(repeat), c).toBe(true);
    }
    // The filtered choices degrade to plain daily there — every day, the way any older reader shows them.
    expect(draftFieldsForRepeat('weekdays')).toEqual({ repeat: 'daily', repeatOnlyOn: 'weekdays' });
    expect(draftFieldsForRepeat('weekends')).toEqual({ repeat: 'daily', repeatOnlyOn: 'weekends' });
  });

  it('this bundle gets back exactly the choice it saved', () => {
    for (const c of REPEAT_CHOICES) expect(repeatFromDraft(draftFieldsForRepeat(c)), c).toBe(c);
  });

  it('drafts from before, and drafts with nonsense, read sensibly', () => {
    expect(repeatFromDraft({ repeat: 'weekly' })).toBe('weekly');
    expect(repeatFromDraft({ repeat: 'daily', repeatOnlyOn: 'mondays' })).toBe('daily');
    expect(repeatFromDraft({ repeat: 'weekly', repeatOnlyOn: 'weekdays' })).toBe('weekly');
    expect(repeatFromDraft({ repeat: 'hourly' })).toBeNull();
    expect(repeatFromDraft({})).toBeNull();
    expect(repeatFromDraft(null)).toBeNull();
  });
});

describe('the label that names a stored rule', () => {
  it('names the filter, not just "Daily"', () => {
    expect(repeatLabelKey({ frequency: 'daily' })).toBe('freqDaily');
    expect(repeatLabelKey({ frequency: 'daily', onlyOn: 'weekdays' })).toBe('freqWeekdays');
    expect(repeatLabelKey({ frequency: 'daily', onlyOn: 'weekends' })).toBe('freqWeekends');
    expect(repeatLabelKey({ frequency: 'weekly' })).toBe('freqWeekly');
    expect(repeatLabelKey({ frequency: 'monthly' })).toBe('freqMonthly');
    expect(repeatLabelKey({ frequency: 'yearly' })).toBe('freqYearly');
  });

  it('says what the calendar does: a filter it ignores is not named', () => {
    // A filter on weekly is ignored by the expansion, so the label must not claim it either; an
    // unknown filter value is plain daily there, and plain daily here.
    expect(repeatLabelKey({ frequency: 'weekly', onlyOn: 'weekdays' })).toBe('freqWeekly');
    expect(repeatLabelKey({ frequency: 'daily', onlyOn: 'mondays' })).toBe('freqDaily');
  });

  it('returns null for a rule the app cannot read, so the caller keeps its own fallback', () => {
    for (const r of [null, undefined, {}, { frequency: 'hourly' }, { frequency: 7 }]) {
      expect(repeatLabelKey(r as never), JSON.stringify(r)).toBeNull();
    }
  });

  it('every key a rule can be named by exists, non-empty, in all six languages', () => {
    // The keys are computed, which the literal-key check (i18nKeysExist) cannot see.
    const keys = ['freqDaily', 'freqWeekdays', 'freqWeekends', 'freqWeekly', 'freqMonthly', 'freqYearly'];
    const langs = Object.keys(translations);
    expect(langs).toHaveLength(6);
    for (const lang of langs) {
      for (const k of keys) {
        const v = (translations as Record<string, Record<string, string>>)[lang][k];
        expect(typeof v === 'string' && v.trim().length > 0, `${lang}.${k}`).toBe(true);
      }
    }
  });
});
