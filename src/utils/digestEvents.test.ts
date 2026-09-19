// src/utils/digestEvents.test.ts
//
// The group digest's event section had no test at all, and that is most of the reason it was
// wrong three ways for as long as it was: it produces one paragraph of generated prose, so an
// event that never reached the model looks exactly like an event nobody had.
//
// These tests are therefore written as the failures, not as the feature. Each one names the
// event that used to vanish.

import { describe, it, expect } from 'vitest';
import {
  digestWindow, digestEventLines, DIGEST_SPAN_LOOKBACK_DAYS,
} from '../../functions/src/digestEvents';
import type { EventDoc } from '../../functions/src/recurrenceServer';

const G = 'group-1';
const ev = (over: Partial<EventDoc> & { id: string }): EventDoc =>
  ({ groupId: G, title: 'Something', ...over }) as EventDoc;

const day = (d: string) => `${d}T00:00:00.000Z`;

describe('the window the digest asks about', () => {
  it('starts at MIDNIGHT today, not at this instant', () => {
    // The whole first defect in one assertion. The old lower bound was the current instant, so
    // `date >= now` excluded every event dated today from the moment the clock passed midnight —
    // in a section headed "Next 7 days".
    const w = digestWindow('2026-09-19T14:32:11.123Z');
    expect(w?.fromDay).toBe('2026-09-19');
    expect(w?.scanTo).toBe('2026-09-26T23:59:59.999Z');
    expect(w?.toDay).toBe('2026-09-26');
  });

  it('fetches from BEFORE the window, so an event already under way can be found', () => {
    const w = digestWindow('2026-09-19T00:00:00.000Z');
    expect(w?.scanFrom).toBe('2026-08-20T00:00:00.000Z');
    // The distance is the named constant, not a number that happens to match today.
    const from = Date.parse(w!.scanFrom);
    const at = Date.parse(day(w!.fromDay));
    expect(Math.round((at - from) / 86_400_000)).toBe(DIGEST_SPAN_LOOKBACK_DAYS);
  });

  it('crosses a month and a year end without arithmetic of its own', () => {
    expect(digestWindow('2026-12-28T09:00:00.000Z')?.toDay).toBe('2027-01-04');
    expect(digestWindow('2028-02-26T09:00:00.000Z')?.toDay).toBe('2028-03-04');
  });

  it('refuses rather than guessing when it is handed something that is not an instant', () => {
    expect(digestWindow('')).toBeNull();
    expect(digestWindow('nope')).toBeNull();
    expect(digestWindow(undefined as unknown as string)).toBeNull();
  });
});

describe('which events end up in front of the model', () => {
  const w = digestWindow('2026-09-19T14:32:11.123Z')!;

  it("includes today's — the one the old bounds could never return", () => {
    const { lines } = digestEventLines([ev({ id: 'a', date: day('2026-09-19') })], G, w);
    expect(lines).toEqual(['- Something on 2026-09-19']);
  });

  it('includes a series that STARTED months ago, on the day it next falls', () => {
    // Defect two. A repeating event is one document dated when the series began, so a weekly
    // dinner from March matched no September window and never appeared at all.
    const weekly = ev({
      id: 'r', title: 'Dinner', date: day('2026-03-06'),
      recurrenceRule: { frequency: 'weekly' },
    });
    const { lines } = digestEventLines([weekly], G, w);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain('Dinner');
    // A weekly series inside an eight-day window falls either once or twice, never more.
    expect(lines.length).toBeLessThanOrEqual(2);
    // And on a day IN the window, never on the parent's March date.
    for (const line of lines) expect(line).not.toContain('2026-03');
  });

  it('includes a multi-day event that began before the window and is still running', () => {
    // Defect three, and the reason the fetch reaches back at all.
    const trip = ev({ id: 's', title: 'Trip', date: day('2026-09-15'), endDayOffset: 6 });
    const { lines } = digestEventLines([trip], G, w);
    expect(lines).toContain('- Trip on 2026-09-15');
  });

  it('drops a document that was only fetched because the query could not be scoped', () => {
    // The recurring-parent query is not scoped by group — the composite index for that is
    // refused on live. Widening a query for an indexing reason must not widen the ANSWER.
    const foreign = ev({ id: 'x', title: 'Not ours', groupId: 'group-2', date: day('2026-09-20') });
    const mine = ev({ id: 'y', title: 'Ours', date: day('2026-09-20') });
    const { lines } = digestEventLines([foreign, mine], G, w);
    expect(lines).toEqual(['- Ours on 2026-09-20']);
  });

  it('drops a personal event with no group at all', () => {
    const personal = ev({ id: 'p', title: 'Mine', groupId: undefined, date: day('2026-09-20') });
    expect(digestEventLines([personal], G, w).lines).toEqual([]);
  });

  it('drops the documents fetched only because they might have reached the window', () => {
    const past = ev({ id: 'o', title: 'Over', date: day('2026-08-25') });
    const later = ev({ id: 'l', title: 'Later', date: day('2026-10-30') });
    expect(digestEventLines([past, later], G, w).lines).toEqual([]);
  });

  it('puts them in date order, however they arrived', () => {
    const docs = [
      ev({ id: '3', title: 'Third', date: day('2026-09-24') }),
      ev({ id: '1', title: 'First', date: day('2026-09-19') }),
      ev({ id: '2', title: 'Second', date: day('2026-09-21') }),
    ];
    expect(digestEventLines(docs, G, w).lines).toEqual([
      '- First on 2026-09-19',
      '- Second on 2026-09-21',
      '- Third on 2026-09-24',
    ]);
  });

  it('says so when it cut the list, instead of shortening the answer quietly', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      ev({ id: `n${i}`, title: `E${i}`, date: day('2026-09-20') }));
    const cut = digestEventLines(docs, G, w, 3);
    expect(cut.lines).toHaveLength(3);
    expect(cut.truncated).toBe(true);
    // ...and does NOT claim a cut when everything fitted. A flag that is always true is no flag.
    expect(digestEventLines(docs, G, w, 5).truncated).toBe(false);
  });

  it('keeps the edited occurrence and not its ghost, when a series was overridden', () => {
    const weekly = ev({
      id: 'r', title: 'Dinner', date: day('2026-09-19'),
      recurrenceRule: { frequency: 'weekly' },
    });
    const edited = ev({
      id: 'r-2026-09-26', title: 'Dinner, later', date: day('2026-09-26'),
      overrideOfParent: 'r',
    });
    const { lines } = digestEventLines([weekly, edited], G, w);
    expect(lines).toContain('- Dinner, later on 2026-09-26');
    expect(lines).not.toContain('- Dinner on 2026-09-26');
  });

  it('names an untitled event rather than writing the word undefined at the model', () => {
    const { lines } = digestEventLines([ev({ id: 'u', title: undefined, date: day('2026-09-20') })], G, w);
    expect(lines).toEqual(['- (untitled) on 2026-09-20']);
  });
});
