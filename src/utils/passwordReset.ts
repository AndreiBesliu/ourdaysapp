// src/utils/passwordReset.ts
//
// "Forgot password?" on the sign-in screen (Andrei chose it from the backlog, 28.09.2026: until then
// somebody who signed up with email and password and forgot it was locked out for good — the app
// never called `sendPasswordResetEmail`). Pure: what the screen says for each answer from Firebase.
//
// ── The rule that shapes it ──────────────────────────────────────────────────────────────────
//
// The screen never says whether an account exists. "No account with that email" answers a question
// anybody can ask about anybody's address. So success and `auth/user-not-found` read the same, and
// the sentence says "if an account exists". (Projects with email-enumeration protection on never
// return user-not-found at all; this holds either way.)

/** What the reset screen shows after asking Firebase for the email. */
export type ResetOutcome = 'sent' | 'invalidEmail' | 'tooMany' | 'failed';

/** The outcome for an `auth/*` error code; `undefined` means the request went through. */
export function resetOutcome(code: string | undefined): ResetOutcome {
  switch (code) {
    case undefined:
    case 'auth/user-not-found':
      return 'sent';
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'invalidEmail';
    case 'auth/too-many-requests':
      return 'tooMany';
    default:
      return 'failed';
  }
}

/** The i18n key of the sentence for each outcome. */
export const RESET_MESSAGE_KEY: Record<ResetOutcome, string> = {
  sent: 'resetLinkSent',
  invalidEmail: 'authInvalidEmail',
  tooMany: 'authTooManyRequests',
  failed: 'resetLinkFailed',
};

/**
 * The language Firebase writes the email in, from the app's ('ro-RO' → 'ro'). Firebase takes the
 * bare language code; the app's own list is six languages, all of which it knows.
 */
export function emailLanguage(appLanguage: string | undefined): string {
  return (appLanguage || 'en-US').split('-')[0] || 'en';
}
