// rules-tests/shown-fields.test.ts
//
// What the shown fields of an event, a wallet card and an expense may hold (08.10.2026). Until then
// nothing typed them: a member could write a group event's title or emoji as a map, share a card whose
// name was a map, or file an expense whose description was a map, and the calendar of the group, the
// Wallet of every member, or the expenses of the group put the whole app on the recovery screen for
// everybody who opened them (reproduced on the emulators). Every refusal below is checked to be the
// rule's, not the 1000-expression ceiling's; every write the web or the installed APK makes is checked
// to pass.

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, arrayUnion, collection, deleteField, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ALICE, BOB, G1, as, resetWorld, seed, startEnv, stopEnv } from './_harness';
import { SCANNER_FORMATS } from '../src/utils/barcodeFormat';

/** A third group with the same two people, to move and share between groups. */
const G3 = 'group-three';

beforeAll(async () => { await startEnv('demo-ourdays-shown-fields'); });
afterAll(stopEnv);
beforeEach(async () => {
  await resetWorld();
  await seed(async (db) => { await setDoc(doc(db, 'groups', G3), { name: 'Gym', members: [ALICE, BOB], ownerId: BOB }); });
});

async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}
const MAP = { a: 1 };
const long = (n: number) => 'x'.repeat(n);
const DAY = '2026-10-08T00:00:00.000Z';

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

/** A group event as the web's form writes it (AddEventModal, baseEventData + create). */
const webEvent = (owner: string) => ({
  title: 'Dinner', description: '', checklistItems: [{ id: '1', text: 'bread', isCompleted: false, assetUrl: null, assetId: null }],
  categoryId: 'family_time', color: '#3b82f6', emoji: '\u{1F37D}️', ownerId: owner, groupId: G1, sharedWithFamily: false,
  imageUrl: null, isTask: false, taskStatus: 'none', assigneeIds: [], assigneeId: null, assetId: null,
  hiddenFrom: [], rsvpEnabled: false, rsvps: {}, location: '', reminderMinutes: 15, time: '19:00', endTime: '21:00',
  endDayOffset: null, timezone: 'Europe/Bucharest', recurrenceRule: { frequency: 'weekly' }, recurrenceExceptions: [],
  date: DAY, createdAt: DAY, updatedAt: DAY,
});
/** As the installed APK writes one (apk-compat.test.ts, from its bundle): any UTC hour, no emoji or time. */
const apkEvent = (owner: string) => ({
  title: 'Dentist', description: '', checklistItems: [], categoryId: 'health', ownerId: owner, sharedWithFamily: false,
  imageUrl: null, isTask: false, taskStatus: 'none', assigneeIds: [], assigneeId: null, assetId: null,
  updatedAt: '2026-09-24T09:00:00.000Z', date: '2026-09-24T09:00:00.000Z', createdAt: '2026-09-24T09:00:00.000Z',
  groupId: G1, visibleTo: [ALICE, BOB],
});

const BAD_EVENT_FIELDS: [string, unknown][] = [
  ['title', MAP], ['title', 7], ['title', null],
  ['emoji', MAP], ['emoji', 5], ['emoji', long(17)],
  ['description', MAP], ['description', ['x']],
  ['location', MAP], ['location', 5],
  ['time', '9:00'], ['time', MAP], ['time', '24:00'], ['endTime', 'x'],
  ['date', MAP], ['date', 'garbage'], ['date', '2026-13-01'], ['date', '2026-10-08T00:00:00+02:00'], ['date', 1759900000000],
  ['date', '2026-10-08T24:30:00.000Z'], ['date', '2026-10-32'],
  ['checklistItems', 'bread'], ['checklistItems', MAP],
  ['recurrenceExceptions', MAP], ['recurrenceExceptions', '2026-10-08'],
  ['recurrenceRule', 'weekly'],
  ['taskStatus', MAP], ['color', long(65)], ['categoryId', 5], ['timezone', MAP],
  ['reminderMinutes', '15'], ['reminderMinutes', MAP],
  // The AI checklist's note is the server's: a client may only take it away.
  ['aiChecklist', { status: 'failed', reason: MAP }],
];

describe('a group event is created only with shown fields of the app’s kind', () => {
  it('as the web writes one, and as the installed APK writes one', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), webEvent(BOB)));
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), apkEvent(BOB)));
    // A day alone (the server's occurrences carry one), and text of any length where the installed APK
    // writes free text without a limit of its own: what it writes today must not be refused.
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), {
      ...webEvent(BOB), date: '2026-10-08', title: long(20000), emoji: long(16), description: long(100000), location: long(5000),
      time: null, endTime: null, recurrenceRule: null, recurrenceExceptions: null, checklistItems: null,
    }));
  });

  it.each(BAD_EVENT_FIELDS)('not with %s = %j', async (field, value) => {
    await fails(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB), [field]: value }));
  });

  it('a personal event stays open, as its answers do: leaving a group copies the event as stored', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), { ...webEvent(BOB), groupId: null, title: MAP, emoji: MAP }));
    // The copy the web and the installed APK make on leaving carries the server's AI note too.
    await assertSucceeds(addDoc(collection(as(BOB), 'events'), {
      ...webEvent(BOB), groupId: null, aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: DAY },
    }));
  });
});

describe('a group event is edited only into shown fields of the app’s kind', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'events', 'e'), webEvent(ALICE));
      // Written before the rule, as any member could: every shown field wrong.
      await setDoc(doc(db, 'events', 'old'), {
        ...webEvent(ALICE), title: MAP, emoji: MAP, description: MAP, location: MAP, time: MAP, date: MAP,
        checklistItems: 'x', recurrenceExceptions: MAP, recurrenceRule: 'x', taskStatus: MAP,
      });
      await setDoc(doc(db, 'events', 'mine'), { ...webEvent(BOB), groupId: null, title: MAP });
      await setDoc(doc(db, 'events', 'oldTitle'), { ...webEvent(ALICE), title: MAP });
      await setDoc(doc(db, 'events', 'noted'), {
        ...webEvent(BOB), groupId: null, aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: DAY },
      });
    });
  });

  it.each(BAD_EVENT_FIELDS)('any member, not %s = %j', async (field, value) => {
    await fails(updateDoc(doc(as(BOB), 'events', 'e'), { [field]: value }));
  });

  it('what the screens write passes: a title, a tick, a status, an exception, a day', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { title: 'Supper', updatedAt: DAY }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), {
      checklistItems: [{ id: '1', text: 'bread', isCompleted: true, assetUrl: null, assetId: null }],
    }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { taskStatus: 'completed' }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'events', 'e'), { recurrenceExceptions: arrayUnion('2026-10-15') }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { aiChecklist: deleteField() }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { emoji: null, time: null, endTime: null, location: null }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'e'), { reminderMinutes: 60, color: '#ef4444' }));
  });

  it('a field the screens need cannot be taken away', async () => {
    await fails(updateDoc(doc(as(BOB), 'events', 'e'), { title: deleteField() }));
    await fails(updateDoc(doc(as(BOB), 'events', 'e'), { date: deleteField() }));
  });

  it('an old event is judged only on what a write changes, and an edit repairs it', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'old'), { taskStatus: 'completed' }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'old'), { title: 'Fixed', date: DAY, updatedAt: DAY }));
    await fails(updateDoc(doc(as(BOB), 'events', 'old'), { emoji: { b: 2 } }));
  });

  it('an event moved from one group into another is judged in full, like one coming from personal', async () => {
    await fails(updateDoc(doc(as(BOB), 'events', 'oldTitle'), { groupId: G3 }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'oldTitle'), { groupId: G3, title: 'Fixed' }));
  });

  it('a personal event lands in a group only with the shown fields a group could write', async () => {
    await fails(updateDoc(doc(as(BOB), 'events', 'mine'), { groupId: G1 }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'mine'), { groupId: G1, title: 'Mine' }));
  });

  it('the AI note: a client may delete it, not write it, and it does not go into a group with the event', async () => {
    // Born on a personal event (whose create is open), it must not reach a group by a move.
    await fails(updateDoc(doc(as(BOB), 'events', 'noted'), { groupId: G1, updatedAt: DAY }));
    // The edit form's move deletes it, and then the move passes.
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'noted'), { groupId: G1, updatedAt: DAY, aiChecklist: deleteField() }));
    await fails(updateDoc(doc(as(ALICE), 'events', 'noted'), { aiChecklist: { status: 'failed', reason: 'x' } }));
  });

  it('a note the server left on a group event stays through any edit that does not touch it', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'events', 'gnote'), { ...webEvent(ALICE), aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: DAY } });
    });
    await assertSucceeds(updateDoc(doc(as(BOB), 'events', 'gnote'), { title: 'Edited', updatedAt: DAY }));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'events', 'gnote'), { aiChecklist: deleteField() }));
  });

  it('leaving a group with an old event is not judged on what it does not change', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'events', 'old'), { groupId: null, sharedWithFamily: false }));
  });
});

// ── Wallet cards ────────────────────────────────────────────────────────────────────────────────

/** As the Wallet's save writes a new card (Wallet.tsx saveCard). */
const webCard = (owner: string) => ({
  lastWriteId: 'op-1759900000000-ab', name: 'Library card', categories: ['Shopping', 'Kids'], category: 'Shopping',
  imageUrl: null, sharedGroupId: G1, sharedWithFamily: true, barcodeValue: '5901234123457', barcodeFormat: 'EAN_13',
  ownerId: owner, createdAt: DAY,
});
/** As the installed APK's Wallet writes one (index-DTbgbzyX.js, Wallet save). */
const apkCard = (owner: string) => ({
  name: 'Card', categories: ['Uncategorized'], category: 'Uncategorized', imageUrl: null, sharedWithFamily: false,
  barcodeValue: null, barcodeFormat: null, ownerId: owner, createdAt: DAY,
});

const BAD_CARD_FIELDS: [string, unknown][] = [
  ['name', MAP], ['name', 5], ['name', null],
  ['category', MAP], ['category', 5],
  ['categories', 'Shopping'], ['categories', MAP],
  ['imageUrl', MAP], ['imageUrl', long(4097)],
  ['barcodeValue', 5], ['barcodeValue', MAP], ['barcodeValue', long(7090)],
  ['barcodeFormat', MAP], ['barcodeFormat', long(65)],
  ['sharedWithFamily', 'yes'],
];

describe('a wallet card holds shown fields of the app’s kind', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'assets', 'c'), webCard(BOB));
      await setDoc(doc(db, 'assets', 'old'), { ...webCard(BOB), name: MAP, barcodeValue: MAP, categories: 'x' });
      await setDoc(doc(db, 'assets', 'oldPrivate'), { ...webCard(BOB), name: MAP, sharedGroupId: null, sharedWithFamily: false });
      await setDoc(doc(db, 'assets', 'oldShared'), { ...webCard(BOB), name: MAP });
    });
  });

  it('as the web, the event form and the installed APK write them', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'assets', 'w1'), webCard(BOB)));
    await assertSucceeds(addDoc(collection(as(BOB), 'assets'), apkCard(BOB)));
    await assertSucceeds(addDoc(collection(as(BOB), 'assets'), {
      name: 'Event Image', category: 'Uncategorized', categories: ['Uncategorized'],
      imageUrl: 'https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/events%2Fuid-bob%2F1_x.jpg?alt=media&token=ab-1',
      ownerId: BOB, createdAt: DAY, sharedGroupId: G1, sharedWithFamily: true,
    }));
    await assertSucceeds(setDoc(doc(as(BOB), 'assets', 'w2'), {
      ...webCard(BOB), name: long(20000), category: long(5000), barcodeValue: long(7089), categories: [],
    }));
    await assertSucceeds(setDoc(doc(as(BOB), 'assets', 'w3'), {
      ...webCard(BOB), imageUrl: long(4096), barcodeFormat: long(64), categories: Array.from({ length: 300 }, (_, i) => `c${i}`),
    }));
    for (const format of SCANNER_FORMATS) {
      await assertSucceeds(setDoc(doc(as(BOB), 'assets', `f-${format}`), { ...webCard(BOB), barcodeFormat: format }));
    }
  });

  it.each(BAD_CARD_FIELDS)('created, not with %s = %j', async (field, value) => {
    await fails(setDoc(doc(as(BOB), 'assets', 'w'), { ...webCard(BOB), [field]: value }));
  });

  it.each(BAD_CARD_FIELDS)('edited, not into %s = %j', async (field, value) => {
    await fails(updateDoc(doc(as(BOB), 'assets', 'c'), { [field]: value }));
  });

  it('an old card is judged only on what an edit changes; the Wallet re-sends every field and passes', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'assets', 'old'), { sharedGroupId: null, sharedWithFamily: false }));
    // Wallet.tsx sends the same nine keys on every edit, the unchanged ones as stored.
    await assertSucceeds(updateDoc(doc(as(BOB), 'assets', 'old'), {
      lastWriteId: 'op-2', name: 'Fixed', categories: 'x', category: 'Shopping', imageUrl: null,
      sharedGroupId: null, sharedWithFamily: false, barcodeValue: MAP, barcodeFormat: 'EAN_13',
    }));
    await fails(updateDoc(doc(as(BOB), 'assets', 'old'), { name: { b: 2 } }));
  });

  it('an old card reaches a group only with what the group could write: sharing it judges every field', async () => {
    // What the event form and the details window write to share a card (shareFieldsFor).
    await fails(updateDoc(doc(as(BOB), 'assets', 'oldPrivate'), { sharedGroupId: G1, sharedWithFamily: true }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'assets', 'oldPrivate'), { sharedGroupId: G1, sharedWithFamily: true, name: 'Fixed' }));
    // And from one group to another.
    await fails(updateDoc(doc(as(BOB), 'assets', 'oldShared'), { sharedGroupId: G3, sharedWithFamily: true }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'assets', 'oldShared'), { sharedGroupId: G3, sharedWithFamily: true, name: 'Fixed' }));
  });
});

// ── Expenses ────────────────────────────────────────────────────────────────────────────────────

const webExpense = (who: string) => ({
  amount: 25, description: 'Groceries', paidBy: who, ownerId: who, groupId: G1, splitAmong: [ALICE, BOB], createdAt: serverTimestamp(),
});

describe('an expense’s description is text', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'expenses', 'x'), { ...webExpense(BOB), createdAt: new Date(DAY) });
      await setDoc(doc(db, 'expenses', 'old'), { ...webExpense(BOB), description: MAP, createdAt: new Date(DAY) });
    });
  });

  it('as the web writes it, up to 200 characters, or none', async () => {
    await assertSucceeds(addDoc(collection(as(BOB), 'expenses'), webExpense(BOB)));
    await assertSucceeds(addDoc(collection(as(BOB), 'expenses'), { ...webExpense(BOB), description: long(200) }));
    await assertSucceeds(addDoc(collection(as(BOB), 'expenses'), { ...webExpense(BOB), description: '   ' }));
    const { description, ...none } = webExpense(BOB);
    void description;
    await assertSucceeds(addDoc(collection(as(BOB), 'expenses'), none));
  });

  it.each([[MAP], [5], [null], [['x']], [long(201)]])('created, not as %j', async (value) => {
    await fails(addDoc(collection(as(BOB), 'expenses'), { ...webExpense(BOB), description: value }));
  });

  it.each([[MAP], [5], [null], [long(201)]])('edited, not into %j', async (value) => {
    await fails(updateDoc(doc(as(BOB), 'expenses', 'x'), { description: value }));
  });

  it('an old row is judged only when its description changes, and changing it repairs it', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'expenses', 'old'), { amount: 26 }));
    await assertSucceeds(updateDoc(doc(as(BOB), 'expenses', 'old'), { description: 'Groceries' }));
  });
});
