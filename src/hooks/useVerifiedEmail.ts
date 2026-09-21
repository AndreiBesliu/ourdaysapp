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
import { verifiedEmailState, type VerifiedEmailStatus } from '../utils/verifiedEmail';

/**
 * `email`: the lowercased address this account has proved, or null.
 * `status`: `pending` before the token has been read, `ready` once it has, `failed` if it could
 *           not be.
 *
 * THREE states, and the third is not decoration. The first version had a boolean `ready`, so
 * "have not looked yet" and "looked and could not tell" were the SAME value — and the Friends
 * screen, which gates its honest sentence on that boolean, therefore fell through to "No requests
 * yet" whenever the token read failed. A confident false statement, produced by the very code
 * whose comment says that "nobody asked" and "we could not check" must not read alike.
 *
 * A listener only needs `email`: starting null and resolving on the next tick means it subscribes
 * a moment after mount rather than immediately, which is the right way round. But a SCREEN
 * explaining an empty list has to tell those three apart.
 *
 * `false` for `refresh` reads the token the SDK already holds. It is refreshed on sign-in, on
 * reload, and by `VerifyEmailBanner` the moment somebody confirms — forcing it here would put a
 * network round trip in front of every mount of the calendar to learn something that has not
 * changed.
 */
export function useVerifiedEmail(): { email: string | null; status: VerifiedEmailStatus } {
  const [state, setState] = useState<{ email: string | null; status: VerifiedEmailStatus }>(
    { email: null, status: 'pending' },
  );

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
      if (!user) { if (alive) setState(verifiedEmailState({ kind: 'no-user' })); return; }
      user.getIdTokenResult(false)
        .then((result) => {
          if (alive) setState(verifiedEmailState({ kind: 'claims', claims: result.claims as never }));
        })
        .catch((e) => {
          // Reported rather than swallowed: the consequence of failing to read this is invitations
          // that are never shown, which is indistinguishable from invitations nobody sent.
          reportError(e instanceof Error ? e.message : String(e), { context: 'useVerifiedEmail' });
          // NOT `ready`. An unread token is not a verdict, and claiming one would tell the person
          // their address is unconfirmed on the strength of a network failure. `failed` is its own
          // answer so a screen can say "could not check" instead of inventing one.
          if (alive) setState(verifiedEmailState({ kind: 'error' }));
        });
    };
    apply(auth.currentUser);
    const unsub = onIdTokenChanged(auth, apply);
    return () => { alive = false; unsub(); };
  }, []);

  return state;
}
