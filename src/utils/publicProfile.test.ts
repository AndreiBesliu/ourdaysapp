// src/utils/publicProfile.test.ts
//
// The name a brand-new account is published to everybody else under.

import { describe, it, expect } from 'vitest';
import { publicMirrorFor } from './publicProfile';

describe('the public mirror reflects, and does not invent', () => {
  it('carries the name from the user document', () => {
    expect(publicMirrorFor({ name: 'Andrei Besliu' }, null).name).toBe('Andrei Besliu');
  });

  it('falls back to the Auth record when the document has none yet', () => {
    // Google sign-in: the Auth record carries a name before any document exists.
    expect(publicMirrorFor(null, 'Andrei Besliu').name).toBe('Andrei Besliu');
    expect(publicMirrorFor({}, 'Andrei Besliu').name).toBe('Andrei Besliu');
  });

  it('prefers the document over the Auth record, which can be stale', () => {
    expect(publicMirrorFor({ name: 'Andrei B.' }, 'Andrei Besliu').name).toBe('Andrei B.');
  });

  it('omits the name entirely when nobody knows one', () => {
    // The whole defect. It used to reach for the e-mail prefix here, and on a new account it ALWAYS
    // reached here: the sign-in handler reads `users/{uid}` before the signup path writes it.
    // Omitting the key on a merge leaves whatever is there, so the order of the racing writes
    // stops mattering.
    expect(publicMirrorFor(null, null)).not.toHaveProperty('name');
    expect(publicMirrorFor({}, undefined)).not.toHaveProperty('name');
    expect(publicMirrorFor({ name: '   ' }, '')).not.toHaveProperty('name');
  });

  it('never publishes a placeholder either', () => {
    // "User" is not better than nothing: the server prefers the mirror over the user document
    // (`profiles.name || users.name`), so a placeholder here outranks the real name there.
    const out = publicMirrorFor({ email: 'jdoe@example.com' } as never, null);
    expect(Object.values(out)).not.toContain('User');
    expect(Object.values(out)).not.toContain('jdoe');
  });

  it('normalises the other two fields to null rather than leaving them absent', () => {
    // These two are safe to overwrite: an absent avatar IS "no avatar", and writing null keeps a
    // stale one from surviving a change.
    expect(publicMirrorFor({}, null)).toEqual({ photoURL: null, birthday: null });
    // The birthday is mirrored WITHOUT its year (Andrei, 24.09.2026): this used to assert the full
    // date went into the public profile, which is exactly what that decision stopped.
    expect(publicMirrorFor({ photoURL: 'https://x/y.png', birthday: '1990-04-01' }, null))
      .toEqual({ photoURL: 'https://x/y.png', birthday: '0000-04-01' });
  });
});
