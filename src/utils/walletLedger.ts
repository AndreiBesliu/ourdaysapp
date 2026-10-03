// src/utils/walletLedger.ts
//
// The Wallet's record of card changes the server has not confirmed yet (03.10.2026).
//
// ── Why it exists ────────────────────────────────────────────────────────────────────
//
// A write made without a connection is applied locally at once, queued, and sent when the network
// returns — even after a reload (measured with the real SDK, DEVLOG 03.10). The server can still
// REFUSE it then (a card shared with a group its owner has left). When that happens the SDK rejects
// the write's promise and, in the same millisecond, takes the card back out of the local cache. If
// nobody is holding that promise any more — the form closed long ago, the page was reloaded, the app
// was restarted — the card just vanishes and nobody is told. That is the failure this file prevents.
//
// So every card change is written down here BEFORE it is issued, with what the card should look like
// afterwards, and the write carries the change's id (`lastWriteId`). Two routes settle an entry:
//   * the write's own promise, while its page lives: confirmed → the entry goes; refused → the entry
//     is marked, to be judged at once;
//   * the server itself: on an owned-cards answer that is confirmed by the server and has no pending
//     writes, every entry old enough is judged against the cards the server holds. That needs no
//     promise at all, so it covers a reload, a restart and another tab — a server answer with no
//     pending writes means the shared queue has been drained, whichever tab issued it.
// A card that carries the change's id received it, whatever else changed it since (a category rename,
// a share from an event): only a card WITHOUT it is compared field by field. What did not land
// becomes a NOTICE, kept until the person dismisses it.
//
// Category renames and removals are written down too (`categoryOps`): their last step, the list,
// waits for every card's answer, and must still happen — or be reported — after a reload.
//
// Kept per account and NOT forgotten at sign-out: a change queued by an account is sent at that
// account's next sign-in, and a refusal then must still be told. It is never shown to another account.
// It holds what the offline card copy holds (names and codes) and never a photo's download URL, which
// is a bearer link — only a short mark of it, to tell whether the photo changed.
//
// Pure functions over a plain object, plus a read-modify-write store (`updateLedger`) so two tabs
// never overwrite each other's entries with a stale whole copy.

import { categoriesOf } from './walletCategories';

export const LEDGER_PREFIX = 'ourdays.walletLedger:';
/** An entry younger than this is not judged by a server answer: its own write may not be applied yet. */
export const RECONCILE_GRACE_MS = 5_000;

export type LedgerKind = 'add' | 'edit' | 'delete';
export type NoticeKind = 'notAdded' | 'changeNotSaved' | 'notDeleted';

/** What a card should look like once the change lands — the fields the Wallet form writes. */
export interface CardFields {
  name: string;
  categories: string[];
  category: string;
  barcodeValue: string | null;
  barcodeFormat: string | null;
  sharedGroupId: string | null;
  /** `imageMark` of the photo URL, '' for none. */
  image: string;
}

export interface LedgerEntry {
  opId: string;
  kind: LedgerKind;
  assetId: string;
  name: string;
  fields: CardFields | null;
  at: number;
  /** The write's own promise was rejected: judge it on the next server answer, whatever its age. */
  refused?: boolean;
}

export interface LedgerNotice {
  id: string;
  kind: NoticeKind;
  assetId: string;
  name: string;
  fields: CardFields | null;
  at: number;
}

/** A category rename or removal whose last step — the list — waits for the cards' answers. */
export interface CategoryOp {
  opId: string;
  kind: 'rename' | 'remove';
  oldName: string;
  /** The rename's new name, null for a removal. */
  newName: string | null;
  /** Whether the new name was already listed before the rename put it there. */
  newWasListed: boolean;
  /** The cards the change was issued for. */
  cardIds: string[];
  at: number;
}

export interface Ledger {
  v: 1;
  entries: LedgerEntry[];
  notices: LedgerNotice[];
  categoryOps: CategoryOp[];
}

export const EMPTY_LEDGER: Ledger = Object.freeze({ v: 1, entries: [], notices: [], categoryOps: [] }) as Ledger;

/** A short, stable mark of a photo URL (FNV-1a, 32 bits): tells "same photo" from "another one". */
export function imageMark(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The fields a card write sets, as the ledger keeps them. */
export function fieldsOf(data: Record<string, unknown>): CardFields {
  return {
    name: typeof data.name === 'string' ? data.name : '',
    categories: list(data.categories),
    category: typeof data.category === 'string' ? data.category : '',
    barcodeValue: str(data.barcodeValue),
    barcodeFormat: str(data.barcodeFormat),
    sharedGroupId: str(data.sharedGroupId),
    image: imageMark(data.imageUrl),
  };
}

/** Whether the server's card carries exactly the change. */
export function fieldsMatch(expected: CardFields, card: Record<string, unknown>): boolean {
  const got = fieldsOf(card);
  return got.name === expected.name
    && got.category === expected.category
    && got.categories.length === expected.categories.length
    && got.categories.every((c, i) => c === expected.categories[i])
    && got.barcodeValue === expected.barcodeValue
    && got.barcodeFormat === expected.barcodeFormat
    && got.sharedGroupId === expected.sharedGroupId
    && got.image === expected.image;
}

/**
 * Write a change down. One entry per card, the latest change deciding:
 *   - an edit of a card whose ADD is still unconfirmed stays an add (if the add is refused, the card
 *     was never there, and that is what must be said), with the newer fields;
 *   - a deletion replaces whatever was pending for the card, and drops its notices: nothing about a
 *     card the person removed is worth saying afterwards.
 */
export function record(l: Ledger, e: LedgerEntry): Ledger {
  const prior = l.entries.find((x) => x.assetId === e.assetId);
  const rest = l.entries.filter((x) => x.assetId !== e.assetId);
  if (e.kind === 'delete') {
    return { ...l, entries: [...rest, e], notices: l.notices.filter((n) => n.assetId !== e.assetId) };
  }
  const kind: LedgerKind = prior?.kind === 'add' && e.kind === 'edit' ? 'add' : e.kind;
  return { ...l, entries: [...rest, { ...e, kind }] };
}

/** The write's own promise answered. Only the entry's CURRENT write may settle it. */
export function settle(l: Ledger, opId: string, outcome: 'acked' | 'refused'): Ledger {
  const i = l.entries.findIndex((x) => x.opId === opId);
  if (i < 0) return l;
  if (outcome === 'acked') return { ...l, entries: l.entries.filter((_, k) => k !== i) };
  if (l.entries[i].refused) return l;
  const entries = l.entries.slice();
  entries[i] = { ...entries[i], refused: true };
  return { ...l, entries };
}

/** Drop an entry outright: its refusal was shown in the open form, or the write never started. */
export function forget(l: Ledger, opId: string): Ledger {
  return l.entries.some((x) => x.opId === opId) ? { ...l, entries: l.entries.filter((x) => x.opId !== opId) } : l;
}

export function dismiss(l: Ledger, noticeId: string): Ledger {
  return l.notices.some((n) => n.id === noticeId) ? { ...l, notices: l.notices.filter((n) => n.id !== noticeId) } : l;
}

/** How a change ended, judged against the card the server holds (undefined: the server has none). */
export function verdict(e: LedgerEntry, card: Record<string, unknown> | undefined): 'landed' | NoticeKind {
  if (e.kind === 'delete') return card ? 'notDeleted' : 'landed';
  if (!card) return e.kind === 'add' ? 'notAdded' : 'changeNotSaved';
  // The card received THIS change; whatever changed it since was another, deliberate write.
  if (card.lastWriteId === e.opId) return 'landed';
  if (!e.fields) return 'landed';
  return fieldsMatch(e.fields, card) ? 'landed' : 'changeNotSaved';
}

/** Whether an entry or category op may be judged now: refused already, or past the grace. */
const due = (x: { at: number; refused?: boolean }, now: number, graceMs: number) =>
  x.refused === true || now - x.at >= graceMs;

/**
 * Judge every entry old enough (or already refused) against a SERVER-CONFIRMED answer with no pending
 * writes — the caller's duty: a cached answer, or one still carrying a local write, decides nothing.
 * Returns the same object when nothing changed.
 */
export function reconcile(
  l: Ledger,
  serverCards: ReadonlyArray<Record<string, unknown> & { id: string }>,
  now: number,
  graceMs = RECONCILE_GRACE_MS,
): Ledger {
  const ready = l.entries.filter((e) => due(e, now, graceMs));
  if (!ready.length) return l;
  const byId = new Map(serverCards.map((c) => [c.id, c]));
  let notices = l.notices;
  for (const e of ready) {
    const v = verdict(e, byId.get(e.assetId));
    if (v === 'landed') continue;
    notices = [
      ...notices.filter((n) => n.assetId !== e.assetId),
      { id: e.opId, kind: v, assetId: e.assetId, name: e.name, fields: e.fields, at: e.at },
    ];
  }
  return { ...l, entries: l.entries.filter((e) => !ready.includes(e)), notices };
}

/** When the next entry or category op becomes due (for a re-check), or null when none waits. */
export function nextDueAt(l: Ledger, graceMs = RECONCILE_GRACE_MS): number | null {
  const times = [...l.entries, ...l.categoryOps]
    .filter((x) => !(x as { refused?: boolean }).refused)
    .map((x) => x.at + graceMs);
  return times.length ? Math.min(...times) : null;
}

// ── Category renames and removals ───────────────────────────────────────────────────────

export function recordCategoryOp(l: Ledger, op: CategoryOp): Ledger {
  return { ...l, categoryOps: [...l.categoryOps.filter((o) => o.opId !== op.opId), op] };
}

export function dropCategoryOp(l: Ledger, opId: string): Ledger {
  return l.categoryOps.some((o) => o.opId === opId) ? { ...l, categoryOps: l.categoryOps.filter((o) => o.opId !== opId) } : l;
}

/**
 * How a category change ended:
 *   - `partial`: a card it was issued for still carries the old name — the server refused that card;
 *     the old name stays listed. `dropNewName`: a rename put a name on the list that no card carries
 *     now and that was not listed before — it goes again, so the same rename can be retried;
 *   - `kept`: every card took the change, but a card of mine carries the old name anyway (added since,
 *     here or on another device): the name stays listed, or that card would lose its category;
 *   - `done`: the list may lose the old name.
 */
export interface CategoryOutcome {
  op: CategoryOp;
  result: 'done' | 'partial' | 'kept';
  refusedCards: number;
  dropNewName: boolean;
}

/** Decide a category change from the cards' answers (`stillCarrying`: card ids that kept the old name). */
export function categoryOutcome(
  op: CategoryOp,
  stillCarrying: ReadonlySet<string>,
  ownedCardsNow: ReadonlyArray<Record<string, unknown>>,
): CategoryOutcome {
  const refusedCards = op.cardIds.filter((id) => stillCarrying.has(id)).length;
  if (refusedCards) {
    // A refused card is back as the server holds it, whatever a not-yet-updated local copy says: it
    // cannot carry the new name (found on the bench, 03.10: the answers in time beat the re-render).
    const newCarried = op.newName !== null && ownedCardsNow.some((c) =>
      !stillCarrying.has(String(c.id)) && categoriesOf(c).includes(op.newName as string));
    return { op, result: 'partial', refusedCards, dropNewName: op.kind === 'rename' && !op.newWasListed && !newCarried };
  }
  const oldCarried = ownedCardsNow.some((c) => categoriesOf(c).includes(op.oldName));
  return { op, result: oldCarried ? 'kept' : 'done', refusedCards: 0, dropNewName: false };
}

/**
 * Judge the category changes old enough against a SERVER-CONFIRMED owned-cards answer with no pending
 * writes, and take them off the ledger. The caller applies each outcome (the list write needs the
 * live list, which this does not have).
 */
export function judgeCategoryOps(
  l: Ledger,
  serverCards: ReadonlyArray<Record<string, unknown> & { id: string }>,
  now: number,
  graceMs = RECONCILE_GRACE_MS,
): { ledger: Ledger; outcomes: CategoryOutcome[] } {
  const ready = l.categoryOps.filter((o) => due(o, now, graceMs));
  if (!ready.length) return { ledger: l, outcomes: [] };
  const outcomes = ready.map((op) => {
    const stillCarrying = new Set(serverCards.filter((c) => categoriesOf(c).includes(op.oldName)).map((c) => c.id));
    return categoryOutcome(op, stillCarrying, serverCards);
  });
  return { ledger: { ...l, categoryOps: l.categoryOps.filter((o) => !ready.includes(o)) }, outcomes };
}

// ── The store ────────────────────────────────────────────────────────────────────────

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Where localStorage refuses (private mode, a full disk), this page still keeps its own entries, so
// its in-page route works; only the after-a-reload route is lost, which no storage could keep anyway.
const memory = new Map<string, string>();
const memoryKV: KV = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, v); },
  removeItem: (k) => { memory.delete(k); },
};

function defaultKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = `${LEDGER_PREFIX}probe`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch { /* refused: fall through */ }
  return memoryKV;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
type Rec = Record<string, unknown>;
const KINDS: LedgerKind[] = ['add', 'edit', 'delete'];
const NOTICE_KINDS: NoticeKind[] = ['notAdded', 'changeNotSaved', 'notDeleted'];

function cleanFields(f: unknown): CardFields | null {
  if (!f || typeof f !== 'object') return null;
  const o = f as Rec;
  return {
    name: isStr(o.name) ? o.name : '',
    categories: list(o.categories),
    category: isStr(o.category) ? o.category : '',
    barcodeValue: str(o.barcodeValue),
    barcodeFormat: str(o.barcodeFormat),
    sharedGroupId: str(o.sharedGroupId),
    image: isStr(o.image) ? o.image : '',
  };
}

/** A stored ledger, checked field by field; anything unreadable is dropped, never thrown. */
export function parseLedger(raw: string | null): Ledger {
  if (!raw) return EMPTY_LEDGER;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1) return EMPTY_LEDGER;
    const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === 'object') : []);
    const entries: LedgerEntry[] = arr(o.entries)
      .filter((e) => isStr(e.opId) && KINDS.includes(e.kind as LedgerKind) && isStr(e.assetId) && typeof e.at === 'number')
      .map((e) => ({
        opId: e.opId as string, kind: e.kind as LedgerKind, assetId: e.assetId as string, name: isStr(e.name) ? e.name : '',
        fields: cleanFields(e.fields), at: e.at as number, ...(e.refused === true ? { refused: true } : {}),
      }));
    const notices: LedgerNotice[] = arr(o.notices)
      .filter((n) => isStr(n.id) && NOTICE_KINDS.includes(n.kind as NoticeKind) && isStr(n.assetId) && typeof n.at === 'number')
      .map((n) => ({
        id: n.id as string, kind: n.kind as NoticeKind, assetId: n.assetId as string, name: isStr(n.name) ? n.name : '',
        fields: cleanFields(n.fields), at: n.at as number,
      }));
    const categoryOps: CategoryOp[] = arr(o.categoryOps)
      .filter((c) => isStr(c.opId) && (c.kind === 'rename' || c.kind === 'remove') && isStr(c.oldName) && typeof c.at === 'number')
      .map((c) => ({
        opId: c.opId as string, kind: c.kind as 'rename' | 'remove', oldName: c.oldName as string,
        newName: isStr(c.newName) ? c.newName : null, newWasListed: c.newWasListed === true,
        cardIds: list(c.cardIds), at: c.at as number,
      }));
    return { v: 1, entries, notices, categoryOps };
  } catch {
    return EMPTY_LEDGER;
  }
}

export function readLedger(uid: string, kv: KV = defaultKV()): Ledger {
  const key = LEDGER_PREFIX + uid;
  // A copy this page could not store is newer than whatever storage still holds.
  if (kv !== memoryKV && memory.has(key)) return parseLedger(memory.get(key) ?? null);
  try { return parseLedger(kv.getItem(key)); } catch { return EMPTY_LEDGER; }
}

const listeners = new Set<(uid: string) => void>();

/** Told after this page changes a ledger (another tab's changes arrive as a 'storage' event). */
export function onLedgerChange(fn: (uid: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Read, change, write back — every time, so a second tab's entries are never overwritten with this
 * tab's older copy. Never throws: a ledger that cannot be stored is still applied in memory.
 */
export function updateLedger(uid: string, change: (l: Ledger) => Ledger, kv: KV = defaultKV()): Ledger {
  if (!uid) return EMPTY_LEDGER;
  const before = readLedger(uid, kv);
  const after = change(before);
  if (after === before) return before;
  const key = LEDGER_PREFIX + uid;
  const empty = !after.entries.length && !after.notices.length && !after.categoryOps.length;
  try {
    if (empty) kv.removeItem(key);
    else kv.setItem(key, JSON.stringify(after));
    if (kv !== memoryKV) memory.delete(key);
  } catch {
    if (empty) memory.delete(key);
    else memory.set(key, JSON.stringify(after));
  }
  for (const fn of listeners) {
    try { fn(uid); } catch { /* a listener must not break a write */ }
  }
  return after;
}

/** A fresh id for one write. */
export function newOpId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
