// src/utils/walletLedger.test.ts — the record of card changes the server has not confirmed (walletLedger.ts).
import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_LEDGER, RECONCILE_GRACE_MS, LEDGER_PREFIX, imageMark, fieldsOf, fieldsMatch, record, settle, forget,
  dismiss, verdict, reconcile, parseLedger, readLedger, updateLedger, onLedgerChange, nextDueAt, recordCategoryOp,
  dropCategoryOp, categoryOutcome, judgeCategoryOps, type Ledger, type LedgerEntry, type KV, type CategoryOp,
} from './walletLedger';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/x/o/assets%2Fme%2F1.png?alt=media&token=SECRET-A';
const data = (over: Record<string, unknown> = {}) => ({
  name: 'Lidl', categories: ['Financial'], category: 'Financial', imageUrl: null,
  sharedGroupId: null, sharedWithFamily: false, barcodeValue: '123', barcodeFormat: 'EAN_13', ...over,
});
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  opId: 'op1', kind: 'add', assetId: 'c1', name: 'Lidl', fields: fieldsOf(data()), at: 1000, ...over,
});
const kvOf = (store = new Map<string, string>()): KV & { store: Map<string, string> } => ({
  store,
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: (k) => { store.delete(k); },
});

describe('what is kept', () => {
  it('the fields the form writes — and a MARK of the photo, never its download URL (a bearer link)', () => {
    const f = fieldsOf(data({ imageUrl: URL_A, ownerId: 'me', createdAt: 'x' }));
    expect(Object.keys(f).sort()).toEqual(['barcodeFormat', 'barcodeValue', 'categories', 'category', 'image', 'name', 'sharedGroupId']);
    expect(f.image).toBe(imageMark(URL_A));
    expect(JSON.stringify(f)).not.toContain('SECRET-A');
    expect(imageMark(null)).toBe('');
    expect(imageMark(URL_A)).not.toBe(imageMark(URL_A + 'x'));
  });

  it('a stored ledger never contains a photo URL', () => {
    const kv = kvOf();
    updateLedger('me', (l) => record(l, entry({ fields: fieldsOf(data({ imageUrl: URL_A })) })), kv);
    expect([...kv.store.values()].join('')).not.toContain('SECRET-A');
  });

  it('fieldsMatch: every field, the photo by its mark', () => {
    const f = fieldsOf(data({ imageUrl: URL_A }));
    expect(fieldsMatch(f, data({ imageUrl: URL_A, ownerId: 'me' }))).toBe(true);
    expect(fieldsMatch(f, data({ imageUrl: URL_A, name: 'Lidl Plus' }))).toBe(false);
    expect(fieldsMatch(f, data({ imageUrl: null }))).toBe(false);
    expect(fieldsMatch(f, data({ imageUrl: URL_A, categories: ['Financial', 'Vehicles'] }))).toBe(false);
    expect(fieldsMatch(f, data({ imageUrl: URL_A, sharedGroupId: 'g1' }))).toBe(false);
  });
});

describe('record: one entry per card, the latest change deciding', () => {
  it('an edit of a card whose add is unconfirmed stays an add, with the newer fields', () => {
    let l = record(EMPTY_LEDGER, entry());
    l = record(l, entry({ opId: 'op2', kind: 'edit', name: 'Lidl Plus', fields: fieldsOf(data({ name: 'Lidl Plus' })) }));
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({ opId: 'op2', kind: 'add', name: 'Lidl Plus' });
  });

  it('an edit replaces an earlier edit', () => {
    let l = record(EMPTY_LEDGER, entry({ kind: 'edit' }));
    l = record(l, entry({ opId: 'op2', kind: 'edit' }));
    expect(l.entries.map((e) => [e.opId, e.kind])).toEqual([['op2', 'edit']]);
  });

  it('a deletion replaces what was pending and drops the card\'s notices', () => {
    let l: Ledger = { v: 1, entries: [entry()], notices: [{ id: 'n', kind: 'changeNotSaved', assetId: 'c1', name: 'Lidl', fields: null, at: 1 }], categoryOps: [] };
    l = record(l, entry({ opId: 'op2', kind: 'delete', fields: null }));
    expect(l.entries.map((e) => [e.opId, e.kind])).toEqual([['op2', 'delete']]);
    expect(l.notices).toEqual([]);
  });

  it('other cards are untouched', () => {
    let l = record(EMPTY_LEDGER, entry());
    l = record(l, entry({ opId: 'op9', assetId: 'c9' }));
    expect(l.entries.map((e) => e.assetId)).toEqual(['c1', 'c9']);
  });
});

describe('settle: only the entry\'s CURRENT write settles it', () => {
  it('confirmed: the entry goes', () => {
    expect(settle(record(EMPTY_LEDGER, entry()), 'op1', 'acked').entries).toEqual([]);
  });
  it('the older write of a card confirmed after a newer one was recorded: the entry stays', () => {
    let l = record(EMPTY_LEDGER, entry());
    l = record(l, entry({ opId: 'op2', kind: 'edit' }));
    expect(settle(l, 'op1', 'acked').entries.map((e) => e.opId)).toEqual(['op2']);
  });
  it("one card's confirmation leaves every other card's entry alone (mutation L3)", () => {
    let l = record(EMPTY_LEDGER, entry());
    l = record(l, entry({ opId: 'op9', assetId: 'c9' }));
    expect(settle(l, 'op1', 'acked').entries.map((e) => e.opId)).toEqual(['op9']);
  });

  it('refused: marked, to be judged at once', () => {
    expect(settle(record(EMPTY_LEDGER, entry()), 'op1', 'refused').entries[0].refused).toBe(true);
  });
  it('forget and dismiss remove exactly one thing; unknown ids change nothing (same object)', () => {
    const l = record(EMPTY_LEDGER, entry());
    expect(forget(l, 'op1').entries).toEqual([]);
    expect(forget(l, 'nope')).toBe(l);
    expect(dismiss(l, 'nope')).toBe(l);
  });
});

describe('verdict: judged against the card the server holds', () => {
  const card = (over = {}) => ({ id: 'c1', ...data(over) });
  it('add: there with the fields → landed; missing → not added; there but different → change not saved', () => {
    expect(verdict(entry(), card())).toBe('landed');
    expect(verdict(entry(), undefined)).toBe('notAdded');
    expect(verdict(entry(), card({ name: 'Other' }))).toBe('changeNotSaved');
  });
  it('edit: missing or different → change not saved', () => {
    expect(verdict(entry({ kind: 'edit' }), undefined)).toBe('changeNotSaved');
    expect(verdict(entry({ kind: 'edit' }), card({ barcodeValue: '999' }))).toBe('changeNotSaved');
  });
  it('delete: gone → landed (also a card whose add was refused: there is nothing to say); there → not deleted', () => {
    expect(verdict(entry({ kind: 'delete', fields: null }), undefined)).toBe('landed');
    expect(verdict(entry({ kind: 'delete', fields: null }), card())).toBe('notDeleted');
  });
});

describe('reconcile: on a server answer with no pending writes', () => {
  const NOW = 1000 + RECONCILE_GRACE_MS;

  it('M3, the page still open: an add refused after the form closed becomes a notice naming the card', () => {
    let l = record(EMPTY_LEDGER, entry());
    l = settle(l, 'op1', 'refused');
    l = reconcile(l, [], 1001); // judged at once, whatever its age
    expect(l.entries).toEqual([]);
    expect(l.notices).toEqual([expect.objectContaining({ kind: 'notAdded', name: 'Lidl', assetId: 'c1' })]);
  });

  it('M2+M3, after a reload (no promise left): judged by age, against the server alone', () => {
    const l = reconcile(record(EMPTY_LEDGER, entry()), [], NOW);
    expect(l.notices.map((n) => n.kind)).toEqual(['notAdded']);
  });

  it('a change that landed: the entry goes, nothing is said', () => {
    const l = reconcile(record(EMPTY_LEDGER, entry()), [{ id: 'c1', ...data() }], NOW);
    expect(l.entries).toEqual([]);
    expect(l.notices).toEqual([]);
  });

  it('a write too young is not judged — its own local write may not be applied yet', () => {
    const l = record(EMPTY_LEDGER, entry());
    expect(reconcile(l, [], NOW - 1)).toBe(l);
  });

  it('nothing due: the same object (no re-render, no store write)', () => {
    expect(reconcile(EMPTY_LEDGER, [], NOW)).toBe(EMPTY_LEDGER);
  });

  it('a newer notice about a card replaces the older one', () => {
    let l: Ledger = { v: 1, entries: [entry({ kind: 'edit', opId: 'op2' })], notices: [{ id: 'old', kind: 'changeNotSaved', assetId: 'c1', name: 'Lidl', fields: null, at: 1 }], categoryOps: [] };
    l = reconcile(l, [], NOW);
    expect(l.notices.map((n) => n.id)).toEqual(['op2']);
  });
});

describe('the store', () => {
  it('read-modify-write: two tabs recording at once both keep their entries', () => {
    const kv = kvOf();
    updateLedger('me', (l) => record(l, entry()), kv);
    updateLedger('me', (l) => record(l, entry({ opId: 'op9', assetId: 'c9' })), kv);
    expect(readLedger('me', kv).entries.map((e) => e.assetId)).toEqual(['c1', 'c9']);
  });

  it('per account: another account reads nothing', () => {
    const kv = kvOf();
    updateLedger('me', (l) => record(l, entry()), kv);
    expect(readLedger('someoneElse', kv)).toEqual(EMPTY_LEDGER);
    expect([...kv.store.keys()]).toEqual([`${LEDGER_PREFIX}me`]);
  });

  it('an empty ledger removes its key', () => {
    const kv = kvOf();
    updateLedger('me', (l) => record(l, entry()), kv);
    updateLedger('me', (l) => settle(l, 'op1', 'acked'), kv);
    expect(kv.store.size).toBe(0);
  });

  it('storage that refuses a write: the newer copy is still read back, nothing throws', () => {
    const kv = kvOf();
    const full: KV = { ...kv, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => updateLedger('quota', (l) => record(l, entry()), full)).not.toThrow();
    expect(readLedger('quota', full).entries).toHaveLength(1);
  });

  it('garbage in storage is dropped, never thrown; invalid entries are filtered', () => {
    expect(parseLedger('{nope')).toEqual(EMPTY_LEDGER);
    expect(parseLedger(JSON.stringify({ v: 2 }))).toEqual(EMPTY_LEDGER);
    const l = parseLedger(JSON.stringify({ v: 1, entries: [entry(), { opId: 1 }, { ...entry(), kind: 'explode' }], notices: [{}] }));
    expect(l.entries).toHaveLength(1);
    expect(l.notices).toEqual([]);
  });

  it('listeners are told after a change, and only after a change', () => {
    const kv = kvOf();
    const fn = vi.fn();
    const off = onLedgerChange(fn);
    updateLedger('me', (l) => record(l, entry()), kv);
    updateLedger('me', (l) => l, kv);
    off();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('me');
  });
});

describe("the change's own id on the card (review 03.10)", () => {
  it('a card that received THIS change is landed, even if a category rename or a share changed it since', () => {
    const e = entry({ kind: 'edit' });
    expect(verdict(e, { id: 'c1', ...data({ categories: ['Transport'], category: 'Transport', lastWriteId: 'op1' }) })).toBe('landed');
  });
  it('a card without it (the write was refused) is still compared field by field — a refusal is never hidden', () => {
    const e = entry({ kind: 'edit', fields: fieldsOf(data({ name: 'Lidl Plus' })) });
    expect(verdict(e, { id: 'c1', ...data({ lastWriteId: 'older' }) })).toBe('changeNotSaved');
    expect(verdict(e, { id: 'c1', ...data() })).toBe('changeNotSaved');
  });
});

describe('when to look again', () => {
  it('the earliest moment a waiting entry or category change becomes due; refused ones are due already', () => {
    const op: CategoryOp = { opId: 'k', kind: 'remove', oldName: 'A', newName: null, newWasListed: false, cardIds: [], at: 500 };
    let l = record(EMPTY_LEDGER, entry({ at: 1000 }));
    l = recordCategoryOp(l, op);
    expect(nextDueAt(l)).toBe(500 + RECONCILE_GRACE_MS);
    expect(nextDueAt(settle(record(EMPTY_LEDGER, entry()), 'op1', 'refused'))).toBeNull();
    expect(nextDueAt(EMPTY_LEDGER)).toBeNull();
  });
});

describe('category changes (review 03.10)', () => {
  const card = (id: string, cats: string[]) => ({ id, ownerId: 'me', categories: cats, category: cats[0] || 'Uncategorized' });
  const rename = (over: Partial<CategoryOp> = {}): CategoryOp => ({
    opId: 'r1', kind: 'rename', oldName: 'Gym', newName: 'Fitness', newWasListed: false, cardIds: ['c1', 'c2'], at: 1000, ...over,
  });

  it('every card took it and none carries the old name: done', () => {
    expect(categoryOutcome(rename(), new Set(), [card('c1', ['Fitness']), card('c2', ['Fitness'])])).toMatchObject({ result: 'done', refusedCards: 0 });
  });

  it('a card it was issued for still carries the old name: partial (the server refused that card)', () => {
    const o = categoryOutcome(rename(), new Set(['c2']), [card('c1', ['Fitness']), card('c2', ['Gym'])]);
    expect(o).toMatchObject({ result: 'partial', refusedCards: 1, dropNewName: false }); // c1 carries Fitness
  });

  it('refused on every card: the new name it listed goes again, so the same rename can be retried', () => {
    const o = categoryOutcome(rename(), new Set(['c1', 'c2']), [card('c1', ['Gym']), card('c2', ['Gym'])]);
    expect(o).toMatchObject({ result: 'partial', refusedCards: 2, dropNewName: true });
    // …unless it was listed before the rename.
    expect(categoryOutcome(rename({ newWasListed: true }), new Set(['c1', 'c2']), [card('c1', ['Gym'])]).dropNewName).toBe(false);
  });

  it('refused on every card, decided before the screen re-rendered: the refused card counts as reverted (bench, 03.10)', () => {
    // The local copy still shows the refused card under the NEW name for a moment.
    const o = categoryOutcome(rename({ cardIds: ['c1'] }), new Set(['c1']), [card('c1', ['Fitness'])]);
    expect(o).toMatchObject({ result: 'partial', dropNewName: true });
  });

  it('a card added since carries the old name: kept, or that card would lose its category', () => {
    expect(categoryOutcome(rename(), new Set(['c9']), [card('c1', ['Fitness']), card('c9', ['Gym'])])).toMatchObject({ result: 'kept' });
  });

  it("judged on the server's cards after the grace, and taken off the ledger", () => {
    const l = recordCategoryOp(EMPTY_LEDGER, rename());
    expect(judgeCategoryOps(l, [], 1001).outcomes).toEqual([]);
    const j = judgeCategoryOps(l, [card('c1', ['Fitness']), card('c2', ['Gym'])], 1000 + RECONCILE_GRACE_MS);
    expect(j.outcomes.map((o) => o.result)).toEqual(['partial']);
    expect(j.ledger.categoryOps).toEqual([]);
    expect(dropCategoryOp(l, 'r1').categoryOps).toEqual([]);
  });

  it('kept in storage like the rest, and an empty ledger still removes its key', () => {
    const kv = kvOf();
    updateLedger('me', (l) => recordCategoryOp(l, rename()), kv);
    expect(readLedger('me', kv).categoryOps).toEqual([rename()]);
    updateLedger('me', (l) => dropCategoryOp(l, 'r1'), kv);
    expect(kv.store.size).toBe(0);
  });
});
