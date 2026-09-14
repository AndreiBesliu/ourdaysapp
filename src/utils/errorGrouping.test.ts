// src/utils/errorGrouping.test.ts
//
// Grouping has two failure modes and only one of them is visible.
//
// Failing to merge is obvious: you still see a long list. Merging too much is invisible and worse —
// two different bugs sit behind one count that looks like it has been explained, and the second one
// is never investigated. So roughly half of these tests exist to prove that things stay APART.

import { describe, it, expect } from 'vitest';
import { fingerprint, groupErrors, type RawError } from '../../functions/src/errorGrouping';

const row = (over: Partial<RawError>): RawError => ({
  id: 'x', message: 'boom', context: 'window.onerror', uid: 'u1',
  createdAt: '2026-09-01T10:00:00.000Z', ...over,
});

describe('what counts as the same problem', () => {
  it('merges across the build hash in an asset name', () => {
    // Otherwise one problem becomes one group per deploy, and every release looks like a new bug.
    expect(fingerprint('Failed to fetch dynamically imported module: /assets/index-C-pdtDA2.js'))
      .toBe(fingerprint('Failed to fetch dynamically imported module: /assets/index-Bq7x91Zk.js'));
  });

  it('merges across a URL', () => {
    expect(fingerprint('Failed to fetch https://our-days-2a939.web.app/assets/a.js'))
      .toBe(fingerprint('Failed to fetch https://our-days-2a939.web.app/assets/b.js'));
  });

  it('merges across ids and line numbers', () => {
    expect(fingerprint('Missing doc groups/8f3a91bc44de at line 214'))
      .toBe(fingerprint('Missing doc groups/0c11dd77aa20 at line 87'));
  });

  it('merges across whitespace and case', () => {
    expect(fingerprint('Cannot read  properties of NULL')).toBe(fingerprint('cannot read properties of null'));
  });
});

describe('what must NOT be merged — the invisible failure', () => {
  it('different wording stays different', () => {
    expect(fingerprint("Cannot read properties of null (reading 'time')"))
      .not.toBe(fingerprint("Cannot read properties of null (reading 'title')"));
  });

  it('the same message from a different place stays different', () => {
    // A render boundary catching it and an unhandled rejection are two different situations, even
    // when the sentence is identical.
    expect(fingerprint('boom', 'ErrorBoundary')).not.toBe(fingerprint('boom', 'unhandledrejection'));
  });

  it('ordinary short words are not eaten as ids', () => {
    // The id rules are anchored on length precisely so that this keeps working.
    expect(fingerprint('deadbeef is fine')).toBe(fingerprint('deadbeef is fine'));
    expect(fingerprint('quota exceeded')).not.toBe(fingerprint('quota exhausted'));
  });

  it('two React errors with different numbers are two problems', () => {
    // Digits are normalised away as line numbers and sizes — but a number after "#" is an IDENTITY.
    // #310 (hook order) and #185 (the Zustand snapshot loop this app has actually had) collapsed
    // into one group, so the second would have hidden behind the first's count, and a claim to have
    // fixed one would silently have covered the other.
    const react = (n: number) => fingerprint(
      `Minified React error #${n}; visit https://react.dev/errors/${n} for the full message.`,
      'ErrorBoundary');
    expect(react(310)).not.toBe(react(185));
    expect(react(310)).toBe(react(310));
  });

  it('but ordinary numbers are still normalised', () => {
    expect(fingerprint('failed at line 214')).toBe(fingerprint('failed at line 87'));
    expect(fingerprint('read 4096 bytes')).toBe(fingerprint('read 17 bytes'));
  });

  it('two different failures that both mention a URL stay apart', () => {
    expect(fingerprint('Failed to fetch https://a/x.js'))
      .not.toBe(fingerprint('Network request failed https://a/x.js'));
  });
});

describe('grouping a batch', () => {
  it('counts occurrences and distinct people separately', () => {
    // One person hitting something forty times and forty people hitting it once are different
    // problems, and a single count cannot tell them apart.
    const [g] = groupErrors([
      row({ uid: 'u1' }), row({ uid: 'u1' }), row({ uid: 'u2' }),
    ]);
    expect(g.count).toBe(3);
    expect(g.users).toBe(2);
  });

  it('orders by how often, then by how recent', () => {
    const groups = groupErrors([
      row({ message: 'rare', createdAt: '2026-09-10T10:00:00.000Z' }),
      row({ message: 'common' }), row({ message: 'common' }),
    ]);
    expect(groups.map((g) => g.sample)).toEqual(['common', 'rare']);
  });

  it('breaks a tie towards the one still happening', () => {
    const groups = groupErrors([
      row({ message: 'old', createdAt: '2026-08-01T10:00:00.000Z' }),
      row({ message: 'live', createdAt: '2026-09-13T10:00:00.000Z' }),
    ]);
    expect(groups[0].sample).toBe('live');
  });

  it('reports when it started and when it was last seen', () => {
    const [g] = groupErrors([
      row({ createdAt: '2026-09-05T10:00:00.000Z' }),
      row({ createdAt: '2026-08-20T10:00:00.000Z' }),
      row({ createdAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(g.firstSeen).toBe('2026-08-20T10:00:00.000Z');
    expect(g.lastSeen).toBe('2026-09-05T10:00:00.000Z');
  });

  it('keeps the NEWEST stack, not the first one it happened to see', () => {
    // An old stack points at code that may no longer exist, which sends you reading the wrong file.
    const [g] = groupErrors([
      row({ stack: 'old stack', createdAt: '2026-08-01T10:00:00.000Z' }),
      row({ stack: 'new stack', createdAt: '2026-09-10T10:00:00.000Z' }),
    ]);
    expect(g.sampleStack).toBe('new stack');
  });

  it('shows a real message, never the normalised key', () => {
    // The key has <id> and <n> in it. Nobody can read that.
    const [g] = groupErrors([row({ message: 'Missing doc groups/8f3a91bc44de' })]);
    expect(g.sample).toBe('Missing doc groups/8f3a91bc44de');
    expect(g.sample).not.toContain('<id>');
  });

  it('collects the distinct pages it happens on, capped', () => {
    const groups = groupErrors([
      row({ url: '/' }), row({ url: '/' }), row({ url: '/wallet' }), row({ url: '/log' }),
    ]);
    expect(groups[0].urls.sort()).toEqual(['/', '/log', '/wallet']);
    expect(groupErrors(
      ['/a', '/b', '/c', '/d', '/e'].map((u) => row({ url: u })), 2,
    )[0].urls).toHaveLength(2);
  });

  it('survives rows with nothing useful in them', () => {
    // These come off the wire; a reporter that never throws can still write a row with holes.
    expect(() => groupErrors([
      {}, { message: '' }, { message: 'ok', createdAt: 'not a date' },
    ] as RawError[])).not.toThrow();
    expect(groupErrors([{}, { message: '' }, { message: 'ok' }] as RawError[])).toHaveLength(1);
  });

  it('an empty log produces no groups rather than one empty group', () => {
    expect(groupErrors([])).toEqual([]);
  });
});
