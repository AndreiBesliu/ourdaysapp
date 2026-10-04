// src/utils/bootstrapWrites.test.ts — what a start writes about the account (bootstrapWrites.ts).
import { describe, it, expect } from 'vitest';
import { bootstrapPlan, profileReadOf, laterWrites, type ProfileRead } from './bootstrapWrites';

const NOW = '2026-10-04T12:00:00.000Z';
const USER = { email: 'ana@example.test', displayName: 'Old Display Name' };
const PROFILE = {
  name: 'Ana Real', timezone: 'America/New_York', familyMembers: ['fam-1'],
  photoURL: 'https://example.test/ana.png', birthday: '1990-05-04',
};
const server = (data: Record<string, unknown> = PROFILE, exists = true): ProfileRead => ({ kind: 'server', exists, data });
const snap = (data: Record<string, unknown> | undefined, fromCache: boolean, hasPendingWrites = false) => ({
  exists: () => data !== undefined, data: () => data, metadata: { fromCache, hasPendingWrites },
});

describe('without the server\'s answer, a start writes only what it knows for itself (bench, 04.10)', () => {
  for (const read of [{ kind: 'failed' } as ProfileRead, { kind: 'cached', exists: true, data: {} } as ProfileRead]) {
    it(`${read.kind}: email and lastLogin — no name, zone, mirror or familyMembers`, () => {
      const p = bootstrapPlan(read, USER, NOW, 'Europe/Bucharest');
      expect(p.userUpdate).toEqual({ email: USER.email, lastLogin: NOW });
      expect(p.mirror).toBeNull();
      expect(p.initFamilyMembers).toBe(false);
    });
  }

  it('a cached profile, even one that looks incomplete, decides nothing', () => {
    const p = bootstrapPlan({ kind: 'cached', exists: false, data: {} }, USER, NOW, 'Europe/Bucharest');
    expect(p.userUpdate).toEqual({ email: USER.email, lastLogin: NOW });
    expect(p.mirror).toBeNull();
    expect(p.initFamilyMembers).toBe(false);
  });
});

describe("with the server's answer", () => {
  it('an account that has everything: nothing of it is replaced, and the mirror carries it', () => {
    const p = bootstrapPlan(server(), USER, NOW, 'Europe/Bucharest');
    expect(p.userUpdate).toEqual({ email: USER.email, lastLogin: NOW });
    expect(p.mirror).toEqual({ name: 'Ana Real', photoURL: 'https://example.test/ana.png', birthday: '0000-05-04' });
    expect(p.initFamilyMembers).toBe(false);
  });

  it('a missing name or zone is filled once; an invalid device zone fills nothing', () => {
    const p = bootstrapPlan(server({ familyMembers: [] }), USER, NOW, 'Europe/Bucharest');
    expect(p.userUpdate).toMatchObject({ name: 'Old Display Name', timezone: 'Europe/Bucharest' });
    expect(bootstrapPlan(server({ familyMembers: [] }), USER, NOW, null).userUpdate).not.toHaveProperty('timezone');
    expect(bootstrapPlan(server({ familyMembers: [] }), { ...USER, displayName: null }, NOW, null).userUpdate).not.toHaveProperty('name');
  });

  it('a new account (the server says there is no document): the backfills, the mirror, and familyMembers', () => {
    const p = bootstrapPlan(server({}, false), USER, NOW, 'Europe/Bucharest');
    expect(p.userUpdate).toEqual({ email: USER.email, lastLogin: NOW, name: 'Old Display Name', timezone: 'Europe/Bucharest' });
    expect(p.mirror).toEqual({ name: 'Old Display Name', photoURL: null, birthday: null });
    expect(p.initFamilyMembers).toBe(true);
  });

  it('familyMembers is set only where the field is missing', () => {
    expect(bootstrapPlan(server({ ...PROFILE, familyMembers: undefined }), USER, NOW, null).initFamilyMembers).toBe(true);
    expect(bootstrapPlan(server(), USER, NOW, null).initFamilyMembers).toBe(false);
  });
});

describe('profileReadOf', () => {
  it('no snapshot: failed; from the cache: cached; otherwise: the server', () => {
    expect(profileReadOf(null)).toEqual({ kind: 'failed' });
    expect(profileReadOf(snap(PROFILE, true))).toEqual({ kind: 'cached', exists: true, data: PROFILE });
    expect(profileReadOf(snap(PROFILE, false))).toEqual({ kind: 'server', exists: true, data: PROFILE });
    expect(profileReadOf(snap(undefined, false))).toEqual({ kind: 'server', exists: false, data: {} });
  });

  it("not from the cache, but carrying this device's own unconfirmed write: not yet the server's word (review 04.10)", () => {
    // The shape measured on 28.09 (the birthday flash): fromCache false, a pending write, fields missing.
    const r = profileReadOf(snap({ email: USER.email, lastLogin: NOW }, false, true));
    expect(r.kind).toBe('cached');
    expect(bootstrapPlan(r, USER, NOW, 'Europe/Bucharest').mirror).toBeNull();
  });
});

describe('postponed, not dropped (review 04.10)', () => {
  it('a later plan keeps only what the start could not decide: name and zone, the mirror, familyMembers', () => {
    const w = laterWrites(bootstrapPlan(server({ email: USER.email, lastLogin: NOW }), USER, NOW, 'Europe/Bucharest'));
    expect(w.userFields).toEqual({ name: 'Old Display Name', timezone: 'Europe/Bucharest' });
    expect(w.mirror).toEqual({ name: 'Old Display Name', photoURL: null, birthday: null });
    expect(w.initFamilyMembers).toBe(true);
  });

  it('a new account whose first read failed gets its zone, name and mirror at the first server answer', () => {
    // The start: nothing derived.
    const first = bootstrapPlan({ kind: 'failed' }, USER, NOW, 'Europe/Bucharest');
    expect(first.mirror).toBeNull();
    // The first answer the server confirms: the document the start itself created ({email, lastLogin}).
    const later = profileReadOf(snap({ email: USER.email, lastLogin: NOW }, false, false));
    const rest = laterWrites(bootstrapPlan(later, USER, NOW, 'Europe/Bucharest'));
    expect(rest.userFields.timezone).toBe('Europe/Bucharest');
    expect(rest.userFields.name).toBe('Old Display Name');
    expect(rest.mirror?.name).toBe('Old Display Name');
  });

  it('an existing account answered later: nothing of it is replaced', () => {
    const rest = laterWrites(bootstrapPlan(server(), USER, NOW, 'Europe/Bucharest'));
    expect(rest.userFields).toEqual({});
    expect(rest.mirror).toEqual({ name: 'Ana Real', photoURL: 'https://example.test/ana.png', birthday: '0000-05-04' });
    expect(rest.initFamilyMembers).toBe(false);
  });
});
