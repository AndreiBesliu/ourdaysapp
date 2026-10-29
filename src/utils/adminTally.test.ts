// src/utils/adminTally.test.ts
//
// The Admin statistics count with these (functions/src/adminTally.ts); they read values any member can
// write, and the old ones broke on those that were not of the app's kind (10.10.2026).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { clip, countOf, inc, memberText, timeMs, wireKey, withRest } from '../../functions/src/adminTally';

// The callable's REAL server-side encoder.
const require = createRequire(import.meta.url);
const { encode } = require('../../functions/node_modules/firebase-functions/lib/common/providers/https.js') as { encode: (v: unknown) => unknown };

/** What the client's decode does to a map, step for step (@firebase/functions, `mapValues` + `decode`). */
function clientDecode(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(clientDecode);
  if (json && typeof json === 'object') {
    if ((json as Record<string, unknown>)['@type']) throw new Error('Data cannot be decoded from JSON');
    const out: Record<string, unknown> = {};
    for (const key in json as Record<string, unknown>) {
      if ((json as { hasOwnProperty: (k: string) => boolean }).hasOwnProperty(key)) out[key] = clientDecode((json as Record<string, unknown>)[key]);
    }
    return out;
  }
  return json;
}
const overTheWire = (v: unknown) => clientDecode(JSON.parse(JSON.stringify(encode(v))));

const POISON = { toString: 0 };
const AWKWARD = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', '@type', '@value'];

describe('inc', () => {
  it('counts text keys, and a value that is not text under the fallback', () => {
    const o: Record<string, number> = {};
    inc(o, 'chores'); inc(o, 'chores', 'other'); inc(o, { a: 1 }, 'other'); inc(o, 7, 'other'); inc(o, '', 'other');
    expect(o).toEqual({ chores: 2, other: 3 });
  });

  it('with no fallback, a value that is not text is not counted, and nothing throws', () => {
    const o: Record<string, number> = {};
    for (const k of [POISON, { a: 1 }, 5, null, undefined, '', ['x']]) inc(o, k);
    expect(o).toEqual({});
  });

  it('a key every object already has, or the wire’s own marker, is counted in brackets', () => {
    const o: Record<string, number> = {};
    for (const k of AWKWARD) { inc(o, k); inc(o, k); }
    expect(Object.keys(o)).toEqual(AWKWARD.map((k) => `[${k}]`));
    expect(Object.values(o)).toEqual(AWKWARD.map(() => 2));
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
  });

  it('and the whole breakdown arrives at the admin’s screen, through the real encoder', () => {
    const o: Record<string, number> = {};
    for (const k of [...AWKWARD, 'chores']) inc(o, k);
    expect(overTheWire({ byCategory: o })).toEqual({ byCategory: o });
    // Before: the same keys, counted as they were, did not survive the trip.
    const raw = Object.fromEntries(AWKWARD.map((k) => [k, 1]));
    Object.defineProperty(raw, '__proto__', { value: 1, enumerable: true });
    expect(() => overTheWire({ byCategory: raw })).toThrow();
  });
});

describe('wireKey and countOf', () => {
  it('no key a member can write is a property every object has, or starts with @', () => {
    for (const k of [...Object.getOwnPropertyNames(Object.prototype), '@type', '@x', 'chores', 'Uncategorized']) {
      const w = wireKey(k);
      expect(w in Object.prototype, k).toBe(false);
      expect(w.startsWith('@'), k).toBe(false);
    }
    expect(wireKey('chores')).toBe('chores');
  });

  it('reads only what was counted: a group called "constructor" with no events has 0, not a function', () => {
    const evByGroup: Record<string, number> = {};
    inc(evByGroup, 'g1');
    expect(countOf(evByGroup, 'constructor')).toBe(0);
    expect(countOf(evByGroup, 'toString')).toBe(0);
    expect(countOf(evByGroup, 'g1')).toBe(1);
    inc(evByGroup, 'constructor');
    expect(countOf(evByGroup, 'constructor')).toBe(1);
    expect(countOf(evByGroup, { a: 1 })).toBe(0);
  });

  it('only their own counts, whatever the object they are given inherits', () => {
    // A second guard behind wireKey: an inherited number is neither a starting count nor a count.
    const o = Object.create({ chores: 5 }) as Record<string, number>;
    expect(countOf(o, 'chores')).toBe(0);
    inc(o, 'chores');
    expect(o.chores).toBe(1);
    expect(countOf(o, 'chores')).toBe(1);
  });
});

describe('timeMs', () => {
  it('reads an ISO string and a Firestore time', () => {
    expect(timeMs('2026-10-10T00:00:00.000Z')).toBe(Date.parse('2026-10-10T00:00:00.000Z'));
    expect(timeMs({ toMillis: () => 1759 })).toBe(1759);
  });

  it('anything else is 0, and nothing throws', () => {
    for (const v of ['garbage', { toDate: 5 }, { toMillis: 5 }, { toMillis: () => 'x' }, { toMillis: () => { throw new Error('x'); } }, POISON, null, undefined, 5]) {
      expect(timeMs(v), String(typeof v)).toBe(0);
    }
  });
});

describe('withRest', () => {
  it('adds what no value matched under the fallback, and leaves out values counted 0 times', () => {
    expect(withRest({ chores: 2, work: 0, other: 1 }, 5, 'other')).toEqual({ chores: 2, other: 3 });
    expect(withRest({ waiting: 1, playing: 0 }, 3, 'unknown')).toEqual({ waiting: 1, unknown: 2 });
    expect(withRest({ waiting: 0 }, 0, 'unknown')).toEqual({});
  });

  it('never below 0 when the total came short (a count that failed reads 0)', () => {
    expect(withRest({ accepted: 2 }, 0, 'pending')).toEqual({ accepted: 2 });
  });

  it('arrives through the real encoder', () => {
    const o = withRest({ pending: 1, accepted: 0 }, 4, 'pending');
    expect(overTheWire({ friendRequests: o })).toEqual({ friendRequests: { pending: 4 } });
  });
});

describe('clip', () => {
  it('cuts text to the length, and leaves anything else as it is', () => {
    expect(clip('x'.repeat(101), 100)).toBe('x'.repeat(100));
    expect(clip('short', 100)).toBe('short');
    expect(clip('x'.repeat(100), 100)).toBe('x'.repeat(100));
    for (const v of [null, undefined, 7, POISON, ['x'.repeat(200)]]) expect(clip(v, 100)).toBe(v);
  });

  it('keeps a copy, not the whole text it was cut from (review of 29.10.2026)', () => {
    // A slice of a long string points at all of it, and V8 keeps all of it alive while the slice lives:
    // fifty names of a megabyte each, cut to 100 and kept, held 50 MB.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.external; };
    const kept: unknown[] = [];
    gc();
    const before = used();
    for (let i = 0; i < 50; i++) kept.push(clip(Buffer.from(`${i}`.padEnd(1_000_000, 'n'), 'utf8').toString('utf8'), 100));
    gc();
    expect(kept.every((k) => typeof k === 'string' && k.length === 100)).toBe(true);
    expect(used() - before).toBeLessThan(10 * 1024 * 1024);
  });
});

describe('memberText', () => {
  it('text, cut; anything else, nothing', () => {
    expect(memberText('x'.repeat(150), 100)).toBe('x'.repeat(100));
    expect(memberText('One', 100)).toBe('One');
    expect(memberText('', 100)).toBe('');
    for (const v of [null, undefined, 7, true, POISON, { toMillis: () => 1 }, ['One'], new Uint8Array(4)]) expect(memberText(v, 100)).toBeNull();
  });
});

describe('the statistics use them', () => {
  const index = readFileSync('functions/src/index.ts', 'utf8');
  it.each([
    ['one inc, one reader of counts, one reader of times, one cut, one reader of text', 'import { clip, countOf, inc, memberText, timeMs } from "./adminTally";'],
    ['the growth chart reads times only as times', 'const tsOf = timeMs;'],
    ['members only from a list', 'if (Array.isArray(m)) m.forEach((uid: unknown) => inc(groupCount, uid));'],
    ['a group’s counts read as its own', 'events: countOf(evByGroup, d.id), games: countOf(gaByGroup, d.id),'],
    ['a person’s too', 'groups: countOf(groupCount, u.uid),'],
    // Counted since 29.10.2026: a value that is not one the app writes goes to the fallback (withRest).
    ['a game status that is not one of the app’s in the fallback bucket', 'breakdown(games, "status", GAME_STATUSES, gamesTotal, "unknown"),'],
    ['an event category too', 'breakdown(events, "categoryId", EVENT_CATEGORIES, eventsTotal, "other"),'],
    ['a card’s category, read, cut before it becomes a key', 'inc(aByCategory, clip(d.get("category"), 100), "Uncategorized")'],
  ])('%s', (_label, line) => {
    expect(index).toContain(line);
  });

  it('no breakdown is counted on a value with a fallback in front of it (`x || "…"`)', () => {
    expect(index).not.toMatch(/\binc\([^)]*\|\|/);
    expect(index).not.toMatch(/const inc = \(/);
  });
});
