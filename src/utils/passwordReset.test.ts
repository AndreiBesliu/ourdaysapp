// src/utils/passwordReset.test.ts
//
// "Forgot password?" (utils/passwordReset.ts) and its wiring on the sign-in screen. Chosen by Andrei
// from the backlog, 28.09.2026: before it, a forgotten password on an email account was a lost account.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetOutcome, RESET_MESSAGE_KEY, emailLanguage } from './passwordReset';
import { translations } from './i18n';

describe('resetOutcome', () => {
  it('success is "sent"', () => {
    expect(resetOutcome(undefined)).toBe('sent');
  });

  it('an address with no account reads EXACTLY like success — the screen never says who has one', () => {
    expect(resetOutcome('auth/user-not-found')).toBe('sent');
    expect(RESET_MESSAGE_KEY[resetOutcome('auth/user-not-found')]).toBe(RESET_MESSAGE_KEY[resetOutcome(undefined)]);
  });

  it('what the person can act on gets its own sentence', () => {
    expect(resetOutcome('auth/invalid-email')).toBe('invalidEmail');
    expect(resetOutcome('auth/missing-email')).toBe('invalidEmail');
    expect(resetOutcome('auth/too-many-requests')).toBe('tooMany');
  });

  it('anything else is one "could not send" — never a false "sent"', () => {
    expect(resetOutcome('auth/network-request-failed')).toBe('failed');
    expect(resetOutcome('auth/internal-error')).toBe('failed');
    expect(resetOutcome('something-new')).toBe('failed');
  });
});

describe('the sentences', () => {
  const langs = Object.keys(translations);
  const NEW_KEYS = ['forgotPassword', 'resetPasswordTitle', 'resetPasswordDesc', 'sendResetLink', 'resetLinkSent', 'resetLinkFailed', 'backToSignIn'];

  it('six languages', () => {
    expect(langs).toEqual(['en-US', 'ro-RO', 'fr-FR', 'es-ES', 'it-IT', 'de-DE']);
  });

  it('every sentence the screen can show exists in every language', () => {
    for (const lang of langs) {
      for (const key of [...Object.values(RESET_MESSAGE_KEY), ...NEW_KEYS]) {
        expect(translations[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('the "sent" sentence says IF an account exists, in every language', () => {
    const conditional: Record<string, RegExp> = {
      'en-US': /^If an account exists/, 'ro-RO': /^Dacă există un cont/, 'fr-FR': /^Si un compte existe/,
      'es-ES': /^Si existe una cuenta/, 'it-IT': /^Se esiste un account/, 'de-DE': /^Falls ein Konto/,
    };
    for (const lang of langs) expect(translations[lang][RESET_MESSAGE_KEY.sent]).toMatch(conditional[lang]);
  });
});

describe('emailLanguage', () => {
  it("takes the bare language from the app's", () => {
    expect(emailLanguage('ro-RO')).toBe('ro');
    expect(emailLanguage('de-DE')).toBe('de');
    expect(emailLanguage(undefined)).toBe('en');
    expect(emailLanguage('')).toBe('en');
  });
});

describe('Login uses them', () => {
  // No DOM in this suite and the screen needs Firebase Auth, so the wiring is held on the source.
  const src = readFileSync(resolve(process.cwd(), 'src/screens/Login.tsx'), 'utf8');

  it('asks Firebase for the email, in the app language, with the typed address trimmed', () => {
    const body = /const handleReset = async[\s\S]*?\n  };\n/.exec(src)![0];
    const lang = body.indexOf('auth.languageCode = emailLanguage(language);');
    const send = body.indexOf('await sendPasswordResetEmail(auth, email.trim());');
    expect(lang).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(lang);
    // Every failure goes through the one mapping; the screen knows no auth code of its own.
    expect(body).toContain('const outcome = resetOutcome(err?.code);');
    expect(src).not.toContain('user-not-found');
    // "No account" lands in the SAME green box as success. Shown in the red error box instead, the
    // sentence would be identical and the colour would still answer the question.
    expect(body).toMatch(/if \(outcome === 'sent'\) setResetSent\(true\);\s*else setError\(/);
  });

  it('shows the one "sent" sentence, and only in reset mode', () => {
    expect(src).toMatch(/\{resetting && resetSent && \([\s\S]*?\{t\(RESET_MESSAGE_KEY\.sent, language\)\}/);
  });

  it('the form submits to the reset in reset mode', () => {
    expect(src).toContain('onSubmit={resetting ? handleReset : handleSubmit}');
  });

  it('"Forgot password?" is offered on sign-in only, beside the password', () => {
    expect(src).toMatch(/\{isLogin && \(\s*<button\s+type="button"\s+onClick=\{\(\) => showReset\(true\)\}/);
  });

  it('reset mode has no password field, no Google button and no sign-up switch', () => {
    expect(src).toMatch(/\{!resetting && \(\s*<div className="space-y-2">[\s\S]*?type="password"/);
    const rest = /\{!resetting && \(<>[\s\S]*?<\/>\)\}/.exec(src);
    expect(rest, 'the block hidden in reset mode').toBeTruthy();
    expect(rest![0]).toContain('onClick={handleGoogleSignIn}');
    expect(rest![0]).toContain("t('noAccountYet', language)");
  });
});
