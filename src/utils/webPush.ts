// src/utils/webPush.ts
// Is this key capable of registering for web push at all?
//
// ── What went wrong ──────────────────────────────────────────────────────────────────
//
// Push notification registration had been failing on every browser, for every account, since May.
// Nobody knew, because it failed the quietest way available: a hard-coded VAPID key that is simply
// the wrong length. `PushManager.subscribe` rejects, `getToken` rejects, the `updateDoc` that stores
// the token never runs, and the catch wrote to `console.error` rather than to the error log. So
// `users/{uid}.fcmTokens` was never written on a single one of the eight accounts, and every send
// skipped every recipient for want of a token.
//
// What makes it worth a file of its own is that nothing else could have caught it. It typechecks —
// it is a string. It has no effect on tests. The browser asks "Allow notifications?" and the person
// clicks Allow, so even the user's own feedback says it worked. The only evidence was a field that
// was absent from the database, which is why it took a census of live data to find.
//
// ── The shape ────────────────────────────────────────────────────────────────────────
//
// A Web Push applicationServerKey is an uncompressed P-256 public point: a 0x04 marker byte plus
// two 32-byte coordinates, so 65 bytes, which is 87 base64url characters. The key that shipped was
// 44 characters — 33 bytes — and read like a placeholder somebody typed. The Firebase SDK does not
// check: it passes the bytes straight to the browser, which rejects them.
//
// So this checks, and it returns a SENTENCE rather than a boolean, because the sentence is what
// gets reported when it fails. "Push registration is off" is not actionable; "the key is 44
// characters, it must be 87" is.

/** Bytes in an uncompressed P-256 point: one marker + two 32-byte coordinates. */
const VAPID_BYTES = 65;

/** The marker byte that says "uncompressed point". */
const UNCOMPRESSED_POINT = 0x04;

/**
 * Why this key cannot be used, or null when it can.
 *
 * Deliberately not a boolean: the reason travels into the error report, and a reason is the
 * difference between somebody fixing this in a minute and somebody rediscovering it in four months.
 */
export function vapidKeyProblem(key: unknown): string | null {
  if (typeof key !== 'string' || key.trim() === '') {
    return 'no VAPID key is configured (VITE_FIREBASE_VAPID_KEY)';
  }
  const k = key.trim();

  let decoded: string;
  try {
    // base64url → base64, then decode. Decoding rather than trusting the length: padding and
    // stray characters both change the count.
    const b64 = k.replace(/-/g, '+').replace(/_/g, '/');
    decoded = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  } catch {
    return `the VAPID key is not valid base64url (${k.length} characters)`;
  }

  if (decoded.length !== VAPID_BYTES) {
    return `the VAPID key decodes to ${decoded.length} bytes; a Web Push application server key `
      + `must be ${VAPID_BYTES} (${k.length} characters given, 87 expected)`;
  }
  // The marker byte, checked because this file's own test found that 87 arbitrary characters pass
  // the length test while being nothing like a public key. An uncompressed point starts with 0x04.
  if (decoded.charCodeAt(0) !== UNCOMPRESSED_POINT) {
    return `the VAPID key is the right length but does not start with 0x04, so it is not an `
      + `uncompressed P-256 point`;
  }
  return null;
}

/**
 * The key this build should use, or null when there is not a usable one.
 *
 * Returning null is the point: the previous code called `getToken` with a value that could never
 * work, so the failure looked like a browser problem rather than a configuration one.
 */
export function vapidKey(env: Record<string, unknown> | undefined): string | null {
  const raw = env?.VITE_FIREBASE_VAPID_KEY;
  return vapidKeyProblem(raw) === null ? String(raw).trim() : null;
}
