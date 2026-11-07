// src/utils/roadmap.test.ts
//
// The admin's roadmap (07.11.2026): what the server accepts (functions/src/roadmapCore.ts, tested where it is
// decided), the ordering the screen and the server share, and Claude's proposals (src/utils/roadmapProposals.ts),
// which must each pass the same check the server makes, or "Add" would be refused on screen.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PROPOSAL_ID, ROADMAP_AREAS, ROADMAP_LANES, ROADMAP_MAX_ITEMS, ROADMAP_NOTE_MAX, ROADMAP_RANK_MAX, ROADMAP_READ_MAX,
  ROADMAP_TITLE_MAX, cleanRoadmapFields, compareRoadmapItems, doneAtAfter, needsRespread, parseRoadmapEdit, planShift,
  rankAtEnd, rankBetween, shownLane, shownRank,
} from '../../functions/src/roadmapCore';
import { ROADMAP_PROPOSALS, dismissedProposals, openProposals } from './roadmapProposals';

const ok = { title: 'Shared lists', note: 'For the shop', area: 'calendar', lane: 'next', rank: 1 };

describe('cleanRoadmapFields: what an item may be', () => {
  it('a plain item is kept as given', () => {
    expect(cleanRoadmapFields(ok)).toEqual({ ok: true, value: ok });
  });

  it('text is cleaned, not cut: ends trimmed, a title on one line, a note keeps its lines', () => {
    const r = cleanRoadmapFields({ ...ok, title: '  Shared\t\n lists \u0007', note: ' line one\r\n\n\n\nline two\u0000 ' });
    expect(r).toMatchObject({ ok: true, value: { title: 'Shared lists', note: 'line one\n\nline two' } });
  });

  it('a missing note is an empty one; a note that is not text is refused', () => {
    for (const note of [undefined, null]) expect(cleanRoadmapFields({ ...ok, note })).toMatchObject({ ok: true, value: { note: '' } });
    expect(cleanRoadmapFields({ ...ok, note: 5 })).toMatchObject({ ok: false });
  });

  it('lengths are counted in characters, and over the limit is refused, never shortened', () => {
    const emoji = '\u{1F680}';
    expect(cleanRoadmapFields({ ...ok, title: emoji.repeat(ROADMAP_TITLE_MAX) })).toMatchObject({ ok: true });
    expect(cleanRoadmapFields({ ...ok, title: emoji.repeat(ROADMAP_TITLE_MAX + 1) })).toMatchObject({ ok: false });
    expect(cleanRoadmapFields({ ...ok, note: 'n'.repeat(ROADMAP_NOTE_MAX) })).toMatchObject({ ok: true });
    expect(cleanRoadmapFields({ ...ok, note: 'n'.repeat(ROADMAP_NOTE_MAX + 1) })).toMatchObject({ ok: false });
  });

  it('refuses a blank or missing title, an unknown area or lane, and a rank that is not a usable number', () => {
    for (const bad of [
      { ...ok, title: '   ' }, { ...ok, title: 7 }, { ...ok, title: undefined },
      { ...ok, area: 'shop' }, { ...ok, area: undefined }, { ...ok, lane: 'someday' }, { ...ok, lane: 'Done' },
      { ...ok, rank: Number.NaN }, { ...ok, rank: Infinity }, { ...ok, rank: '1' }, { ...ok, rank: ROADMAP_RANK_MAX * 2 },
      null, 'item',
    ]) {
      expect(cleanRoadmapFields(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    for (const area of ROADMAP_AREAS) expect(cleanRoadmapFields({ ...ok, area }), area).toMatchObject({ ok: true });
    for (const lane of ROADMAP_LANES) expect(cleanRoadmapFields({ ...ok, lane }), lane).toMatchObject({ ok: true });
  });
});

describe('parseRoadmapEdit: what the edit callable is asked', () => {
  it('each operation, with what it needs', () => {
    expect(parseRoadmapEdit({ op: 'create', fields: ok })).toEqual({ ok: true, value: { op: 'create', fields: ok } });
    expect(parseRoadmapEdit({ op: 'create', fields: ok, proposalId: 'storage-on-demand' }))
      .toEqual({ ok: true, value: { op: 'create', fields: ok, proposalId: 'storage-on-demand' } });
    expect(parseRoadmapEdit({ op: 'update', id: 'AbC123_-x', seen: 17, fields: ok })).toEqual({ ok: true, value: { op: 'update', id: 'AbC123_-x', seen: 17, fields: ok } });
    expect(parseRoadmapEdit({ op: 'update', id: 'a', seen: null, fields: ok })).toMatchObject({ ok: true, value: { seen: null } });
    expect(parseRoadmapEdit({ op: 'move', id: 'a', seen: 3, lane: 'done', rank: 2.5 })).toEqual({ ok: true, value: { op: 'move', id: 'a', seen: 3, lane: 'done', rank: 2.5 } });
    expect(parseRoadmapEdit({ op: 'reorder', lane: 'now', ids: ['a', 'b'] })).toEqual({ ok: true, value: { op: 'reorder', lane: 'now', ids: ['a', 'b'] } });
    expect(parseRoadmapEdit({ op: 'delete', id: 'abc' })).toEqual({ ok: true, value: { op: 'delete', id: 'abc' } });
    expect(parseRoadmapEdit({ op: 'dismiss', proposalId: 'p-1' })).toEqual({ ok: true, value: { op: 'dismiss', proposalId: 'p-1' } });
    expect(parseRoadmapEdit({ op: 'restore', proposalId: 'p-1' })).toEqual({ ok: true, value: { op: 'restore', proposalId: 'p-1' } });
  });

  it('an id that could be a path, or anything else, is refused before anything is read', () => {
    for (const id of ['a/b', '..', '.', '__x__', '', 'x'.repeat(65), 7, undefined, 'a b']) {
      expect(parseRoadmapEdit({ op: 'update', id, seen: null, fields: ok }), String(id)).toMatchObject({ ok: false });
      expect(parseRoadmapEdit({ op: 'move', id, seen: null, lane: 'now', rank: 0 }), String(id)).toMatchObject({ ok: false });
      expect(parseRoadmapEdit({ op: 'delete', id }), String(id)).toMatchObject({ ok: false });
      expect(parseRoadmapEdit({ op: 'reorder', lane: 'now', ids: ['ok', id] }), String(id)).toMatchObject({ ok: false });
    }
    for (const proposalId of ['Upper', 'a/b', '-lead', '', 'x'.repeat(65), 3]) {
      expect(parseRoadmapEdit({ op: 'dismiss', proposalId }), String(proposalId)).toMatchObject({ ok: false });
      expect(parseRoadmapEdit({ op: 'create', fields: ok, proposalId }), String(proposalId)).toMatchObject({ ok: false });
    }
  });

  it('an unknown operation, a missing body, or bad fields: refused', () => {
    for (const bad of [null, {}, { op: 'drop' }, { op: 'create' }, { op: 'create', fields: { ...ok, lane: 'x' } }, { op: 'update', id: 'a', seen: null }]) {
      expect(parseRoadmapEdit(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it('an edit of an item must say which version it saw: without it, it is the stale write this refuses', () => {
    for (const seen of [undefined, '17', Number.NaN, Infinity]) {
      expect(parseRoadmapEdit({ op: 'update', id: 'a', seen, fields: ok }), String(seen)).toMatchObject({ ok: false });
      expect(parseRoadmapEdit({ op: 'move', id: 'a', seen, lane: 'now', rank: 0 }), String(seen)).toMatchObject({ ok: false });
    }
  });

  it('a move needs a lane and a usable rank; a reorder a lane and a list of distinct ids, not too long', () => {
    for (const bad of [
      { op: 'move', id: 'a', seen: 1, lane: 'someday', rank: 0 }, { op: 'move', id: 'a', seen: 1, lane: 'now', rank: Number.NaN },
      { op: 'move', id: 'a', seen: 1, lane: 'now', rank: ROADMAP_RANK_MAX * 2 },
      { op: 'reorder', lane: 'now', ids: [] }, { op: 'reorder', lane: 'now', ids: ['a', 'a'] }, { op: 'reorder', lane: 'x', ids: ['a'] },
      { op: 'reorder', lane: 'now', ids: 'a' }, { op: 'reorder', lane: 'now', ids: Array.from({ length: ROADMAP_READ_MAX + 1 }, (_, n) => `i${n}`) },
    ]) {
      expect(parseRoadmapEdit(bad), JSON.stringify(bad).slice(0, 80)).toMatchObject({ ok: false });
    }
    expect(parseRoadmapEdit({ op: 'reorder', lane: 'now', ids: Array.from({ length: ROADMAP_READ_MAX }, (_, n) => `i${n}`) })).toMatchObject({ ok: true });
  });
});

describe('doneAtAfter: when an item was done', () => {
  it('stamped when it arrives in Done, kept while it stays, cleared when it leaves', () => {
    expect(doneAtAfter('done', false, null, 'now')).toBe('now');
    expect(doneAtAfter('done', true, 'then', 'now')).toBe('then');
    expect(doneAtAfter('done', true, null, 'now')).toBe('now');
    expect(doneAtAfter('next', true, 'then', 'now')).toBeNull();
    expect(doneAtAfter('later', false, null, 'now')).toBeNull();
  });
});

describe('the order of a lane', () => {
  it('rankBetween: below, above, halfway, or zero in an empty lane', () => {
    expect(rankBetween(null, null)).toBe(0);
    expect(rankBetween(null, 5)).toBe(4);
    expect(rankBetween(5, null)).toBe(6);
    expect(rankBetween(1, 2)).toBe(1.5);
  });

  it('needsRespread: neighbours too close, equal, or out of order', () => {
    expect(needsRespread([0, 1, 2])).toBe(false);
    expect(needsRespread([0, 1, 1])).toBe(true);
    expect(needsRespread([0, 1e-9])).toBe(true);
    expect(needsRespread([2, 1])).toBe(true);
    expect(needsRespread([])).toBe(false);
  });

  it('compareRoadmapItems: by rank, then by when it was made, then by id', () => {
    const list = [
      { id: 'c', rank: 1, createdAt: 5 }, { id: 'b', rank: 1, createdAt: 5 }, { id: 'a', rank: 2, createdAt: 1 },
      { id: 'd', rank: 1, createdAt: null }, { id: 'e', rank: 0, createdAt: 9 },
    ];
    expect([...list].sort(compareRoadmapItems).map((i) => i.id)).toEqual(['e', 'd', 'b', 'c', 'a']);
  });
});

describe('moves, as the screen plans them', () => {
  const lane = [{ id: 'a', rank: 0 }, { id: 'b', rank: 1 }, { id: 'c', rank: 2 }, { id: 'd', rank: 3 }];
  const all = new Set(lane.map((i) => i.id));

  it('up and down among everything: between the neighbours', () => {
    expect(planShift(lane, all, 'c', -1)).toEqual({ kind: 'rank', rank: 0.5 });
    expect(planShift(lane, all, 'b', 1)).toEqual({ kind: 'rank', rank: 2.5 });
    expect(planShift(lane, all, 'b', -1)).toEqual({ kind: 'rank', rank: -1 });
    expect(planShift(lane, all, 'c', 1)).toEqual({ kind: 'rank', rank: 4 });
  });

  it('at the edges, nowhere to go; an item not shown, nothing to plan', () => {
    expect(planShift(lane, all, 'a', -1)).toBeNull();
    expect(planShift(lane, all, 'd', 1)).toBeNull();
    expect(planShift(lane, new Set(['a', 'b']), 'c', -1)).toBeNull();
  });

  it('with a filter on: past what it hides, to just before (or after) the next item shown', () => {
    // Shown: a and d. Up from d lands before a; down from a lands after d — a step that changes what is seen.
    const shown = new Set(['a', 'd']);
    expect(planShift(lane, shown, 'd', -1)).toEqual({ kind: 'rank', rank: -1 });
    expect(planShift(lane, shown, 'a', 1)).toEqual({ kind: 'rank', rank: 4 });
    // Shown: b and d. Up from d lands just before b, between a and b.
    expect(planShift(lane, new Set(['b', 'd']), 'd', -1)).toEqual({ kind: 'rank', rank: 0.5 });
  });

  it('a gap too small to halve: the lane’s whole new order instead', () => {
    const tight = [{ id: 'a', rank: 0 }, { id: 'b', rank: 1e-7 }, { id: 'c', rank: 2e-7 }];
    expect(planShift(tight, new Set(['a', 'b', 'c']), 'c', -1)).toEqual({ kind: 'reorder', order: ['a', 'c', 'b'] });
  });

  it('to the end of a lane: one past the last, however crowded the middle', () => {
    expect(rankAtEnd([])).toBe(0);
    expect(rankAtEnd(lane)).toBe(4);
    expect(rankAtEnd(lane, 'd')).toBe(3);
    expect(rankAtEnd([{ id: 'a', rank: 0 }, { id: 'b', rank: 1e-9 }])).toBe(1 + 1e-9);
  });

  it('a rank as the list shows it: finite, within what the server accepts back', () => {
    expect(shownRank(5)).toBe(5);
    expect(shownRank(1e20)).toBe(ROADMAP_RANK_MAX);
    expect(shownRank(-1e20)).toBe(-ROADMAP_RANK_MAX);
    for (const bad of [Number.NaN, Infinity, '3', null, undefined]) expect(shownRank(bad), String(bad)).toBe(0);
    expect(cleanRoadmapFields({ ...ok, rank: shownRank(1e20) })).toMatchObject({ ok: true });
  });

  it('a lane as the list shows it: its own, or Later for one that is not a lane', () => {
    for (const lane of ROADMAP_LANES) expect(shownLane(lane)).toBe(lane);
    for (const bad of ['someday', 'Done', '', null, undefined, 3]) expect(shownLane(bad), String(bad)).toBe('later');
  });

  it('the list reads past the cap, so an item two creates at once let in is still seen', () => {
    expect(ROADMAP_READ_MAX).toBeGreaterThan(ROADMAP_MAX_ITEMS);
  });
});

describe('Claude’s proposals', () => {
  it('each has a stable, unique id the server accepts, and passes the server’s check as an item', () => {
    expect(ROADMAP_PROPOSALS.length).toBeGreaterThan(0);
    const ids = ROADMAP_PROPOSALS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ROADMAP_PROPOSALS) {
      expect(PROPOSAL_ID.test(p.id), p.id).toBe(true);
      expect(p.lane, p.id).not.toBe('done');
      const r = cleanRoadmapFields({ title: p.title, note: p.note, area: p.area, lane: p.lane, rank: 0 });
      expect(r, p.id).toMatchObject({ ok: true });
      // Kept exactly as written: nothing for the server to clean, so the item reads like the proposal.
      if (r.ok) expect([r.value.title, r.value.note], p.id).toEqual([p.title, p.note]);
    }
  });

  it('open: the ones nothing was done with; dismissed: the ones to bring back', () => {
    const [a, b, c] = ROADMAP_PROPOSALS;
    const done = { [a.id]: 'added' as const, [b.id]: 'dismissed' as const };
    expect(openProposals([a, b, c], done)).toEqual([c]);
    expect(dismissedProposals([a, b, c], done)).toEqual([b]);
    expect(openProposals([a, b, c], {})).toEqual([a, b, c]);
  });
});

describe('the admin screen uses the server’s own limits and order', () => {
  const screen = readFileSync('src/components/AdminRoadmap.tsx', 'utf8');

  it('imports them from the server’s module, not a copy', () => {
    expect(screen).toMatch(/from '\.\.\/\.\.\/functions\/src\/roadmapCore';/);
    for (const name of ['ROADMAP_TITLE_MAX', 'ROADMAP_NOTE_MAX', 'compareRoadmapItems', 'planShift', 'rankAtEnd']) {
      expect(screen, name).toContain(name);
    }
    expect(screen).not.toMatch(/\b(120|1000)\b/);
  });

  it('moves send the lane and the rank only, with the version seen; edits send the version seen too', () => {
    expect(screen).toContain("{ op: 'move', id: item.id, seen: item.updatedAt, lane: item.lane, rank: plan.rank }");
    expect(screen).toContain("{ op: 'move', id: item.id, seen: item.updatedAt, lane, rank }");
    // The version is the one the form was OPENED on, kept with it: a reload while the form is open must not refresh it.
    expect(screen).toContain("setEditing({ id: item.id, seen: item.updatedAt, draft:");
    expect(screen).toContain("const { id, draft, seen } = editing;");
    expect(screen).toContain("{ op: 'update', id: target.id, seen, fields }");
    expect(screen).not.toMatch(/op: 'update'[^}]*fieldsOf/);
  });

  it('is the admin’s eighth tab, wired in all three places', () => {
    const admin = readFileSync('src/screens/Admin.tsx', 'utf8');
    expect(admin).toMatch(/type Tab = [^;]*\| 'roadmap';/);
    expect(admin).toContain("roadmap: 'Roadmap',");
    expect(admin).toContain("'broadcast', 'roadmap'] as Tab[]).map(");
    expect(admin).toContain("{tab === 'roadmap' && <AdminRoadmap />}");
  });
});
