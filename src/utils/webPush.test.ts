// src/utils/webPush.test.ts
//
// The key that shipped was 44 characters and looked plausible. It typechecked, it broke no test,
// and the browser still asked the user for permission — so every signal anybody looked at said the
// feature worked, while `fcmTokens` was never written on a single account for four months.
//
// The first test here is that exact string.

import { describe, it, expect } from 'vitest';
import { vapidKey, vapidKeyProblem } from './webPush';

/** The literal that was hard-coded in CalendarHome.tsx from May until 2026-09-14. */
const SHIPPED = 'BIsH5f-u0rS2wZ3jL-yqF9qS-nFf_vB1a_zZ_8j-xZ_8';

/** 65 bytes: 0x04 and two 32-byte coordinates, base64url, as a real key is. */
const VALID = (() => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  for (let i = 1; i < 65; i++) bytes[i] = (i * 7) % 251;
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();

describe('the key that was actually shipped', () => {
  it('is rejected', () => {
    expect(vapidKeyProblem(SHIPPED)).not.toBeNull();
  });

  it('is rejected for the right reason, in words somebody can act on', () => {
    // "Push is off" would have been useless. The byte count names the problem.
    const why = vapidKeyProblem(SHIPPED)!;
    expect(why).toContain('33 bytes');
    expect(why).toContain('65');
  });
});

describe('a real key', () => {
  it('is 65 bytes and passes', () => {
    expect(VALID).toHaveLength(87);
    expect(vapidKeyProblem(VALID)).toBeNull();
  });

  it('survives surrounding whitespace, which a copied key usually has', () => {
    expect(vapidKeyProblem(`  ${VALID}\n`)).toBeNull();
    expect(vapidKey({ VITE_FIREBASE_VAPID_KEY: ` ${VALID} ` })).toBe(VALID);
  });
});

describe('the absent case, which is the normal one until somebody configures it', () => {
  it('says so plainly and names the variable', () => {
    for (const nothing of [undefined, null, '', '   ']) {
      const why = vapidKeyProblem(nothing);
      expect(why).toContain('VITE_FIREBASE_VAPID_KEY');
    }
  });

  it('vapidKey returns null rather than something unusable', () => {
    // The whole defect was calling getToken with a value that could never work, so the failure
    // read as a browser problem instead of a configuration one.
    expect(vapidKey(undefined)).toBeNull();
    expect(vapidKey({})).toBeNull();
    expect(vapidKey({ VITE_FIREBASE_VAPID_KEY: SHIPPED })).toBeNull();
  });
});

describe('what it must not accept', () => {
  it('rejects keys of the wrong length even when they decode cleanly', () => {
    expect(vapidKeyProblem('BBBB')).not.toBeNull();
    expect(vapidKeyProblem('A'.repeat(87))).not.toBeNull();
  });

  it('rejects non-strings without throwing', () => {
    for (const junk of [42, {}, [], true]) {
      expect(() => vapidKeyProblem(junk as unknown)).not.toThrow();
      expect(vapidKeyProblem(junk as unknown)).not.toBeNull();
    }
  });
});
