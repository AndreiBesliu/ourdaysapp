// src/utils/pendingWrite.ts
//
// How long a screen may wait for the server to confirm a write (03.10.2026). Pure.
//
// A Firestore write resolves only on the SERVER's acknowledgement. Offline it is applied to the local
// cache at once and its promise stays pending until the network returns, which can be never (measured
// with the real SDK, DEVLOG 03.10: the card is in the list after 46 ms, the promise still pending). So
// `await setDoc(...)` behind a Save button is a spinner that cannot end. The write itself is fine: it
// is queued, it survives a reload, and it is sent on the next start with a connection.
//
// So a screen waits for the answer for a bounded time only, and then lets go and says "not sent yet".
// The one connectivity signal that can be trusted is `navigator.onLine === false` (airplane mode):
// then there is no point waiting at all. `true` proves nothing (a phone with one bar and no data is
// "online"), so it never makes a wait longer.

/** A save: long enough for an ordinary online round trip, short enough not to feel stuck. */
export const SAVE_WAIT_MS = 3_000;
/** Before handing a card over: the hand-over must not start until the edit is on the server. */
export const TRANSFER_WAIT_MS = 10_000;

/** The wait for one write. `onLine` is `navigator.onLine`; only `false` is believed. */
export function waitBound(onLine: boolean | undefined, kind: 'save' | 'transfer'): number {
  if (onLine === false) return 0;
  return kind === 'transfer' ? TRANSFER_WAIT_MS : SAVE_WAIT_MS;
}

export type Settled<T> =
  | { kind: 'acked'; value: T }
  | { kind: 'refused'; error: unknown }
  | { kind: 'noAnswer' };

/**
 * The write's answer if it comes within `ms`, else `noAnswer`. The write is never abandoned: a later
 * answer still settles the promise, and a later rejection is caught here so it can never surface as
 * an unhandled rejection (the caller attaches its own handlers for what happens after).
 *
 * A promise that has ALREADY settled wins even at `ms = 0`: its reaction runs as a microtask, before
 * the timer. That is what keeps a synchronous validation error (an undefined field) in the open form.
 */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ kind: 'noAnswer' });
    }, Math.max(0, ms));
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ kind: 'acked', value });
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ kind: 'refused', error });
      },
    );
  });
}

/**
 * A failed hand-over (the `transferAssetCopy` callable): did the server say no, or is the outcome
 * unknown? Only a code the server sends when it REFUSES counts as a refusal. `internal` is what the
 * SDK reports when the request never got an answer (measured: no server, ~2 s), and
 * `deadline-exceeded` / `unavailable` mean the same: it may have happened.
 */
const DEFINITE_REFUSALS = new Set([
  'permission-denied', 'not-found', 'invalid-argument', 'unauthenticated', 'failed-precondition',
  'already-exists', 'out-of-range', 'resource-exhausted',
]);

export function handOverFailure(code: unknown): 'refused' | 'unconfirmed' {
  const bare = typeof code === 'string' ? code.replace(/^functions\//, '') : '';
  return DEFINITE_REFUSALS.has(bare) ? 'refused' : 'unconfirmed';
}
