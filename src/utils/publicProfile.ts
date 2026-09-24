// src/utils/publicProfile.ts
//
// What the public `profiles` mirror carries for one person.
//
// ── Why this is a function ────────────────────────────────────────────────────────────
//
// The mirror exists so group members can render a name, an avatar and a birthday without reading
// the owner-only user document. It is written on every sign-in, from whatever the sign-in handler
// happens to know at that moment — and on a brand-new account it knows almost nothing: the handler
// reads `users/{uid}` before the signup path has written it, and never re-reads.
//
// It used to fill the gap with `currentUser.email?.split('@')[0]`. So somebody who typed
// "Andrei Besliu" on the form was published to everybody else as "besliandrei" for the whole first
// session. Their OWN screens read the user document and looked right, which is why it went
// unreported. And the server prefers the mirror — `profiles.name || users.name` — so the invented
// name outranked the real one, and a friendship formed during that session copied it across.
//
// The rule is one line long and it was worth pulling out of a 120-line sign-in handler to say it
// plainly: **a mirror reflects; it does not invent.** Omitting the key on a `{ merge: true }` write
// leaves whatever is already there, which is what makes the two racing writes safe in either order.

export interface MirrorSource {
  name?: unknown;
  photoURL?: unknown;
  birthday?: unknown;
}

export interface MirrorFields {
  photoURL: string | null;
  birthday: string | null;
  name?: string;
}

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * A birthday as the PUBLIC profile may carry it: day and month, never the year.
 *
 * Andrei, 24.09.2026: `profiles/{uid}` is readable by every signed-in account, and a full date of
 * birth there is an age anybody can read. The full date stays in `users/{uid}`, which only its
 * owner reads. The format is `0000-MM-DD`, NOT `MM-DD`: the calendar splits on '-' and takes
 * positions 1 and 2 as month and day, so `MM-DD` would have put the day where the month goes —
 * in the web app and in any installed copy with that code.
 *
 * Accepts a full `yyyy-MM-dd` or an already-public `0000-MM-DD`; anything else is null.
 */
export function publicBirthday(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `0000-${m[2]}-${m[3]}`;
}

/**
 * The fields to merge into `profiles/{uid}`.
 *
 * `name` is present only when one is actually known — from the user document, or failing that from
 * the Auth record. Never derived from the e-mail, and never a placeholder: a reader that finds no
 * name falls back per viewer, which is transient, instead of a guess being persisted for everyone.
 */
export function publicMirrorFor(
  userDoc: MirrorSource | null | undefined,
  authDisplayName: unknown,
): MirrorFields {
  const src = userDoc || {};
  const out: MirrorFields = {
    photoURL: text(src.photoURL) ? src.photoURL : null,
    // Day and month only — see `publicBirthday`.
    birthday: publicBirthday(src.birthday),
  };
  const name = text(src.name) ? src.name : (text(authDisplayName) ? authDisplayName : null);
  if (name) out.name = name;
  return out;
}
