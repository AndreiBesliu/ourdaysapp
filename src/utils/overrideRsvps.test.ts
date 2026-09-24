// src/utils/overrideRsvps.test.ts
//
// `createEventOverride` copied `rsvps` from the client on the Admin SDK, past the rule that lets
// each person change only their own answer. See functions/src/overrideRsvps.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { overrideRsvps } from '../../functions/src/overrideRsvps';

const PARENT = { 'uid-alice': 'yes', 'uid-carol': 'no' };

describe('what the request may change', () => {
  it('the caller’s own answer', () => {
    expect(overrideRsvps(PARENT, { ...PARENT, 'uid-bob': 'maybe' }, 'uid-bob'))
      .toEqual({ 'uid-alice': 'yes', 'uid-carol': 'no', 'uid-bob': 'maybe' });
  });

  it('removing the caller’s own answer, which is how the client un-answers', () => {
    const parent = { ...PARENT, 'uid-bob': 'yes' };
    expect(overrideRsvps(parent, { 'uid-alice': 'yes', 'uid-carol': 'no' }, 'uid-bob'))
      .toEqual(PARENT);
  });
});

describe('what it may not', () => {
  it('anybody else’s answer — which is the defect', () => {
    // Bob answers "yes" for Carol, who said no, and for Dave, who never answered.
    const out = overrideRsvps(PARENT, { 'uid-alice': 'yes', 'uid-carol': 'yes', 'uid-dave': 'yes' }, 'uid-bob');
    expect(out).toEqual(PARENT);
  });

  it('delete anybody else’s answer by leaving it out', () => {
    expect(overrideRsvps(PARENT, {}, 'uid-bob')).toEqual(PARENT);
  });

  it('write something that is not an answer, even for themselves', () => {
    expect(overrideRsvps({}, { 'uid-bob': 'definitely' }, 'uid-bob')).toBeUndefined();
    expect(overrideRsvps({}, { 'uid-bob': { nested: 'yes' } }, 'uid-bob')).toBeUndefined();
  });
});

describe('the edges', () => {
  it('a request with no rsvps at all changes nothing', () => {
    expect(overrideRsvps(PARENT, undefined, 'uid-bob')).toEqual(PARENT);
  });

  it('no answers on either side writes no field', () => {
    expect(overrideRsvps(undefined, undefined, 'uid-bob')).toBeUndefined();
    expect(overrideRsvps(null, [], 'uid-bob')).toBeUndefined();
  });

  it('keeps other people’s answers as the parent holds them, without re-judging them', () => {
    // They were written under the rules by the people they belong to. Dropping one here would
    // delete it in silence.
    expect(overrideRsvps({ 'uid-alice': 'going' }, undefined, 'uid-bob')).toEqual({ 'uid-alice': 'going' });
  });
});

describe('the callable uses it', () => {
  // A source check, the weaker net: which merge the callable calls is not reachable from here
  // without a functions test harness. It pins the one line that matters.
  const src = readFileSync(resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
  const body = src.slice(src.indexOf('export const createEventOverride'), src.indexOf('// ── Group teardown'));

  it('merges instead of copying', () => {
    expect(body).toMatch(/overrideRsvps\(p\.rsvps, \(data as Record<string, unknown>\)\.rsvps, uid\)/);
  });
});
