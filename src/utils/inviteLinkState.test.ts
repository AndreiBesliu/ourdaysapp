// src/utils/inviteLinkState.test.ts
// The invite link's one decision, tested directly.
//
// It lives in `functions/src/` because both callables run there, and it is imported across that
// boundary rather than duplicated — the same reasoning as `warlordServerCopy.test.ts`, which
// exists precisely because two copies of one thing drift. This module is pure (no firebase-admin,
// no clock of its own), so importing it here costs nothing.
//
// ── What these tests are really pinning ───────────────────────────────────────────────
//
// ORDER. `peek` and `redeem` each decided this for themselves and reached different answers the
// moment a link became good for one registration: both asked "is it spent?" before "have YOU
// already used it?", so the person who had just joined, reopening their own link out of a chat
// thread, was told the invitation had been used up — by their own redemption.

import { describe, it, expect } from 'vitest';
import { linkVerdict, verdictAdmits, type LinkDoc } from '../../functions/src/inviteLinkState';

const NOW = 1_800_000_000_000;
const ALICE = 'uid-alice';
const BOB = 'uid-bob';

const ts = (ms: number) => ({ toMillis: () => ms });

/** A fresh, single-use link created by Alice. */
const fresh = (over: Partial<LinkDoc> = {}): LinkDoc => ({
  createdBy: ALICE,
  expiresAt: ts(NOW + 86_400_000),
  maxUses: 1,
  uses: 0,
  redeemedBy: [],
  revoked: false,
  ...over,
});

describe('the ordinary cases', () => {
  it('a stranger may use a fresh link', () => {
    expect(linkVerdict(fresh(), BOB, NOW)).toBe('ok');
  });

  it('a signed-out visitor sees a usable link, so the join screen can describe it', () => {
    expect(linkVerdict(fresh(), null, NOW)).toBe('ok');
  });

  it('the creator cannot use their own', () => {
    expect(linkVerdict(fresh(), ALICE, NOW)).toBe('own');
  });
});

describe('the ordering that this function exists for', () => {
  const spentByBob = fresh({ uses: 1, redeemedBy: [BOB] });

  it("Bob reopening the link HE used is told he is already in, not that it is spent", () => {
    // The whole defect, in one assertion. At five uses it hid behind the slack; at one use it is
    // the common case, because links sit in chat threads and people tap them twice.
    expect(linkVerdict(spentByBob, BOB, NOW)).toBe('already');
  });

  it('while somebody else is correctly told it is spent', () => {
    expect(linkVerdict(spentByBob, 'uid-carol', NOW)).toBe('spent');
  });

  it('"already" also beats revoked and expired', () => {
    // Somebody who is already in should not be told a link they no longer need has problems.
    expect(linkVerdict({ ...spentByBob, revoked: true }, BOB, NOW)).toBe('already');
    expect(linkVerdict({ ...spentByBob, expiresAt: ts(NOW - 1) }, BOB, NOW)).toBe('already');
  });

  it('a signed-out visitor can never be "already" or "own"', () => {
    // Nobody without an account has redeemed anything, and `includes(null)` must not be consulted.
    expect(linkVerdict(spentByBob, null, NOW)).toBe('spent');
    expect(linkVerdict(fresh(), null, NOW)).toBe('ok');
  });
});

describe('the refusals', () => {
  it('withdrawn', () => {
    expect(linkVerdict(fresh({ revoked: true }), BOB, NOW)).toBe('revoked');
  });

  it('expired, on the exact millisecond boundary', () => {
    expect(linkVerdict(fresh({ expiresAt: ts(NOW - 1) }), BOB, NOW)).toBe('expired');
    // Not yet expired AT the deadline — a link that dies a millisecond early is a support ticket.
    expect(linkVerdict(fresh({ expiresAt: ts(NOW) }), BOB, NOW)).toBe('ok');
  });

  it('spent, at exactly the limit', () => {
    expect(linkVerdict(fresh({ uses: 1, maxUses: 1 }), BOB, NOW)).toBe('spent');
    expect(linkVerdict(fresh({ uses: 0, maxUses: 1 }), BOB, NOW)).toBe('ok');
  });

  it('an older link issued with a bigger allowance keeps the allowance it was issued with', () => {
    // The safe direction for a credential already sent to somebody: honour what was promised
    // rather than silently cutting it short when the policy changes.
    expect(linkVerdict(fresh({ uses: 2, maxUses: 5 }), BOB, NOW)).toBe('ok');
  });

  it('withdrawn beats expired, so the message names the deliberate act', () => {
    expect(linkVerdict(fresh({ revoked: true, expiresAt: ts(NOW - 1) }), BOB, NOW)).toBe('revoked');
  });
});

describe('malformed documents refuse rather than throw', () => {
  it('no creator', () => {
    expect(linkVerdict({}, BOB, NOW)).toBe('malformed');
    expect(linkVerdict({ createdBy: '' }, BOB, NOW)).toBe('malformed');
    expect(linkVerdict({ createdBy: 42 as unknown }, BOB, NOW)).toBe('malformed');
  });

  it('missing counters are treated as spent, not as unlimited', () => {
    // `uses >= maxUses` with both absent is 0 >= 0 — refused. A document with no limit must not
    // read as a limitless one.
    expect(linkVerdict({ createdBy: ALICE }, BOB, NOW)).toBe('spent');
  });

  it('a missing expiry does not expire', () => {
    expect(linkVerdict({ createdBy: ALICE, maxUses: 1, uses: 0 }, BOB, NOW)).toBe('ok');
    expect(linkVerdict({ createdBy: ALICE, maxUses: 1, uses: 0, expiresAt: null }, BOB, NOW)).toBe('ok');
  });

  it('a non-array redeemedBy does not crash the lookup', () => {
    expect(linkVerdict(fresh({ redeemedBy: 'nope' as unknown }), BOB, NOW)).toBe('ok');
  });
});

describe('verdictAdmits', () => {
  it('lets through exactly the two that mean "you are in"', () => {
    expect(verdictAdmits('ok')).toBe(true);
    expect(verdictAdmits('already')).toBe(true);
    for (const v of ['revoked', 'expired', 'spent', 'own', 'malformed'] as const) {
      expect(verdictAdmits(v)).toBe(false);
    }
  });
});
