// src/utils/formerMembers.test.ts
//
// The names deleted accounts leave on the conversations they were in (utils/formerMembers.ts).

import { describe, it, expect } from 'vitest';
import { deletedName, formerMembersOf, withFormerMembers } from './formerMembers';

const label = (name: string | null) => deletedName(name, '{name} (deleted account)', 'Deleted account');

describe('reading them off a conversation', () => {
  it('uid to name, a missing or blank name as null', () => {
    expect(formerMembersOf({ formerMembers: { a: { name: 'Ana', deletedAt: 1 }, b: { name: '  ' }, c: {} } }))
      .toEqual({ a: 'Ana', b: null, c: null });
  });

  it('nothing from a document without them, or with something else in their place', () => {
    expect(formerMembersOf({})).toEqual({});
    expect(formerMembersOf(null)).toEqual({});
    expect(formerMembersOf({ formerMembers: ['a'] })).toEqual({});
    expect(formerMembersOf({ formerMembers: { a: 'Ana' } })).toEqual({});
  });
});

describe('adding them to a map of people', () => {
  it('as a name that says the account was deleted', () => {
    const out = withFormerMembers({ me: { name: 'Me' } }, [{ formerMembers: { a: { name: 'Ana' }, b: {} } }], label);
    expect(out.a).toEqual({ name: 'Ana (deleted account)', deleted: true });
    expect(out.b).toEqual({ name: 'Deleted account', deleted: true });
    expect(out.me).toEqual({ name: 'Me' });
  });

  it('the note wins over a profile the screen still holds: that account no longer exists', () => {
    // Chat keeps the profiles it read; somebody who deletes the account while it is open still had the
    // plain name, and a photo that is gone.
    const out = withFormerMembers({ a: { name: 'Ana', photoURL: 'https://x/gone.jpg' } }, [{ formerMembers: { a: { name: 'Ana' } } }], label);
    expect(out.a).toEqual({ name: 'Ana (deleted account)', deleted: true });
  });

  it('from several conversations at once, the first name kept', () => {
    const out = withFormerMembers({}, [{ formerMembers: { a: { name: 'Ana' } } }, { formerMembers: { a: { name: 'Anna' } } }], label);
    expect(out.a).toEqual({ name: 'Ana (deleted account)', deleted: true });
  });

  it('the SAME map back when there is nothing to set, so a memo does not change identity', () => {
    const people = { me: { name: 'Me' } };
    expect(withFormerMembers(people, [{}, { name: 'Family' }], label)).toBe(people);
    expect(withFormerMembers(people, [{ formerMembers: {} }], label)).toBe(people);
  });

  it('and never changes the map it was given', () => {
    const people = { me: { name: 'Me' } };
    withFormerMembers(people, [{ formerMembers: { a: { name: 'Ana' } } }], label);
    expect(people).toEqual({ me: { name: 'Me' } });
  });
});
