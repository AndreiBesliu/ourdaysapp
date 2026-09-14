// src/utils/errorFixes.test.ts
//
// A claim that is never checked is not a claim. These tests are mostly about the direction the
// check fails in: when anything is unclear, it must say the fix did NOT work, because the opposite
// hands somebody a Resolved button on the strength of a guess — which is the situation this whole
// mechanism exists to remove.

import { describe, it, expect } from 'vitest';
import {
  ERROR_FIXES, fixFor, fixVerdict, type ErrorFix,
} from '../../functions/src/errorFixes';
import { fingerprint } from '../../functions/src/errorGrouping';

const claim = (over: Partial<ErrorFix> = {}): ErrorFix => ({
  fingerprint: 'errorboundary::boom',
  kind: 'fixed',
  since: '2026-09-01T10:00:00.000Z',
  commit: 'abc1234',
  what: 'it was wrong',
  verify: 'it is not wrong now',
  ...over,
});

describe('finding the claim for a group', () => {
  it('matches on the exact fingerprint', () => {
    const fixes = [claim()];
    expect(fixFor('errorboundary::boom', fixes)).toBe(fixes[0]);
  });

  it('does not match a group nobody has claimed', () => {
    expect(fixFor('errorboundary::something else', [claim()])).toBeNull();
  });

  it('never matches loosely', () => {
    // A near-match would attach a fix claim to a different problem, which is the worst outcome
    // available here: the real one gets a Resolved button it did not earn.
    expect(fixFor('errorboundary::boom!', [claim()])).toBeNull();
    expect(fixFor('ERRORBOUNDARY::BOOM', [claim()])).toBeNull();
    expect(fixFor('boom', [claim()])).toBeNull();
  });

  it('survives junk', () => {
    for (const junk of ['', null, undefined, 42, {}]) {
      expect(fixFor(junk as unknown, [claim()])).toBeNull();
    }
  });
});

describe('whether a claim still stands', () => {
  it('holds while nothing has happened since the fix shipped', () => {
    expect(fixVerdict(claim(), '2026-08-30T10:00:00.000Z')).toBe('holding');
  });

  it('FAILS when the error happened after the fix shipped', () => {
    // The whole point. The fix did not work, and nobody had to notice.
    expect(fixVerdict(claim(), '2026-09-02T10:00:00.000Z')).toBe('failed');
  });

  it('says unclaimed when nobody has claimed anything', () => {
    expect(fixVerdict(null, '2026-09-02T10:00:00.000Z')).toBe('unclaimed');
    expect(fixVerdict(undefined, '2026-09-02T10:00:00.000Z')).toBe('unclaimed');
  });

  it('treats an unreadable `since` as failed, not as holding', () => {
    // A claim nobody can check is not a claim. Failing towards "look at this" is the only safe
    // direction; the other hands out a Resolved button on the strength of a typo.
    expect(fixVerdict(claim({ since: 'last tuesday' }), '2026-09-02T10:00:00.000Z')).toBe('failed');
    expect(fixVerdict(claim({ since: '' }), '2026-09-02T10:00:00.000Z')).toBe('failed');
  });

  it('holds when the group has no readable last occurrence', () => {
    // Nothing to refute it with. Distinct from the case above: there the CLAIM is broken, here the
    // evidence is simply absent.
    expect(fixVerdict(claim(), null)).toBe('holding');
    expect(fixVerdict(claim(), 'soon')).toBe('holding');
  });

  it('is not tripped by an occurrence at exactly the same instant', () => {
    expect(fixVerdict(claim({ since: '2026-09-01T10:00:00.000Z' }), '2026-09-01T10:00:00.000Z'))
      .toBe('holding');
  });
});

describe('the claims actually shipped in this repo', () => {
  it('every fingerprint is one the grouper could really produce', () => {
    // A claim keyed to a string no group will ever have is dead on arrival, and looks like a
    // working feature. This catches the typo that would otherwise be invisible.
    for (const f of ERROR_FIXES) {
      expect(f.fingerprint, `${f.commit || f.kind}: fingerprint must be lower-case`)
        .toBe(f.fingerprint.toLowerCase());
      expect(f.fingerprint.length, 'fingerprint must not be empty').toBeGreaterThan(0);
    }
  });

  it('the React #310 claim matches the real message, digit and all', () => {
    // Round-trip through the grouper: this is the claim most likely to rot, because the fingerprint
    // keeps "#310" and an earlier version of the normaliser stripped it.
    const real = fingerprint(
      'Minified React error #310; visit https://react.dev/errors/310 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.',
      'ErrorBoundary',
    );
    expect(fixFor(real)).not.toBeNull();
    expect(fixFor(real)!.commit).toBe('23931ef');
  });

  it('does NOT claim a different React error', () => {
    // #185 is a fault this app has actually had. A claim for #310 must never cover it.
    const other = fingerprint(
      'Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.',
      'ErrorBoundary',
    );
    expect(fixFor(other)).toBeNull();
  });

  it('no claim is longer than a fingerprint can be', () => {
    // `fingerprint()` caps the message at 200 characters. I wrote one out in full, so the claim was
    // 17 characters longer than anything the grouper can ever produce — a claim that silently
    // matches nothing, which looks exactly like a working feature.
    const messageOf = (fp: string) => {
      const i = fp.indexOf('::');
      return i >= 0 ? fp.slice(i + 2) : fp;
    };
    for (const f of ERROR_FIXES) {
      expect(messageOf(f.fingerprint).length, `too long to ever match: ${f.commit || f.kind}`)
        .toBeLessThanOrEqual(200);
    }
  });

  it('the quota claim round-trips through the real grouper', () => {
    // The one that caught the truncation bug. Built from the message as it actually arrives.
    const real = fingerprint(
      '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
      'ai:suggestAsset',
    );
    expect(fixFor(real)?.commit).toBe('9ed89a8');
  });

  it('the stale-chunk claim round-trips too', () => {
    const real = fingerprint(
      'Failed to fetch dynamically imported module: https://our-days-2a939.web.app/assets/Admin-A1M6gDLC.js',
      'ErrorBoundary',
    );
    expect(fixFor(real)?.commit).toBe('9ed89a8');
  });

  it('every claim carries a commit, or is explicitly a judgement', () => {
    for (const f of ERROR_FIXES) {
      if (f.kind === 'fixed') expect(f.commit, `${f.fingerprint.slice(0, 40)} must name a commit`).toBeTruthy();
      expect(Number.isNaN(Date.parse(f.since)), `${f.fingerprint.slice(0, 40)} needs a readable since`).toBe(false);
      expect(f.what.length).toBeGreaterThan(20);
      expect(f.verify.length).toBeGreaterThan(20);
    }
  });

  it('claims one fingerprint at most once', () => {
    const keys = ERROR_FIXES.map((f) => f.fingerprint);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
