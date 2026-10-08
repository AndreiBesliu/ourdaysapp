// src/utils/eventShape.test.ts
//
// What an event's shown fields may hold, said three times — the app (eventShape.ts), the rules
// (`eventFieldsOk`) and the server's own door (`createEventOverride`, through the copy of this module)
// — and held to one meaning here (08.10.2026).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  EVENT_DATE, EVENT_DESCRIPTION_MAX, EVENT_EMOJI_MAX, EVENT_JUDGED_FIELDS, EVENT_LABEL_MAX, EVENT_LOCATION_MAX,
  EVENT_TIME, EVENT_TITLE_MAX, clampText, eventFieldOk, eventFieldProblem,
} from './eventShape';
import { ASSET_NAME_MAX } from './walletAsset';

const MAP = { a: 1 };
const POISON = { toString: 0 };
const long = (n: number) => 'x'.repeat(n);

describe('a field the app writes passes, one it never writes does not', () => {
  it.each([
    ['title', 'Dinner'], ['title', ''], ['title', long(EVENT_TITLE_MAX * 40)],
    ['emoji', '\u{1F37D}️'], ['emoji', null], ['emoji', undefined],
    ['description', ''], ['description', long(EVENT_DESCRIPTION_MAX * 20)], ['location', null], ['location', long(EVENT_LOCATION_MAX * 20)],
    ['time', '00:00'], ['time', '23:59'], ['time', null], ['endTime', '09:30'],
    ['date', '2026-10-08T00:00:00.000Z'], ['date', '2026-09-24T09:00:00.000Z'], ['date', '2026-10-08'], ['date', '2026-10-08T21:00:00Z'],
    ['checklistItems', []], ['recurrenceExceptions', ['2026-10-08']], ['recurrenceRule', { frequency: 'daily', onlyOn: 'weekdays' }],
    ['taskStatus', 'not-started'], ['color', '#3b82f6'], ['categoryId', 'family_time'], ['timezone', 'America/Argentina/Buenos_Aires'],
    ['reminderMinutes', 15], ['reminderMinutes', null],
    ['anythingElse', MAP],
  ])('%s = %j', (field, value) => {
    expect(eventFieldOk(field, value)).toBe(true);
  });

  it.each([
    ['title', MAP], ['title', POISON], ['title', 7], ['title', null],
    ['emoji', MAP], ['emoji', long(EVENT_EMOJI_MAX + 1)], ['description', ['x']], ['location', 5],
    ['time', '9:00'], ['time', '24:00'], ['time', MAP], ['endTime', 930],
    ['date', MAP], ['date', 'garbage'], ['date', '2026-13-01'], ['date', '2026-10-32'], ['date', '2026-10-08T00:00:00+02:00'],
    ['date', ' 2026-10-08'], ['date', null], ['date', undefined], ['date', '2026-10-08T24:30:00.000Z'],
    ['checklistItems', 'bread'], ['recurrenceExceptions', MAP], ['recurrenceRule', 'daily'], ['recurrenceRule', ['daily']],
    ['taskStatus', MAP], ['color', long(EVENT_LABEL_MAX + 1)], ['categoryId', 5], ['timezone', true],
    ['reminderMinutes', '15'], ['reminderMinutes', POISON],
  ])('not %s = %j', (field, value) => {
    expect(eventFieldOk(field, value)).toBe(false);
  });

  it('only the fields an event carries are judged, in order', () => {
    expect(eventFieldProblem({})).toBeNull();
    expect(eventFieldProblem({ title: 'x', rsvps: MAP, visibleTo: 'x' })).toBeNull();
    expect(eventFieldProblem({ title: 'x', emoji: MAP, date: MAP })).toBe('emoji');
    // Own keys only: a prototype's are not the event's.
    expect(eventFieldProblem(Object.create({ title: MAP }))).toBeNull();
  });

  it('every date the regex takes is one a browser can draw', () => {
    for (const d of ['2026-02-31', '2026-04-31T23:59:59Z', '0000-01-01', '9999-12-31T23:59:59.999Z']) {
      expect(EVENT_DATE.test(d), d).toBe(true);
      expect(Number.isNaN(new Date(d).getTime()), d).toBe(false);
    }
  });

  it('a card made from an event’s title holds the whole title', () => {
    expect(ASSET_NAME_MAX).toBeGreaterThanOrEqual(EVENT_TITLE_MAX);
  });
});

describe('the rules say the same', () => {
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n');
  const fn = rules.slice(rules.indexOf('function eventFieldsOk('), rules.indexOf('function assetFieldsOk('));
  const limitOf = (field: string) => {
    const m = new RegExp(`keys\\.hasAny\\(\\['${field}'\\]\\) \\|\\| ev(?:Opt)?Text\\(d\\.get\\('${field}', null\\), (\\d+)\\)`).exec(fn);
    expect(m, field).not.toBeNull();
    return Number(m![1]);
  };

  it('the same numbers', () => {
    expect(limitOf('emoji')).toBe(EVENT_EMOJI_MAX);
    for (const f of ['taskStatus', 'color', 'categoryId', 'timezone']) expect(limitOf(f), f).toBe(EVENT_LABEL_MAX);
  });

  it('and no length on the free text the installed APK writes without a limit (only the web form has one)', () => {
    expect(fn).toContain("(!keys.hasAny(['title']) || d.get('title', null) is string)");
    expect(fn).toContain("(!keys.hasAny(['description']) || d.get('description', null) == null || d.description is string)");
    expect(fn).toContain("(!keys.hasAny(['location']) || d.get('location', null) == null || d.location is string)");
  });

  it('the same fields', () => {
    const judged = [...fn.matchAll(/keys\.hasAny\(\['([A-Za-z]+)'\]\)/g)].map((m) => m[1]);
    expect(judged).toEqual([...EVENT_JUDGED_FIELDS]);
  });

  it('the same time and day (the rules match the whole string, the app anchors both ends)', () => {
    expect(rules).toContain(`v.matches('${EVENT_TIME.source.slice(1, -1)}')`);
    expect(fn).toContain(`d.date.matches('${EVENT_DATE.source.slice(1, -1)}')`);
  });

  it('a group create is judged on every key, an edit on what it changes or everything when it enters a group', () => {
    const block = rules.slice(rules.indexOf('match /events/{eventId}'), rules.indexOf('match /games/{gameId}'));
    const create = block.slice(block.indexOf('allow create:'), block.indexOf('allow update:'));
    const update = block.slice(block.indexOf('allow update:'), block.indexOf('allow delete:'));
    expect(create).toContain("eventFieldsOk(request.resource.data, request.resource.data.keys())");
    expect(update).toContain('? request.resource.data.keys()\n             : request.resource.data.diff(resource.data).affectedKeys())');
  });
});

describe('the server’s door uses it', () => {
  const index = readFileSync('functions/src/index.ts', 'utf8');
  it('createEventOverride refuses what is not of the app’s kind before writing anything', () => {
    const body = index.slice(index.indexOf('export const createEventOverride'), index.indexOf('// ── Group teardown ──'));
    const check = body.indexOf('const shapeProblem = eventFieldProblem(safe);');
    expect(check).toBeGreaterThan(body.indexOf('for (const key of OVERRIDE_FIELDS)'));
    expect(check).toBeLessThan(body.indexOf('db.runTransaction'));
  });

  it('the AI checklist and the Admin screen read an event’s text only as text', () => {
    expect(index).toContain('const title = typeof data.title === "string" ? data.title : "";');
    expect(index).toContain('const description = typeof data.description === "string" ? data.description : "";');
    expect(index).toContain('title: typeof e.title === "string" && e.title ? e.title : "(untitled)",');
    expect(index).toContain('taskStatus: typeof e.taskStatus === "string" && e.taskStatus ? e.taskStatus : null,');
  });
});

describe('clampText', () => {
  it('cuts to whole characters within the limit, and leaves shorter text alone', () => {
    expect(clampText('abc', 5)).toBe('abc');
    expect(clampText('abcdef', 3)).toBe('abc');
    expect(clampText('ab\u{1F37D}', 3)).toBe('ab');
    expect(clampText('ab\u{1F37D}', 4)).toBe('ab\u{1F37D}');
  });
});
