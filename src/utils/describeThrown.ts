// src/utils/describeThrown.ts
//
// What a thrown value says about itself, for the error log. Pure.
//
// JavaScript lets anything be thrown — a string, an object, null — and the error boundary,
// window.onerror and unhandledrejection all receive whatever it was. The boundary reported
// `error.message || 'Render error'`, which is right for an Error and loses everything else: on
// 20.09.2026 three crashes on /wallet were logged as "Render error" with an EMPTY stack (only the
// component stack after it), so the one fact that would have named the bug was the one dropped. And
// every crash of that kind lands in ONE group, where different bugs merge and hide behind a count.
//
// An Error with a message is described exactly as before — its own message and stack — so every
// group already in the panel keeps its fingerprint. Only what used to be lost changes.

export interface Described {
  message: string;
  stack: string | null;
  /** What was thrown: an Error's name, or the JavaScript type. */
  kind: string;
}

const MAX = 500;

function excerpt(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    if (typeof s === 'string' && s !== '{}') return s.slice(0, 300);
  } catch { /* circular, BigInt, a getter that throws */ }
  return Object.prototype.toString.call(v);
}

export function describeThrown(value: unknown): Described {
  if (value instanceof Error) {
    const name = value.name || 'Error';
    return {
      message: value.message ? value.message.slice(0, MAX) : `${name} with no message`,
      stack: value.stack || null,
      kind: name,
    };
  }
  if (typeof value === 'string') {
    // Returned as it is: an unhandled rejection with a string reason was already logged as the
    // string (`String(reason)`), and its group must keep its fingerprint.
    return { message: value.trim() ? value.slice(0, MAX) : 'Thrown an empty string', stack: null, kind: 'string' };
  }
  if (value === null || value === undefined) {
    return { message: `Thrown ${String(value)}`, stack: null, kind: String(value) };
  }
  if (typeof value === 'object' || typeof value === 'function') {
    const o = value as { then?: unknown; message?: unknown; name?: unknown; code?: unknown; stack?: unknown };
    if (typeof o.then === 'function') {
      return { message: 'Thrown a Promise (a component suspended with no Suspense boundary above it?)', stack: null, kind: 'Promise' };
    }
    // Error-like but not an Error: another realm's Error, or a library's own exception object.
    const name = typeof o.name === 'string' && o.name ? o.name : (value.constructor?.name || typeof value);
    if (typeof o.message === 'string' && o.message) {
      return {
        message: `${name}: ${o.message}`.slice(0, MAX),
        stack: typeof o.stack === 'string' ? o.stack : null,
        kind: name,
      };
    }
    const code = typeof o.code === 'string' || typeof o.code === 'number' ? ` (code ${o.code})` : '';
    return { message: `Thrown ${name}${code}: ${excerpt(value)}`.slice(0, MAX), stack: null, kind: name };
  }
  // number, boolean, bigint, symbol
  return { message: `Thrown ${typeof value}: ${String(value)}`.slice(0, MAX), stack: null, kind: typeof value };
}
