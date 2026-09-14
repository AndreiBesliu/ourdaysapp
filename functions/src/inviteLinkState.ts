// functions/src/inviteLinkState.ts
// One answer to "can this person use this link", used by BOTH callables.
//
// ── Why it is its own function ────────────────────────────────────────────────────────
//
// `peek` and `redeem` each decided this for themselves, and they drifted the moment a link became
// good for a single registration: both asked "is it spent?" before "have YOU already used it?",
// so the person who had just joined, reopening their own link out of a chat thread, was told the
// invitation was used up — by their own redemption. Two implementations of one decision, with
// nothing making them agree. That is the same shape as the two `baseEventData` literals and the
// theme's two sources of truth, and it gets the same treatment: compute it once.
//
// Pure — no firebase-admin, no clock of its own — so it can be tested directly.

export type LinkVerdict =
  /** Usable. */
  | 'ok'
  /** The caller has already redeemed this exact link. Not an error; they are already in. */
  | 'already'
  /** Withdrawn by its creator. */
  | 'revoked'
  | 'expired'
  /** Somebody else got there first. */
  | 'spent'
  /** The caller created it. */
  | 'own'
  /** Missing `createdBy`, or otherwise not a link. */
  | 'malformed';

export interface LinkDoc {
  createdBy?: unknown;
  expiresAt?: { toMillis?: () => number } | null;
  maxUses?: unknown;
  uses?: unknown;
  redeemedBy?: unknown;
  revoked?: unknown;
}

/**
 * @param callerUid the signed-in caller, or null when nobody is signed in — which `peek` serves,
 *   and which can never be 'already' or 'own': somebody with no account has redeemed nothing.
 */
export function linkVerdict(d: LinkDoc, callerUid: string | null, now: number): LinkVerdict {
  const inviter = typeof d.createdBy === 'string' && d.createdBy ? d.createdBy : null;
  if (!inviter) return 'malformed';

  // Asked FIRST, and the order is the whole point of this function. A link is good for one
  // registration, so whoever redeemed it IS the use; every later check would find it spent.
  if (callerUid && Array.isArray(d.redeemedBy) && d.redeemedBy.includes(callerUid)) return 'already';

  if (callerUid && inviter === callerUid) return 'own';
  if (d.revoked === true) return 'revoked';

  const expiresAt = d.expiresAt?.toMillis?.();
  if (typeof expiresAt === 'number' && expiresAt < now) return 'expired';

  const uses = typeof d.uses === 'number' ? d.uses : 0;
  const maxUses = typeof d.maxUses === 'number' ? d.maxUses : 0;
  if (uses >= maxUses) return 'spent';

  return 'ok';
}

/** Does this verdict let somebody through? `already` does: they are in, just not again. */
export function verdictAdmits(v: LinkVerdict): boolean {
  return v === 'ok' || v === 'already';
}
