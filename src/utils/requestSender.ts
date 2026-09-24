// src/utils/requestSender.ts
//
// Who a friend request or group invitation is FROM, as the recipient's screen may show it.
//
// Reads the server's stamp (`sender`, `verifiedGroupName` — see functions/src/senderIdentity.ts)
// and nothing else from the request. `fromName`, `fromEmail` and `groupName` are written by the
// sender's own client, and showing them is how a stranger's request read "Mama <mama@…>". They
// are not consulted here even as a fallback: a fallback on a forgeable field is the forgery with
// one extra step.
//
// A request with no stamp — sent before the server started stamping, or whose trigger has not
// run yet — shows the sender's CURRENT profile name if the caller has it, no email at all, and
// `unconfirmed: true`, which the screen turns into a warning.

export interface ShownSender {
  /** Self-chosen, like every name. Null when nothing trustworthy is known. */
  name: string | null;
  /** From the sender's Firebase Auth record, via the server. Never from the request. */
  email: string | null;
  /** Whether that email was verified — an unverified one is just an address someone typed. */
  verified: boolean;
  /** No server stamp: the screen must say it could not confirm who sent this. */
  unconfirmed: boolean;
}

const clean = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export function shownSender(request: unknown, profileName?: unknown): ShownSender {
  const stamp = (request as { sender?: unknown } | null)?.sender as
    | { name?: unknown; email?: unknown; emailVerified?: unknown }
    | undefined;

  if (stamp && typeof stamp === 'object' && clean(stamp.name, 40)) {
    const email = clean(stamp.email, 254);
    return {
      name: clean(stamp.name, 40),
      email,
      verified: stamp.emailVerified === true && email !== null,
      unconfirmed: false,
    };
  }

  return { name: clean(profileName, 40), email: null, verified: false, unconfirmed: true };
}

/** The group's real name as the server read it, or null — never the sender's `groupName`. */
export function shownGroupName(request: unknown): string | null {
  return clean((request as { verifiedGroupName?: unknown } | null)?.verifiedGroupName, 60);
}
