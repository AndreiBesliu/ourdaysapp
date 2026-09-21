// src/hooks/useVerifiedEmail.ts
//
// One place the three email-addressed listeners ask the same question.
//
// `group_invites` and `friend_requests` can be addressed to a uid or to an email. The uid half
// needs nothing: a uid cannot be spoofed. The email half is a claim, and since 20.09 the rules
// only honour it for an address the account has verified — which means a client that subscribes
// anyway gets the whole LIST refused, not a shorter list, and reports an error per listener every
// time the screen mounts.
//
// So the question is asked once, in the same terms the rules use, and the three sites simply skip
// when the answer is null.

import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { reportError } from '../reportError';
import { verifiedEmailFrom } from '../utils/verifiedEmail';

/**
 * `email`: the lowercased address this account has proved, or null.
 * `ready`: whether the token has been read yet.
 *
 * The two are separate on purpose. A listener only needs `email` — starting null and resolving on
 * the next tick means it subscribes a moment after mount rather than immediately, which is the
 * right way round: subscribing first and discovering the refusal afterwards is the thing being
 * avoided. But a SCREEN that wants to explain why an email-addressed list is empty must not say so
 * during the tick before the answer arrives, or every verified user sees the sentence flash.
 *
 * `false` for `refresh` reads the token the SDK already holds. It is refreshed on sign-in, on
 * reload, and by `VerifyEmailBanner` the moment somebody confirms — forcing it here would put a
 * network round trip in front of every mount of the calendar to learn something that has not
 * changed.
 */
export function useVerifiedEmail(): { email: string | null; ready: boolean } {
  const [state, setState] = useState<{ email: string | null; ready: boolean }>({ email: null, ready: false });

  // ── Why this SUBSCRIBES instead of reading once ──────────────────────────────────────
  //
  // The first version read the token in an effect with an empty dependency array and never looked
  // again. `VerifyEmailBanner.recheck` — the "I verified" button — calls `reload()` and
  // `getIdToken(true)`, then hides itself. The hook's state stayed `{email: null}`, so the invite
  // and friend-request listeners kept bailing out for the REST OF THE SESSION.
  //
  // That is worse than the hole it was closing. The person confirms their address, the prompt
  // telling them to disappears, and their invitations still do not arrive — with nothing left on
  // screen to explain it, and no reason to suspect a reload would help.
  //
  // `onIdTokenChanged` fires on sign-in, on sign-out, and whenever the token is refreshed, which
  // is exactly what `getIdToken(true)` does. So the button now completes the flow it promises.
  useEffect(() => {
    let alive = true;
    const apply = (user: { getIdTokenResult: (f: boolean) => Promise<{ claims: unknown }> } | null) => {
      if (!user) { if (alive) setState({ email: null, ready: true }); return; }
      user.getIdTokenResult(false)
        .then((result) => {
          if (alive) setState({ email: verifiedEmailFrom(result.claims as never), ready: true });
        })
        .catch((e) => {
          // Reported rather than swallowed: the consequence of failing to read this is invitations
          // that are never shown, which is indistinguishable from invitations nobody sent.
          reportError(e instanceof Error ? e.message : String(e), { context: 'useVerifiedEmail' });
          // NOT `ready: true`. An unread token is not a verdict, and claiming one would tell the
          // person their address is unconfirmed on the strength of a network failure.
          if (alive) setState({ email: null, ready: false });
        });
    };
    apply(auth.currentUser);
    const unsub = onIdTokenChanged(auth, apply);
    return () => { alive = false; unsub(); };
  }, []);

  return state;
}
