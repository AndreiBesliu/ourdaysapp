// rules-tests/adminReadUserFields.test.ts
//
// What the Admin reads of every person, ten a page (29.10.2026, functions/src/adminRead.ts): a name, an
// address, a picture and a birthday, each text or nothing — never a list or a map, which a page of ten
// could not hold once decoded, nor bytes or a time, which the Admin could not show or send (review of
// the same day) — and a friends list that only the server writes. Kinds, not lengths: the
// installed APK writes the name as typed and the address Google gives. Its writes, and the web's, are
// copied here from the bundles and must still pass.
// Runs from rules-tests/ (emu-run --into=rules-tests).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { Bytes, GeoPoint, Timestamp, arrayUnion, deleteField, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { DAVE, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-admin-user-fields'); });
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', DAVE), {
      name: 'Dave', email: 'dave@example.test', friends: [{ uid: 'uid-friend', name: 'Friend', email: 'f@example.test' }],
    });
  });
});

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

const NULLS = new Array(1000).fill(null);
const NEW = 'uid-newcomer';

/** Every kind that is not text: what the Admin could not show, or would send as one key a byte. */
const notText = (db: ReturnType<typeof as>): Array<[string, unknown]> => [
  ['a list', NULLS], ['a map', { a: 'b' }], ['bytes', Bytes.fromUint8Array(new Uint8Array(64))],
  ['a time', Timestamp.now()], ['the server’s time', serverTimestamp()], ['a reference', doc(db, 'users', 'uid-other')],
  ['a place', new GeoPoint(1, 2)], ['a number', 7], ['a boolean', true],
];

describe('a name, an address, a picture and a birthday are each text or nothing', () => {
  for (const field of ['name', 'email', 'photoURL', 'birthday']) {
    it(`refuses anything but text as ${field}, on an edit and at sign-up`, async () => {
      // One instance for the write and the reference written: a reference must come from the same one.
      const dave = as(DAVE);
      for (const [kind, value] of notText(dave)) {
        await fails(updateDoc(doc(dave, 'users', DAVE), { [field]: value })).catch((e) => { throw new Error(`${kind}: ${e}`); });
      }
      const newcomer = as(NEW);
      for (const [kind, value] of notText(newcomer)) {
        await fails(setDoc(doc(newcomer, 'users', NEW), { [field]: value })).catch((e) => { throw new Error(`${kind}: ${e}`); });
      }
    });

    it(`takes text of any length as ${field}, and none`, async () => {
      await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { [field]: 'x'.repeat(5000) }));
      await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { [field]: null }));
      await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { [field]: deleteField() }));
    });
  }
});

describe('the friends list is the server’s', () => {
  it('refuses a person writing it, adding to it or clearing it', async () => {
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { friends: NULLS }));
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { friends: arrayUnion({ uid: 'uid-other' }) }));
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { friends: [] }));
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { friends: deleteField() }));
    await fails(setDoc(doc(as(NEW), 'users', NEW), { name: 'New', friends: [] }));
  });

  it('leaves the rest of the document writable with a friends list in it', async () => {
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { name: 'Dave B', lastLogin: '2026-10-29T10:00:00.000Z' }));
    await assertSucceeds(setDoc(doc(as(DAVE), 'users', DAVE), { timezone: 'Europe/Bucharest' }, { merge: true }));
  });
});

describe('what the apps write still passes', () => {
  it('the web: sign-up, the Google sign-in, the start, Settings', async () => {
    await assertSucceeds(setDoc(doc(as(NEW), 'users', NEW), { name: 'New', email: 'new@example.test', createdAt: new Date() }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('uid-google'), 'users', 'uid-google'), { name: 'User', email: null, createdAt: new Date() }));
    await assertSucceeds(setDoc(doc(as(DAVE), 'users', DAVE), { email: 'dave@example.test', lastLogin: '2026-10-29T10:00:00.000Z', name: 'Dave' }, { merge: true }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { birthday: '1990-04-05', photoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/p.png' }));
  });

  it('the installed APK: its sign-up, its picture, its theme and its categories (bundle of 9 May)', async () => {
    await assertSucceeds(setDoc(doc(as(NEW), 'users', NEW), {
      name: 'New', email: 'new@example.test', createdAt: new Date(), theme: { primaryColor: '#3b82f6', isDarkMode: false },
    }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { photoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/p.png' }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { primaryColor: '221.2 83.2% 53.3%', isDarkMode: true }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { walletCategories: ['Home & Living', 'Cards'] }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { familyMembers: arrayUnion('uid-friend') }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmToken: 'native-token' }));
  });
});
