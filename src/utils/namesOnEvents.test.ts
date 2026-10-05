// src/utils/namesOnEvents.test.ts — the names of people named on events who are no longer in your
// groups (utils/namesOnEvents.ts; Andrei, 05.10.2026).

import { describe, it, expect } from 'vitest';
import { namedOutside, withNamesOnEvents } from './namesOnEvents';

describe('namedOutside', () => {
  const known = { 'uid-ana': { name: 'Ana' }, 'uid-bob': { name: 'Bob' } };

  it('owner, assignees and answers the map has no name for, once each and sorted', () => {
    expect(namedOutside([
      { ownerId: 'uid-gina', assigneeIds: ['uid-bob', 'uid-gina', 'uid-dan'], assigneeId: 'uid-gina' },
      { ownerId: 'uid-ana', rsvps: { 'uid-ana': 'yes', 'uid-carol': 'no' } },
    ], known)).toEqual(['uid-carol', 'uid-dan', 'uid-gina']);
  });

  it('each field on its own is looked at: the owner, the list, the older single field, the answers', () => {
    expect(namedOutside([{ ownerId: 'uid-o' }], known)).toEqual(['uid-o']);
    expect(namedOutside([{ assigneeIds: ['uid-l'] }], known)).toEqual(['uid-l']);
    expect(namedOutside([{ assigneeId: 'uid-s' }], known)).toEqual(['uid-s']);
    expect(namedOutside([{ rsvps: { 'uid-r': 'maybe' } }], known)).toEqual(['uid-r']);
  });

  it('nobody when everyone named is known, the AI is never looked up, and malformed fields name nobody', () => {
    expect(namedOutside([{ ownerId: 'uid-ana', assigneeIds: ['uid-bob', 'ai_assistant'], assigneeId: 'ai_assistant' }], known)).toEqual([]);
    expect(namedOutside([{ ownerId: 7, assigneeIds: 'uid-x', rsvps: ['uid-y'], assigneeId: '' }], known)).toEqual([]);
    expect(namedOutside([], known)).toEqual([]);
  });
});

describe('withNamesOnEvents', () => {
  it('adds the names from outside, and a member’s own entry wins', () => {
    expect(withNamesOnEvents({ a: { name: 'Ana (member)' } }, { a: { name: 'Ana (old)' }, g: { name: 'Gina' } }))
      .toEqual({ a: { name: 'Ana (member)' }, g: { name: 'Gina' } });
  });
});
