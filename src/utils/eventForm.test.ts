// src/utils/eventForm.test.ts
//
// The form has FOUR write paths — edit-load, the localStorage draft, the debounced autosave and
// submit — and this decides what all four store. It is the one piece of the form that can be run
// without a login, so it is the piece that gets tested.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formSpan, SPAN_MESSAGE_KEY } from './eventForm';
import { endFieldsFor, MAX_SPAN_DAYS, dayPlus, dayOf, spanOf, isValidTime } from './eventTime';

const form = (over: Partial<Parameters<typeof formSpan>[0]> = {}) => formSpan({
  startDay: '2026-09-15', endDay: '', startTime: '', endTime: '', showEnd: false, ...over,
});

describe('with the end row closed, which is how every event has been saved so far', () => {
  it('stores no span and refuses nothing', () => {
    expect(form()).toEqual({ offset: 0, issue: null });
    expect(form({ startTime: '19:00' })).toEqual({ offset: 0, issue: null });
  });

  it('ignores end fields left behind from before it was closed', () => {
    // Closing the row is a complete answer, not a half-remembered one.
    expect(form({ endDay: '2026-09-20', endTime: '18:00', startTime: '19:00' }))
      .toEqual({ offset: 0, issue: null });
  });

  it('writes nothing for the end, so the document looks untouched', () => {
    const { offset } = form({ startTime: '19:00' });
    expect(endFieldsFor(offset, '', true)).toEqual({ endDayOffset: null, endTime: null });
  });
});

describe('a same-day end', () => {
  it('is accepted when it is after the start', () => {
    expect(form({ showEnd: true, endDay: '2026-09-15', startTime: '09:00', endTime: '11:30' }))
      .toEqual({ offset: 0, issue: null });
  });

  it('is refused when it is before the start', () => {
    expect(form({ showEnd: true, endDay: '2026-09-15', startTime: '19:00', endTime: '18:00' }))
      .toEqual({ offset: 0, issue: 'ends-before-start' });
  });

  it('is refused when it equals the start, because that is not a span', () => {
    expect(form({ showEnd: true, endDay: '2026-09-15', startTime: '19:00', endTime: '19:00' }).issue)
      .toBe('ends-before-start');
  });
});

describe('an end on a later day', () => {
  it('turns the date into whole days', () => {
    expect(form({ showEnd: true, endDay: '2026-09-17', startTime: '10:00', endTime: '16:00' }))
      .toEqual({ offset: 2, issue: null });
  });

  it('accepts a clock earlier than the start, which is the whole point', () => {
    // 22:00 on the 15th until 02:00 on the 16th.
    expect(form({ showEnd: true, endDay: '2026-09-16', startTime: '22:00', endTime: '02:00' }))
      .toEqual({ offset: 1, issue: null });
  });

  it('accepts an all-day span, with no clocks at all', () => {
    expect(form({ showEnd: true, endDay: '2026-09-17' })).toEqual({ offset: 2, issue: null });
  });

  it('refuses an end date before the start date', () => {
    expect(form({ showEnd: true, endDay: '2026-09-14' }))
      .toEqual({ offset: 0, issue: 'ends-before-start' });
  });

  it('refuses a span past the cap, and says so differently', () => {
    const tooFar = dayPlus('2026-09-15', MAX_SPAN_DAYS + 1)!;
    expect(form({ showEnd: true, endDay: tooFar })).toEqual({ offset: 0, issue: 'offset' });
    // The last legal day is still accepted.
    expect(form({ showEnd: true, endDay: dayPlus('2026-09-15', MAX_SPAN_DAYS)! }).offset).toBe(MAX_SPAN_DAYS);
  });

  it('refuses an end time on an event with no start time', () => {
    expect(form({ showEnd: true, endDay: '2026-09-16', endTime: '18:00' }))
      .toEqual({ offset: 0, issue: 'end-without-start' });
  });
});

describe('the end row open but nothing filled in', () => {
  it('is not an error — the person is still typing', () => {
    expect(form({ showEnd: true, endDay: '' })).toEqual({ offset: 0, issue: null });
    expect(form({ showEnd: true, endDay: '', startTime: '19:00' })).toEqual({ offset: 0, issue: null });
  });
});

describe('an unsavable span stores nothing rather than something wrong', () => {
  it('reports offset 0 for every refusal', () => {
    for (const bad of [
      { showEnd: true, endDay: '2026-09-14' },
      { showEnd: true, endDay: '2026-09-16', endTime: '18:00' },
      { showEnd: true, endDay: '2026-09-15', startTime: '19:00', endTime: '18:00' },
    ]) {
      const r = form(bad);
      expect(r.issue).not.toBeNull();
      expect(r.offset).toBe(0);
    }
  });
});

describe('every refusal has a word for it', () => {
  it('names an existing message key for each', () => {
    for (const k of ['ends-before-start', 'end-without-start', 'offset'] as const) {
      expect(SPAN_MESSAGE_KEY[k]).toMatch(/^event/);
    }
    expect(new Set(Object.values(SPAN_MESSAGE_KEY)).size).toBe(3);
  });
});

describe('opening an event and saving it unchanged keeps its length', () => {
  // The defect this pins, found by an adversarial review and then measured: the form read the
  // START day by formatting the stored midnight-UTC instant LOCALLY, while the END day came from
  // spanOf, which reads it in UTC. West of Greenwich those differ by a day — proven: the local day
  // of 2026-09-20T00:00:00Z is the 19th in New York and Los Angeles, the 20th in Bucharest. The
  // offset stored is the difference between the two, so a three-day trip saved as four, then five,
  // then six — and the debounced autosave writes a second after opening, with no gesture at all.
  //
  // Both sides read UTC now, which is why this is a fixed point rather than a ratchet. It is also
  // why this test cannot be fooled by the runner's timezone: there is no local formatting left in
  // the path it exercises.

  /** What the form fields hold after an event is loaded into them. */
  const prefill = (ev: Record<string, unknown>) => {
    const span = spanOf(ev)!;
    const hasSpan = span.offset > 0 || !!span.endTime;
    return {
      startDay: dayOf(ev.date as string)!,
      endDay: hasSpan ? span.endDay : '',
      startTime: isValidTime(ev.time) ? (ev.time as string) : '',
      endTime: hasSpan && span.endTime ? span.endTime : '',
      showEnd: hasSpan,
    };
  };

  /** One open-then-save cycle, returning the document as it would be written back. */
  const cycle = (ev: Record<string, unknown>) => {
    const fields = prefill(ev);
    const { offset, issue } = formSpan(fields);
    expect(issue).toBeNull();
    return { ...ev, ...endFieldsFor(offset, fields.endTime, !!fields.startTime) };
  };

  it('is stable over repeated opens, which is where the ratchet showed', () => {
    let ev: Record<string, unknown> = {
      date: '2026-09-20T00:00:00.000Z', time: '09:00', endDayOffset: 2, endTime: '17:00',
    };
    for (let i = 0; i < 5; i++) {
      ev = cycle(ev);
      expect(ev.endDayOffset).toBe(2);
      expect(ev.endTime).toBe('17:00');
    }
  });

  it('is stable for an all-day span, which has no clocks to hide behind', () => {
    let ev: Record<string, unknown> = { date: '2026-09-20T00:00:00.000Z', endDayOffset: 3 };
    for (let i = 0; i < 3; i++) {
      ev = cycle(ev);
      expect(ev.endDayOffset).toBe(3);
      expect(ev.endTime).toBeNull();
    }
  });

  it('leaves a single-day event with no span fields at all, however often it is opened', () => {
    let ev: Record<string, unknown> = { date: '2026-09-20T00:00:00.000Z', time: '09:00' };
    for (let i = 0; i < 3; i++) {
      ev = cycle(ev);
      expect(ev.endDayOffset).toBeNull();
      expect(ev.endTime).toBeNull();
    }
  });

  it('is stable across a month boundary and a DST change', () => {
    for (const start of ['2026-03-28T00:00:00.000Z', '2026-10-24T00:00:00.000Z', '2026-01-30T00:00:00.000Z']) {
      let ev: Record<string, unknown> = { date: start, time: '22:00', endDayOffset: 2, endTime: '02:00' };
      for (let i = 0; i < 3; i++) {
        ev = cycle(ev);
        expect(ev.endDayOffset).toBe(2);
      }
    }
  });
});

describe('the form reads a stored day in UTC, checked in the source', () => {
  // The test above pins the HELPERS; it cannot see the component, so putting the local formatter
  // back into AddEventModal would leave it green while the ratchet returned. This looks at the
  // source instead — a weaker kind of net, and the right one for a defect whose whole character is
  // that nothing visible goes wrong until somebody notices their trip has grown a day.
  const SRC = readFileSync(join(process.cwd(), 'src/components/AddEventModal.tsx'), 'utf8');

  it('does not format the stored instant locally to fill the date field', () => {
    // `format(new Date(ev.date), 'yyyy-MM-dd')` is LOCAL: west of Greenwich a midnight-UTC instant
    // is the previous evening. `dayOf` reads the day the event is actually stored under.
    expect(SRC).not.toMatch(/setEventDate\(\s*editEvent\.date\s*\?\s*format\(/);
    expect(SRC).not.toMatch(/setEndDate\([^)]*format\(new Date\(/);
  });

  it('fills the date field from dayOf, and the end from spanOf', () => {
    expect(SRC).toMatch(/setEventDate\(dayOf\(editEvent\.date\)/);
    expect(SRC).toMatch(/setEndDate\(hasSpan \? span!\.endDay : ''\)/);
  });

  it('is looking at the file it thinks it is', () => {
    // Without this a moved file or a bad path would make every assertion above trivially true.
    expect(SRC.length).toBeGreaterThan(20000);
    expect(SRC).toContain('AddEventModal');
  });
});
