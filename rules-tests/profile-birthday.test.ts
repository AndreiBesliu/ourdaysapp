// rules-tests/profile-birthday.test.ts
//
// `profiles/{uid}` is readable by every signed-in account, so it carries a birthday's day and
// month, never the year: `0000-MM-DD` (Andrei, 24.09.2026). The full date stays in `users/{uid}`.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ALICE, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(() => startEnv('demo-profile-birthday'));
afterAll(stopEnv);
beforeEach(resetWorld);

const mine = () => doc(as(ALICE), 'profiles', ALICE);

describe('what a profile may say about a birthday', () => {
  it('day and month, or nothing', async () => {
    await assertSucceeds(setDoc(mine(), { name: 'Alice', birthday: '0000-05-12' }));
    await assertSucceeds(setDoc(mine(), { birthday: null }, { merge: true }));
  });

  it('never the year', async () => {
    await assertFails(setDoc(mine(), { name: 'Alice', birthday: '1987-05-12' }));
  });

  it('never MM-DD either — the calendar would read the day as the month', async () => {
    await assertFails(setDoc(mine(), { name: 'Alice', birthday: '05-12' }));
    await assertFails(setDoc(mine(), { name: 'Alice', birthday: '0000-5-12' }));
  });
});

describe('a profile that still holds a full date, before the migration', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'profiles', ALICE), { name: 'Alice', photoURL: null, birthday: '1987-05-12' });
    });
  });

  it('can still change its photo or name — an untouched birthday is not re-judged', async () => {
    // The rule sees the RESULTING document. Judging the stored full date on every write would have
    // refused this merge, and every other one, until the migration ran.
    await assertSucceeds(setDoc(mine(), { photoURL: 'https://example.test/a.png' }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { name: 'Alice B.' }, { merge: true }));
  });

  it('but cannot be set to ANOTHER full date', async () => {
    await assertFails(setDoc(mine(), { birthday: '1990-01-01' }, { merge: true }));
  });

  it('and is moved to the public form by the next write that sets it', async () => {
    await assertSucceeds(setDoc(mine(), { birthday: '0000-05-12' }, { merge: true }));
  });
});
