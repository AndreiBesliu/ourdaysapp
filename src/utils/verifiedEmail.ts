// src/utils/verifiedEmail.ts
//
// The address this account has PROVED is theirs, lowercased — or null.
//
// ── Why this reads the token claim and not `user.emailVerified` ───────────────────────────
//
// `firestore.rules` decides with `request.auth.token.email_verified`. The client has a second,
// nearby fact in `auth.currentUser.emailVerified`, which comes from the user record. They are the
// same thing most of the time and they disagree exactly when it hurts: for the minutes between
// confirming an address and the ID token being refreshed, the user record says verified and the
// token still does not. `VerifyEmailBanner.recheck` calls `getIdToken(true)` for precisely this
// reason.
//
// If the screen decided with the user record it would subscribe a listener the rules then refuse
// — and a refused LIST is not a quiet empty result, it is an error per listener reported to the
// health panel. So both sides read the same value: the claim.
//
// ── Why lowercased ────────────────────────────────────────────────────────────────────────
//
// The documents store `toEmail.toLowerCase()`. The rule lowers both sides. A query filter has to
// GUARANTEE the rule it will be validated against, so it has to use the same spelling.
//
// Pure, so the suite can reach it: `auth` would boot Firebase.

/** The claim bag off an ID token result. Only two entries matter here. */
export interface TokenClaims {
  email?: unknown;
  email_verified?: unknown;
  [key: string]: unknown;
}

/**
 * `null` unless the token says, in so many words, that this address is verified.
 *
 * `=== true` and not a truthy test, for the reason this codebase has hit twice: `Boolean("false")`
 * is true. Claims are a bag anybody with the Admin SDK can write, so "verified" arriving as the
 * string `"false"` is not a hypothetical shape — and it must not read as yes. The rule compares
 * with `== true` as well, so strictness here is also what keeps the two sides agreeing.
 */
export function verifiedEmailFrom(claims: TokenClaims | null | undefined): string | null {
  if (!claims || claims.email_verified !== true) return null;
  const email = claims.email;
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
