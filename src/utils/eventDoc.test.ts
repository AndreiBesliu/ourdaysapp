// src/utils/eventDoc.test.ts
//
// An event as the screens may use it, and the places that read events through it (08.10.2026).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { eventImageSrc, normaliseEvent } from './eventDoc';
import { eventFieldProblem } from './eventShape';
import { expandRecurringEvents } from './recurrence';

const MAP = { a: 1 };
const POISON = { toString: 0 };
const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/our-days-2a939.firebasestorage.app/o/events%2Fu%2F1_x.jpg?alt=media&token=ab-1';

const good = {
  id: 'e', title: 'Dinner', emoji: '\u{1F37D}️', description: 'at home', location: 'Home', time: '19:00', endTime: '21:00',
  date: '2026-10-08T00:00:00.000Z', checklistItems: [{ id: '1', text: 'bread', isCompleted: true, assetUrl: null, assetId: null }],
  recurrenceExceptions: ['2026-10-15'], recurrenceRule: { frequency: 'weekly' }, taskStatus: 'none', color: null,
  categoryId: 'family_time', timezone: 'Europe/Bucharest', assigneeIds: ['a'], assigneeId: 'a', imageUrl: URL_OK,
  rsvps: { a: 'yes' }, hiddenFrom: [], ownerId: 'a', groupId: 'g', reminderMinutes: 15, assetId: null, sharedWithFamily: false,
  aiChecklist: { status: 'failed', reason: 'ai-checklist/quota', at: '2026-10-08T09:00:00.000Z' },
};

describe('an event as the screens may use it', () => {
  it('one the app wrote comes through as it was', () => {
    expect(normaliseEvent(good)).toEqual(good);
  });

  it('what a member could plant comes through as harmless kinds', () => {
    const got = normaliseEvent({
      id: 'e', title: MAP, emoji: POISON, description: ['x'], location: 5, time: '9:00', endTime: MAP, date: MAP,
      checklistItems: [null, 'x', { id: 7, text: MAP, isCompleted: 'yes', assetUrl: 5 }, { id: 'k', text: 'ok' }],
      recurrenceExceptions: MAP, recurrenceRule: 'weekly', taskStatus: MAP, color: 'x'.repeat(65), categoryId: 5,
      timezone: true, assigneeIds: 'a', assigneeId: MAP, imageUrl: MAP, rsvps: 'x', hiddenFrom: 'a',
      reminderMinutes: POISON, assetId: 5, sharedWithFamily: 'yes', aiChecklist: { status: 'failed', reason: POISON, at: MAP },
    });
    expect(got).toMatchObject({
      title: '', emoji: null, description: '', location: '', time: null, endTime: null,
      recurrenceExceptions: [], recurrenceRule: null, taskStatus: null, color: null, categoryId: null, timezone: null,
      assigneeIds: [], assigneeId: null, imageUrl: null, rsvps: {}, hiddenFrom: [],
      reminderMinutes: null, assetId: null, sharedWithFamily: false,
    });
    expect('date' in got).toBe(false);
    // The AI note keeps only what can be shown: its status, without a reason that is not text.
    expect(got.aiChecklist).toEqual({ status: 'failed' });
    expect('aiChecklist' in normaliseEvent({ id: 'e', aiChecklist: 'x' })).toBe(false);
    expect('aiChecklist' in normaliseEvent({ id: 'e', aiChecklist: { reason: 'x' } })).toBe(false);
    // Items that are objects stay, with text the list can show and an id React can key on.
    expect(got.checklistItems).toEqual([
      { id: 'item-2', text: '', isCompleted: false, assetUrl: null, assetId: null },
      { id: 'k', text: 'ok', isCompleted: false, assetUrl: null, assetId: null },
    ]);
    // And nothing it hands on is something the rules would refuse to have written back.
    expect(eventFieldProblem(got)).toBeNull();
    // Long text is kept as it is (the rules and the server take any length; only the form limits it),
    // so an edit never shortens a stored title behind anybody's back. What they do limit is shown empty.
    const long = normaliseEvent({ id: 'e', title: 'x'.repeat(5001), description: 'x'.repeat(50001), location: 'x'.repeat(3001), emoji: 'x'.repeat(17), reminderMinutes: Infinity });
    expect(eventFieldProblem(long)).toBeNull();
    expect(long).toMatchObject({ emoji: null, reminderMinutes: null });
    expect(long.title).toHaveLength(5001);
  });

  it('the answers are kept as stored: the answer buttons write the map back, and the rules judge every key of it', () => {
    const rsvps = { a: 'yes', b: MAP };
    expect(normaliseEvent({ id: 'e', rsvps }).rsvps).toBe(rsvps);
  });

  it('a link is kept for the edit form, and shown only if it is a Storage link', () => {
    expect(normaliseEvent({ id: 'e', imageUrl: 'https://evil.example/x.png' }).imageUrl).toBe('https://evil.example/x.png');
    expect(eventImageSrc({ imageUrl: 'https://evil.example/x.png' })).toBeNull();
    expect(eventImageSrc({ imageUrl: URL_OK })).toBe(URL_OK);
    expect(eventImageSrc(null)).toBeNull();
  });

  it('a day that reads but is not of the app’s form is kept; one that does not read is left out', () => {
    expect(normaliseEvent({ id: 'e', date: '2026-10-08T00:00:00+02:00' }).date).toBe('2026-10-08T00:00:00+02:00');
    expect('date' in normaliseEvent({ id: 'e', date: 'garbage' })).toBe(false);
    expect('date' in normaliseEvent({ id: 'e', date: 5 })).toBe(false);
  });

  it('absent stays absent where the app tells it from empty', () => {
    expect('hiddenFrom' in normaliseEvent({ id: 'e' })).toBe(false);
    // A legacy event with one assignee and no list: the edit form falls back to `assigneeId` only when
    // the list is missing, so an invented [] took the assignee off on the next autosave.
    const legacy = normaliseEvent({ id: 'e', assigneeId: 'bob' });
    expect('assigneeIds' in legacy).toBe(false);
    expect(legacy.assigneeId).toBe('bob');
  });

  it('a checklist item keeps only the five fields the app stores', () => {
    const [item] = normaliseEvent({
      id: 'e', checklistItems: [{ id: 'a', text: 'x', isCompleted: true, assetUrl: null, assetId: 'c', assetFile: { name: 'x' }, selectedAssetUrl: 'https://evil.example/p.png' }],
    }).checklistItems;
    expect(item).toEqual({ id: 'a', text: 'x', isCompleted: true, assetUrl: null, assetId: 'c' });
  });
});

describe('the calendar’s own computation no longer trips on a list that is not one', () => {
  it('a series whose exceptions are a map is expanded as if it had none', () => {
    const series = { id: 's', title: 'x', date: '2026-10-01T00:00:00.000Z', recurrenceRule: { frequency: 'daily' }, recurrenceExceptions: MAP };
    const days = expandRecurringEvents([series], new Date(2026, 9, 1), new Date(2026, 9, 3));
    expect(days.length).toBeGreaterThanOrEqual(2);
    const skipped = expandRecurringEvents([{ ...series, recurrenceExceptions: ['2026-10-02', 5] }], new Date(2026, 9, 1), new Date(2026, 9, 3));
    expect(skipped.map((e: { recurrenceDate?: string }) => e.recurrenceDate)).not.toContain('2026-10-02');
  });
});

describe('every place that reads events uses it', () => {
  const home = readFileSync('src/screens/CalendarHome.tsx', 'utf8');
  it.each([
    ['the group’s and my own events', 'eventBuckets.main[ev.id] = normaliseEvent(ev);'],
    ['the ones assigned to me', 'eventBuckets.assigned[ev.id] = normaliseEvent(ev);'],
    ['the grid and the day in a boundary that tries again on a tab switch', '<ErrorBoundary context="CalendarGrid" resetOn={activeGroupId}'],
    ['the details window', 'context="EventDetailsModal"\n        resetOn={selectedEvent?.id ?? null}'],
    ['the edit form', 'context="AddEventModal"\n        resetOn={`${isAddModalOpen}-${eventToEdit?.id ?? \'new\'}`}'],
    ['the overview', '<ErrorBoundary context="CalendarHome.overview" resetOn={overviewModalType}'],
    ['the leave dialog, tried again on the next open', 'context="LeaveGroupModal"\n        resetOn={isLeaveGroupModalOpen}'],
    ['the repeating events, the same', 'context="RecurringEventsPanel"\n        resetOn={isRecurringPanelOpen}'],
  ])('%s', (_label, line) => {
    expect(home.replace(/\r\n/g, '\n')).toContain(line);
  });

  it('the leave dialog reads through it', () => {
    expect(readFileSync('src/components/LeaveGroupModal.tsx', 'utf8')).toContain('snapshot.docs.map(d => normaliseEvent({ ...d.data(), id: d.id }))');
  });

  it('the repeating-events panel does not format a date it cannot read, nor group on a plain object', () => {
    const panel = readFileSync('src/components/RecurringEventsPanel.tsx', 'utf8');
    expect(panel).toContain("Number.isNaN(startDate.getTime()) ? '…' : format(startDate");
    // A frequency named like an Object.prototype member found a function on `{}` and `.push` threw.
    expect(panel).toContain('(ev: any) => ev.recurrenceRule && isFrequency(ev.recurrenceRule.frequency)');
    expect(panel).toContain('const grouped: Record<string, any[]> = Object.create(null);');
  });

  it('a checklist line’s photo is shown only if it is a Storage link, in the form and in the details', () => {
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    expect(form.split('item.selectedAssetUrl || storageUrlOrNull(item.assetUrl) ||').length - 1).toBe(2);
    const details = readFileSync('src/components/EventDetailsModal.tsx', 'utf8');
    expect(details).toContain('{storageUrlOrNull(item.assetUrl) && !item.isCompleted && (');
    expect(details).not.toMatch(/src=\{item\.assetUrl\}/);
  });

  it('a reminder "at the time of the event" (0) survives the normaliser and the edit form', () => {
    expect(normaliseEvent({ id: 'e', reminderMinutes: 0 }).reminderMinutes).toBe(0);
    // With `|| null` the form turned 0 into "no reminder", and its autosave, a second after the form
    // fills, wrote that back: opening the event removed its reminder for everybody (09.10.2026).
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    expect(form).toContain("applyReminder(typeof editEvent.reminderMinutes === 'number' ? editEvent.reminderMinutes : null);");
    expect(form).not.toMatch(/applyReminder\([^)]*reminderMinutes \|\| null\)/);
  });

  it('a draft saved before the limits is cut to them when restored (maxLength does not apply to code)', () => {
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    expect(form).toContain("setTitle(typeof parsed.title === 'string' ? clampText(parsed.title, EVENT_TITLE_MAX) : '');");
    expect(form).toContain("setDescription(typeof parsed.description === 'string' ? clampText(parsed.description, EVENT_DESCRIPTION_MAX) : '');");
    expect(form).toContain("setLocation(typeof parsed.location === 'string' ? clampText(parsed.location, EVENT_LOCATION_MAX) : '');");
  });

  it('the event windows show a photo only through eventImageSrc', () => {
    const details = readFileSync('src/components/EventDetailsModal.tsx', 'utf8');
    expect(details).toContain('{eventImageSrc(event) && (');
    expect(details).not.toMatch(/src=\{event\.imageUrl\}/);
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    expect(form).not.toMatch(/editEvent\?\.imageUrl \|\| ''/);
  });

  it('a move into a group takes the AI note off, as the rules require', () => {
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    expect(form).toContain("...((move === 'in' || move === 'across') && 'aiChecklist' in cur ? { aiChecklist: deleteField() } : {}),");
  });

  it('the form stops where the rules stop', () => {
    const form = readFileSync('src/components/AddEventModal.tsx', 'utf8');
    for (const cap of ['maxLength={EVENT_TITLE_MAX}', 'maxLength={EVENT_DESCRIPTION_MAX}', 'maxLength={EVENT_LOCATION_MAX}']) {
      expect(form, cap).toContain(cap);
    }
  });
});
