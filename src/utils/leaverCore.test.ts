// src/utils/leaverCore.test.ts
//
// Somebody out of a group comes off its events still to come (functions/src/leaverCore.ts; Andrei,
// 05.10.2026). Which events count as still to come, and what comes off one. "Today" is passed in,
// never read from the clock.

import { describe, it, expect } from 'vitest';
import { AI_ASSIGNEE, earliestTodayOf, lastDayOf, leaverPlan, stillToCome } from '../../functions/src/leaverCore';

// The day it still is in the westernmost zone (earliestTodayOf), which is what the sweep passes.
const TODAY = '2026-10-05';
const at = (day: string) => `${day}T00:00:00.000Z`;
const ANA = 'uid-ana', BOB = 'uid-bob', GONE = 'uid-gone';
const MEMBERS = new Set([ANA, BOB]);

describe('earliestTodayOf', () => {
  it('the day it still is at UTC−12: yesterday until noon UTC (14:00 or 15:00 in Bucharest)', () => {
    expect(earliestTodayOf(Date.UTC(2026, 9, 5, 22, 0))).toBe('2026-10-05'); // 01:00 on the 6th in Bucharest
    expect(earliestTodayOf(Date.UTC(2026, 9, 6, 11, 59))).toBe('2026-10-05');
    expect(earliestTodayOf(Date.UTC(2026, 9, 6, 12, 0))).toBe('2026-10-06');
  });
});

describe('stillToCome', () => {
  it('a one-day event counts while its day is not over everywhere, and not after', () => {
    expect(stillToCome({ date: at('2026-10-09') }, TODAY)).toBe(true);
    expect(stillToCome({ date: at(TODAY) }, TODAY)).toBe(true);
    expect(stillToCome({ date: at('2026-10-04') }, TODAY)).toBe(false);
  });

  it('an event over several days counts until its last day', () => {
    expect(stillToCome({ date: at('2026-09-28'), endDayOffset: 7 }, TODAY)).toBe(true); // ends on the 5th
    expect(stillToCome({ date: at('2026-09-28'), endDayOffset: 6 }, TODAY)).toBe(false); // ends on the 4th
    // A span past the form's limit (366 days) is no span: applied, it would make last year's event current.
    expect(stillToCome({ date: at('2026-09-01'), endDayOffset: 400 }, TODAY)).toBe(false);
  });

  it('a series counts until its last occurrence, which the horizon sets', () => {
    // Weekly: 52 weeks from the start. Started 100 days ago: still running.
    expect(stillToCome({ date: at('2026-06-27'), recurrenceRule: { frequency: 'weekly' } }, TODAY)).toBe(true);
    // Daily: 30 days. Started 40 days ago: over 10 days ago.
    expect(lastDayOf({ date: at('2026-08-26'), recurrenceRule: { frequency: 'daily' } })).toBe('2026-09-25');
    expect(stillToCome({ date: at('2026-08-26'), recurrenceRule: { frequency: 'daily' } }, TODAY)).toBe(false);
    // Yearly: 5 years. Started six years ago: over.
    expect(stillToCome({ date: at('2020-10-01'), recurrenceRule: { frequency: 'yearly' } }, TODAY)).toBe(false);
    // An unknown frequency is a one-off event on its day.
    expect(stillToCome({ date: at('2026-06-27'), recurrenceRule: { frequency: 'hourly' } }, TODAY)).toBe(false);
  });

  it('a weekdays-only series ends on its last weekday, not on the horizon', () => {
    // From Thursday 8 October 2026 the horizon is Saturday 7 November; the last occurrence is Friday the 6th.
    expect(lastDayOf({ date: at('2026-10-08'), recurrenceRule: { frequency: 'daily', onlyOn: 'weekdays' } })).toBe('2026-11-06');
  });

  it('a date it cannot read counts as to come: a stale name left frozen is what this exists to stop', () => {
    expect(stillToCome({}, TODAY)).toBe(true);
    expect(stillToCome({ date: 'soon' }, TODAY)).toBe(true);
    expect(stillToCome({ date: 12 }, TODAY)).toBe(true);
  });
});

describe('leaverPlan', () => {
  const upcoming = { date: at('2026-10-10') };

  it('takes off whoever is not a member, as an assignee and as an RSVP, and nobody else', () => {
    const plan = leaverPlan({
      ...upcoming,
      assigneeIds: [ANA, GONE, AI_ASSIGNEE],
      rsvps: { [ANA]: 'yes', [GONE]: 'no' },
      hiddenFrom: [GONE],
    }, MEMBERS, TODAY);
    expect(plan).toEqual({ unassign: [GONE], rsvps: [GONE] });
  });

  it('the single assignee field passes to the next one left on the list, or to nobody', () => {
    expect(leaverPlan({ ...upcoming, assigneeIds: [GONE, BOB], assigneeId: GONE }, MEMBERS, TODAY))
      .toEqual({ unassign: [GONE], rsvps: [], assigneeId: BOB });
    expect(leaverPlan({ ...upcoming, assigneeIds: [GONE], assigneeId: GONE }, MEMBERS, TODAY))
      .toEqual({ unassign: [GONE], rsvps: [], assigneeId: null });
    // An older document with the single field only.
    expect(leaverPlan({ ...upcoming, assigneeId: GONE }, MEMBERS, TODAY))
      .toEqual({ unassign: [], rsvps: [], assigneeId: null });
    // A member in the single field stays, whatever happens to the list.
    expect(leaverPlan({ ...upcoming, assigneeIds: [ANA, GONE], assigneeId: ANA }, MEMBERS, TODAY))
      .toEqual({ unassign: [GONE], rsvps: [] });
  });

  it('several who left, and a name twice on the list, each once', () => {
    expect(leaverPlan({ ...upcoming, assigneeIds: [GONE, 'uid-gone-2', GONE] }, MEMBERS, TODAY))
      .toEqual({ unassign: [GONE, 'uid-gone-2'], rsvps: [] });
  });

  it('nothing on an event that is over, or that names nobody who left', () => {
    expect(leaverPlan({ date: at('2026-09-01'), assigneeIds: [GONE], rsvps: { [GONE]: 'yes' } }, MEMBERS, TODAY)).toBeNull();
    expect(leaverPlan({ ...upcoming, assigneeIds: [ANA, AI_ASSIGNEE], assigneeId: AI_ASSIGNEE, rsvps: { [BOB]: 'yes' } }, MEMBERS, TODAY)).toBeNull();
    expect(leaverPlan({ ...upcoming }, MEMBERS, TODAY)).toBeNull();
  });

  it('the owner who left comes off as an assignee too (that the event stays theirs is held on the emulator)', () => {
    expect(leaverPlan({ ...upcoming, ownerId: GONE, assigneeIds: [GONE] }, MEMBERS, TODAY))
      .toEqual({ unassign: [GONE], rsvps: [] });
  });

  it('a malformed list or answers map is read as empty, never as names', () => {
    expect(leaverPlan({ ...upcoming, assigneeIds: 'uid-gone', rsvps: [GONE] }, MEMBERS, TODAY)).toBeNull();
    expect(leaverPlan({ ...upcoming, assigneeIds: [null, 3, '', GONE] }, MEMBERS, TODAY)).toEqual({ unassign: [GONE], rsvps: [] });
  });
});
