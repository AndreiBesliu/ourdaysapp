// rules-tests/bulkReadBothForms.test.ts
//
// Written by the mutation run of 17.10.2026: each case here kills a mutant the earlier tests let live.
//
// Killer for M26 and M27 (f3706d2, `bulkReadOk`): a PERSONAL event's create refuses a list AND a map
// in every field the server reads in bulk. bulk-read-fields.test.ts tries each field in one form only
// (the date only as a list, the time only as a map, ...), so it holds the shared `evScalar`, but not a
// field whose term loses half of it: `!(date is list)` let a map date through (a map can hold a list
// of a million nulls, the ~100 MB decode the commit exists to stop), and `!(time is map)` a list time.
// Runs from rules-tests/ (emu-run --into=rules-tests).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection } from 'firebase/firestore';
import { DAVE, as, resetWorld, startEnv, stopEnv } from './_harness';

beforeAll(async () => { await startEnv('demo-ourdays-mbulk-both-forms'); });
afterAll(stopEnv);
beforeEach(async () => { await resetWorld(); });

/** Refused by the rule itself, not by the ceiling of 1000 expressions a request may evaluate. */
async function fails(write: Promise<unknown>) {
  const err = await assertFails(write);
  expect(String((err as { message?: string })?.message ?? err)).not.toMatch(/maximum of 1000 expressions/);
}

const DAY = '2026-10-08T00:00:00.000Z';
/** A personal event as the web's form writes it, with every field the server reads in bulk. */
const personal = () => ({
  title: 'Dinner', description: '', checklistItems: [], categoryId: 'family_time', color: '#3b82f6', emoji: null,
  ownerId: DAVE, groupId: null, sharedWithFamily: false, imageUrl: null, isTask: false, taskStatus: 'none',
  assigneeIds: [DAVE], assigneeId: DAVE, assetId: null, hiddenFrom: [], rsvpEnabled: false, rsvps: {}, location: '',
  reminderMinutes: 15, time: '19:00', endTime: '21:00', endDayOffset: 0, timezone: 'Europe/Bucharest',
  recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' }, recurrenceExceptions: [], date: DAY, createdAt: DAY, updatedAt: DAY,
});

const LIST = [null, null];
const MAP = { v: [null] };
const FIELDS = ['title', 'date', 'time', 'timezone', 'reminderMinutes', 'endDayOffset', 'overrideOfParent', 'overrideDate'];

describe('a personal event is not created with a list or a map where the server reads in bulk', () => {
  it('the fixture itself passes', async () => {
    await assertSucceeds(addDoc(collection(as(DAVE), 'events'), personal()));
  });

  it.each(FIELDS.flatMap((f) => [[f, 'list', LIST], [f, 'map', MAP]] as [string, string, unknown][]))(
    'not %s as a %s', async (field, _form, value) => {
      await fails(addDoc(collection(as(DAVE), 'events'), { ...personal(), [field]: value }));
    });

  it.each([['frequency', 'list', LIST], ['frequency', 'map', MAP], ['onlyOn', 'list', LIST], ['onlyOn', 'map', MAP]] as [string, string, unknown][])(
    'not a rule whose %s is a %s', async (part, _form, value) => {
      await fails(addDoc(collection(as(DAVE), 'events'), { ...personal(), recurrenceRule: { frequency: 'daily', [part]: value } }));
    });
});
