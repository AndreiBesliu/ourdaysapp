// src/utils/notifyStrings.test.ts
// The bell row and the push must say the same thing.
//
// ── Why two dictionaries exist, and what keeps them honest ────────────────────────────
//
// A bell row stores `titleKey`/`bodyKey` and the READER's client renders them, which is why the
// bell has been correct in six languages all along. A push is rendered by the operating system
// from what the SERVER sent, so the server has to choose the language before sending — and it
// cannot import `src/utils/i18n.ts` to do it, because that file is ~3000 lines and pulls in
// date-fns locales for a bundle that exists to run six short strings.
//
// So `functions/src/notifyStrings.ts` is a small second table. Two tables describing one thing is
// exactly the shape that drifts — the two `baseEventData` literals, the theme's two sources of
// truth — so this test is the thing that makes them agree: every key the server can push must
// exist in the app's dictionary too, in every language, with the SAME text.
//
// If it did not, a person would be told one thing by the notification that woke their phone and a
// different thing by the row they tapped through to.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTIFY_LANGS, NOTIFY_STRINGS, normaliseLang, renderNotify,
} from '../../functions/src/notifyStrings';
import { translations } from './i18n';

const APP_LANGS = Object.keys(translations);

describe('the two dictionaries agree', () => {
  it('covers the same languages the app does', () => {
    expect([...NOTIFY_LANGS].sort()).toEqual([...APP_LANGS].sort());
  });

  it('finds keys at all, so this cannot pass by checking nothing', () => {
    expect(Object.keys(NOTIFY_STRINGS).length).toBeGreaterThanOrEqual(6);
  });

  it('every server key exists in the app dictionary, in every language, with the same text', () => {
    const problems: string[] = [];
    for (const [key, row] of Object.entries(NOTIFY_STRINGS)) {
      for (const lang of NOTIFY_LANGS) {
        const app = (translations as Record<string, Record<string, string>>)[lang]?.[key];
        if (app === undefined) {
          problems.push(`${key} [${lang}]: missing from the app dictionary — the bell row would fall back to the raw key`);
        } else if (app !== row[lang]) {
          problems.push(`${key} [${lang}]: push says "${row[lang]}" but the bell says "${app}"`);
        }
      }
    }
    expect(problems, `push and bell disagree:\n${problems.join('\n')}`).toEqual([]);
  });

  it('no server string is empty', () => {
    for (const [key, row] of Object.entries(NOTIFY_STRINGS)) {
      for (const lang of NOTIFY_LANGS) {
        expect(row[lang]?.trim(), `${key} [${lang}]`).toBeTruthy();
      }
    }
  });

  it('a string that takes a name ends with a separator in EVERY language, or in none', () => {
    // The bell renders `${t(bodyKey)}${param}` and the push does the same, so a string the caller
    // passes a name to has to end with a space or it reads "accepted byAndrei".
    //
    // The rule is CONSISTENCY, not "every body ends with a space": plenty of them take no
    // parameter at all ("The enemy has ended their turn."). A first draft of this test asserted
    // the blunt version and failed on a perfectly correct string — so what it checks now is that
    // the translations agree with English about whether a name follows, which is the thing that
    // would actually produce a mangled sentence in one language and not another.
    const problems: string[] = [];
    for (const [key, row] of Object.entries(NOTIFY_STRINGS)) {
      const takesName = row['en-US'].endsWith(' ');
      for (const lang of NOTIFY_LANGS) {
        if (row[lang].endsWith(' ') === takesName) continue;
        problems.push(
          `${key} [${lang}]: English ${takesName ? 'expects' : 'does not expect'} a name after it, ` +
          `but this one ${takesName ? 'does not' : 'does'}`,
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

describe('only the SERVER needs a key it can render', () => {
  it('every key the server pushes is one the server can also render', () => {
    // A key the helper is asked for but does not hold would push the literal key text.
    for (const key of Object.keys(NOTIFY_STRINGS)) {
      expect(renderNotify(key, 'ro-RO')).not.toBe(key);
    }
  });
});

describe('renderNotify', () => {
  it('appends the parameter at the end, like the bell does', () => {
    expect(renderNotify('friendRequestAcceptedBody', 'en-US', 'Ana'))
      .toBe('Your friend request was accepted by Ana');
  });

  it('renders in the requested language', () => {
    expect(renderNotify('inviteLinkUsed', 'ro-RO')).toBe('Invitație acceptată');
    expect(renderNotify('inviteLinkUsed', 'de-DE')).toBe('Einladung angenommen');
  });

  it('an unknown key returns the key rather than throwing', () => {
    // A push reading `notifSomething` is ugly; a thrown error would cost the bell row as well,
    // because both are written by the same call.
    expect(renderNotify('notAKey', 'en-US')).toBe('notAKey');
  });

  it('a language the table lacks falls back to English rather than to nothing', () => {
    expect(renderNotify('inviteLinkUsed', 'xx-XX' as never)).toBe('Invitation accepted');
  });
});

describe('normaliseLang', () => {
  it('keeps the six we support', () => {
    for (const l of NOTIFY_LANGS) expect(normaliseLang(l)).toBe(l);
  });

  it('falls back to English for anything else', () => {
    for (const bad of ['pt-BR', '', null, undefined, 42, {}]) {
      expect(normaliseLang(bad)).toBe('en-US');
    }
  });
});

describe('the keys the app renders are really in the app file', () => {
  it('reads them out of i18n.ts as source, not just the built object', () => {
    // The built object silently keeps the LAST of any duplicate key, which is how five duplicated
    // keys once passed a parity test. Reading the source means a duplicate is visible.
    const src = readFileSync(join(__dirname, 'i18n.ts'), 'utf8');
    for (const key of Object.keys(NOTIFY_STRINGS)) {
      const hits = src.split('\n').filter((l) => new RegExp(`^\\s*${key}:`).test(l)).length;
      expect(hits, `${key} appears ${hits} times in i18n.ts; expected one per language`).toBe(NOTIFY_LANGS.length);
    }
  });
});
