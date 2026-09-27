// src/components/ErrorBoundary.test.ts
//
// What the boundary REPORTS when the tree below it crashes. On 20.09.2026 three crashes on /wallet
// reached the error panel as "Render error" with only a component stack: the value thrown was not
// an Error, and `error.message || 'Render error'` dropped it. This runs the real class (no DOM in
// this suite) with the reporter replaced by a spy.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportError = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { default: ErrorBoundary } = await import('./ErrorBoundary');

const INFO = { componentStack: '\n    at nF (https://example.test/assets/index-x.js:136:84976)' };

function crash(thrown: unknown) {
  const b = new ErrorBoundary({ children: null });
  b.setState = vi.fn() as never;
  b.componentDidCatch(thrown, INFO as never);
  expect(reportError).toHaveBeenCalledTimes(1);
  return reportError.mock.calls[0] as [string, { stack: string; context: string }];
}

beforeEach(() => { reportError.mockReset(); });

describe('ErrorBoundary.componentDidCatch', () => {
  it('a thrown string is reported as itself, not as "Render error"', () => {
    const [message, opts] = crash('Cannot read the card');
    expect(message).toBe('Cannot read the card');
    expect(opts.context).toBe('ErrorBoundary');
    expect(opts.stack).toContain('at nF');
  });

  it('a thrown object is reported with what it carries', () => {
    const [message] = crash({ code: 'invalid-argument' });
    expect(message).toMatch(/invalid-argument/);
    expect(message).not.toBe('Render error');
  });

  it('an Error is reported exactly as before: its message, its stack, then the component stack', () => {
    const e = new Error('Minified React error #310');
    const [message, opts] = crash(e);
    expect(message).toBe('Minified React error #310');
    expect(opts.stack.startsWith(e.stack!)).toBe(true);
    expect(opts.stack).toContain('at nF');
  });

  it('a stale chunk is still told apart from a crash', () => {
    const [, opts] = crash(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Admin-1.js'));
    expect(opts.context).toBe('StaleChunk');
    expect(ErrorBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module: y')))
      .toEqual({ hasError: true, staleChunk: true });
    expect(ErrorBoundary.getDerivedStateFromError('not a chunk')).toEqual({ hasError: true, staleChunk: false });
  });
});
