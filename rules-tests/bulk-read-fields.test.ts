// rules-tests/bulk-read-fields.test.ts
//
// What the server reads in bulk may hold (17.10.2026). The reminders (every event in their window,
// everybody's personal ones included), the account deletion and the group digest read events ten or
// twenty to a page, only the fields they use; the reminders also read up to a hundred owners' zones and
// every notification up to fifty recipients' push tokens at once; the deletion keeps every group's
// members for its run. A page was sized on the 1 MiB a document may hold, and a LIST breaks that: a list
// of a million nulls is a megabyte stored and about 100 MB decoded, so a few padded documents ran each
// function out of memory at every attempt, for everybody (review of 17.10.2026, measured on the emulator
// with the real read paths). Pinned here:
//   1. every padding the review wrote through these rules into a field read ten a page is refused now,
//      by the rule (never by the 1000-expression ceiling), and so is the same padding one level down (a
//      map inside the list);
//   2. everything the web and the installed APK write and copy still passes, the largest real values
//      included, and so does a value exactly at each cap.
// Three fields of an event the rules leave alone, and the server reads them one event a page instead
// (functions/src/batchDelete.ts, functions/test/bulkReadPages.test.ts): a checklist (its items are maps,
// and rules have no loops), `hiddenFrom` and the picture (an edit of an event has no room left under the
// 1000 expressions, measured again on 17.10.2026 for `hiddenFrom`: 194 refusals past the limit).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, arrayRemove, arrayUnion, collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, DAVE, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-bulk-read'); });
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => {
    await setDoc(doc(db, 'events', 'e'), webEvent(ALICE, G1));
    await setDoc(doc(db, 'events', 'mine'), webEvent(DAVE, null));
    await setDoc(doc(db, 'users', DAVE), { name: 'Dave', email: 'dave@example.test', timezone: 'Europe/Bucharest', fcmTokens: ['t-1'] });
    // Stored before the rule, as its owner could: judged only when a write changes it.
    await setDoc(doc(db, 'users', BOB), { name: 'Bob', timezone: new Array(1000).fill(null) });
  });
});

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

const DAY = '2026-10-08T00:00:00.000Z';
const NESTED = [{ v: [null, null] }];
const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
const url = 'https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/events%2Fuid-alice%2F1759900000000_photo.jpg?alt=media&token=0b5c3f0e-6a0e-4c1b-9a77-0b2c3d4e5f60';

/** An event as the web's form writes it (AddEventModal), with every field the server reads in bulk. */
const webEvent = (owner: string, groupId: string | null) => ({
  title: 'Dinner', description: '', checklistItems: [{ id: '1', text: 'bread', isCompleted: false, assetUrl: null, assetId: null }],
  categoryId: 'family_time', color: '#3b82f6', emoji: null, ownerId: owner, groupId, sharedWithFamily: false,
  imageUrl: url, isTask: true, taskStatus: 'not-started', assigneeIds: [owner], assigneeId: owner, assetId: null,
  hiddenFrom: [], rsvpEnabled: false, rsvps: {}, location: '', reminderMinutes: 15, time: '19:00', endTime: '21:00',
  endDayOffset: 2, timezone: 'Europe/Bucharest', recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' },
  recurrenceExceptions: days(53), date: DAY, createdAt: DAY, updatedAt: DAY,
});
/** As the installed APK writes one (apk-compat.test.ts, from its bundle). */
const apkEvent = (owner: string, groupId: string | null) => ({
  title: 'Dentist', description: '', checklistItems: [], categoryId: 'personal', ownerId: owner, sharedWithFamily: false,
  imageUrl: null, isTask: false, taskStatus: 'none', assigneeIds: [], assigneeId: null, assetId: null,
  updatedAt: '2026-09-24T09:00:00.000Z', date: '2026-09-24T09:00:00.000Z', createdAt: '2026-09-24T09:00:00.000Z',
  groupId, visibleTo: groupId ? [ALICE, BOB] : [],
});

/** What a group member could write into a group event until today, read ten a page by the server. */
const PADDED_GROUP: [string, unknown][] = [
  ['assigneeIds', new Array(201).fill(BOB)],
  ['recurrenceExceptions', days(501)], ['recurrenceExceptions', NESTED],
  ['recurrenceRule', { frequency: ['daily'] }], ['recurrenceRule', { frequency: 'daily', onlyOn: { v: [null] } }],
  ['recurrenceRule', { frequency: 'daily', onlyOn: [null] }],
  ['endDayOffset', [null, null]], ['endDayOffset', { v: [null] }],
];
/** The same, on a personal event, which only its owner writes and every reminder run reads. */
const PADDED_PERSONAL: [string, unknown][] = [
  ['title', [null, null]], ['title', { v: [null] }], ['date', [DAY]], ['time', { v: [null] }], ['timezone', [null]],
  ['reminderMinutes', [15]], ['endDayOffset', { v: [null] }], ['overrideOfParent', [null]], ['overrideDate', { v: [] }],
  ['recurrenceRule', [null]], ['recurrenceRule', { frequency: 'daily', onlyOn: [null] }], ['recurrenceRule', { frequency: { v: [null] } }],
  ['recurrenceExceptions', days(501)], ['recurrenceExceptions', NESTED], ['recurrenceExceptions', { v: [null] }],
  ['assigneeIds', new Array(201).fill(DAVE)],
];

describe('a group event: what the server reads ten a page is short, and holds no maps', () => {
  it.each(PADDED_GROUP)('not created with %s = (padded)', async (field, value) => {
    await fails(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB, G1), [field]: value }));
  });

  it.each(PADDED_GROUP)('not edited into %s = (padded), by any member', async (field, value) => {
    await fails(updateDoc(doc(as(BOB), 'events', 'e'), { [field]: value }));
  });

  it('nor born an override whose parent or day is a list (an edit cannot change them)', async () => {
    await fails(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB, G1), overrideOfParent: [null] }));
    await fails(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB, G1), overrideDate: { v: [null] } }));
  });

  it('the padding the review wrote (300,000 nulls by a plain member) is refused', async () => {
    // Refused either by the cap or by the engine's own memory ceiling; both are refusals.
    await assertFails(updateDoc(doc(as(BOB), 'events', 'e'), { recurrenceExceptions: new Array(300_000).fill(null) }));
    await assertFails(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB, G1), recurrenceExceptions: new Array(300_000).fill(null) }));
  }, 60_000);

  it('what the web and the installed APK write passes, and so does every value at its cap', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB, G1), hiddenFrom: [ALICE], assigneeIds: [ALICE, BOB] }));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), apkEvent(BOB, G1)));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), {
      ...webEvent(BOB, G1), recurrenceExceptions: days(500), assigneeIds: new Array(200).fill(BOB),
      endDayOffset: null, recurrenceRule: { frequency: 'yearly' }, title: 'x'.repeat(20000),
    }));
    // The edits the screens make: an exception by arrayUnion, a span, a rule, assignees.
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { recurrenceExceptions: arrayUnion('2026-12-01') }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { endDayOffset: 0, assigneeIds: [ALICE, BOB], hiddenFrom: [BOB] }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { recurrenceRule: { frequency: 'weekly' } }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { recurrenceRule: null, recurrenceExceptions: [] }));
  });
});

describe('a personal event: open for what the screens show, not for what the server reads in bulk', () => {
  it.each(PADDED_PERSONAL)('not created with %s = (padded)', async (field, value) => {
    await fails(addDoc(collection(as(DAVE), 'events'), { ...webEvent(DAVE, null), [field]: value }));
  });

  it.each(PADDED_PERSONAL)('not edited into %s = (padded)', async (field, value) => {
    await fails(updateDoc(doc(as(DAVE), 'events', 'mine'), { [field]: value }));
  });

  it('the padding the review wrote (a stranger, 300,000 nulls of exceptions) is refused', async () => {
    await assertFails(addDoc(collection(as(DAVE), 'events'), { ...webEvent(DAVE, null), recurrenceExceptions: new Array(300_000).fill(null) }));
  }, 60_000);

  it('what both apps write and copy passes: the APK’s event, the web’s, the copy made on leaving a group', async () => {
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), apkEvent(DAVE, null)));
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), webEvent(DAVE, null)));
    // The leave copy (LeaveGroupModal): the group's event as stored, owned and assigned to the leaver,
    // with who it was hidden from, its exceptions, an override's keys and the server's AI note.
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), {
      ...webEvent(ALICE, G1), groupId: null, ownerId: DAVE, assigneeIds: [DAVE], assigneeId: DAVE, rsvps: { [DAVE]: 'yes' },
      hiddenFrom: [ALICE, BOB], overrideOfParent: 'parentEventId0000001', overrideDate: '2026-10-08',
      aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: DAY },
    }));
    // What the screens show stays open, as it was: none of it is read in bulk.
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), {
      ...webEvent(DAVE, null), emoji: { a: 1 }, description: { a: 1 }, color: { a: 1 }, title: 'x'.repeat(20000),
      recurrenceRule: { frequency: 'weekly', anythingElse: [null, null] }, recurrenceExceptions: null,
    }));
    // A value at each cap.
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), {
      ...webEvent(DAVE, null), recurrenceExceptions: days(500), assigneeIds: new Array(200).fill(DAVE),
    }));
  });
});

describe('a user’s document: the fields read a hundred and fifty at a time', () => {
  it.each([
    ['timezone', [null]], ['timezone', 'x'.repeat(65)], ['language', [null]], ['language', { v: [null] }],
    ['fcmTokens', new Array(501).fill('t')], ['fcmTokens', [{ v: [null] }]], ['fcmTokens', ['x'.repeat(200_001)]],
  ] as [string, unknown][])('not %s = (padded), on an edit or at sign-up', async (field, value) => {
    await fails(updateDoc(doc(as(DAVE), 'users', DAVE), { [field]: value }));
    await fails(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), { name: 'New', [field]: value }));
  });

  it('what the apps write passes: the APK’s sign-up, a zone, a language, a push token in and out', async () => {
    await assertSucceeds(setDoc(doc(as('uid-newcomer'), 'users', 'uid-newcomer'), {
      name: 'New', email: 'new@example.test', createdAt: new Date(), theme: { primaryColor: '#3b82f6', isDarkMode: false },
    }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { timezone: 'America/Argentina/Buenos_Aires', language: 'ro-RO' }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmTokens: arrayUnion('x'.repeat(163)) }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmTokens: arrayRemove('t-1') }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { fcmTokens: new Array(500).fill('x'.repeat(163)) }));
    await assertSucceeds(updateDoc(doc(as(DAVE), 'users', DAVE), { timezone: null, lastLogin: DAY, familyMembers: [] }));
  });

  it('a value stored before the rule never blocks an unrelated write', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'users', BOB), { name: 'Bob B.' }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'users', BOB), { timezone: 'Europe/Bucharest' }));
  });
});

describe('a group: each member once', () => {
  it('created by its only member, once', async () => {
    await fails(setDoc(doc(as(DAVE), 'groups', 'g-new'), { name: 'Mine', ownerId: DAVE, members: [DAVE, DAVE], createdAt: DAY }));
    await assertSucceeds(setDoc(doc(as(DAVE), 'groups', 'g-new'), { name: 'Mine', ownerId: DAVE, members: [DAVE], createdAt: DAY }));
  });

  it('the owner cannot pad the list with copies of who is in it; removing, leaving and renaming still pass', async () => {
    await fails(updateDoc(doc(as(ALICE), 'groups', G1), { members: [ALICE, BOB, ALICE] }));
    await fails(updateDoc(doc(as(ALICE), 'groups', G1), { members: [ALICE, BOB, ...new Array(200).fill(BOB)] }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1), { name: 'Renamed' }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', G1), { members: [BOB, ALICE] }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', G1), { members: arrayRemove(BOB) }));
  });
});
