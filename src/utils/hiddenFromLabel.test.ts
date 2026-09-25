// src/utils/hiddenFromLabel.test.ts
//
// "Hide from…" hides an event from a member's CALENDAR; it does not make it private — the rules do
// not read `hiddenFrom`, so a hidden member can still fetch the event. The form used to ask "Who in
// this group can see this event?", a promise of access control the app does not keep. Andrei chose,
// on 25.09.2026, to reword the label rather than enforce it (enforcing needs a new data model).
// This pins that no language asks the old question again.

import { describe, it, expect } from 'vitest';
import { t } from './i18n';

// The app's own codes. An unknown code falls back to English, which would pass every assertion
// below for five languages at once — the first version of this test did exactly that.
const LANGS = ['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE'];

describe('the hide-from label does not promise privacy', () => {
  it.each(LANGS)('%s: a statement about calendars, not a question about who may see', (lang) => {
    const desc = t('visibilityDesc', lang);
    expect(desc).not.toBe('visibilityDesc');
    if (lang !== 'en-US') expect(desc, 'its own translation, not the English fallback').not.toBe(t('visibilityDesc', 'en-US'));
    expect(desc).not.toMatch(/\?/);
  });

  it('and English and Romanian say in words that it is not private', () => {
    expect(t('visibilityDesc', 'en-US')).toMatch(/doesn't make it private/);
    expect(t('visibilityDesc', 'ro-RO')).toMatch(/nu îl face privat/);
  });
});
