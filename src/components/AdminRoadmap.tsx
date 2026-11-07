// src/components/AdminRoadmap.tsx
//
// Admin → Roadmap (07.11.2026, asked for by Andrei: "un tab 'Roadmap' unde planificăm ce urmează în aplicație").
// Three lanes — Now, Next, Later — with what shipped folded under Done, and Claude's proposals on top (from the
// backlog, shipped with the app: src/utils/roadmapProposals.ts), each added to a lane or dismissed with one click.
//
// Everything goes through the two admin callables (functions/src/roadmapStore.ts); the server checks the caller is an
// admin and the fields (functions/src/roadmapCore.ts, whose limits and move plans this screen uses too). After each
// change the list is read again, and Reload reads it on demand. An edit says which version of the item it was shown:
// if another admin (or another tab) changed it since, the server refuses, the screen says so and reads it again, so a
// stale tab cannot write its old copy over a newer one. English, like the rest of the admin console (Andrei's
// exemption); the items themselves are written in whatever language their author writes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import {
  ROADMAP_AREAS, ROADMAP_NOTE_MAX, ROADMAP_TITLE_MAX, compareRoadmapItems, planShift, rankAtEnd,
  type RoadmapArea, type RoadmapEdit, type RoadmapItemOut, type RoadmapLane, type RoadmapRead,
} from '../../functions/src/roadmapCore';
import { ROADMAP_PROPOSALS, dismissedProposals, openProposals, type RoadmapProposal } from '../utils/roadmapProposals';
import { adminEditRoadmap, adminGetRoadmap } from '../serverActions';
import { reportError } from '../reportError';

type OpenLane = Exclude<RoadmapLane, 'done'>;
const OPEN_LANES: readonly OpenLane[] = ['now', 'next', 'later'];
const LANE_LABEL: Record<RoadmapLane, string> = { now: 'Now', next: 'Next', later: 'Later', done: 'Done' };
const AREA_LABEL: Record<RoadmapArea, string> = {
  calendar: 'Calendar', chat: 'Chat', wallet: 'Wallet', arcade: 'Arcade', warlord: 'Warlord',
  admin: 'Admin', infra: 'Infra', other: 'Other',
};

interface Draft { title: string; note: string; area: RoadmapArea; lane: RoadmapLane }
const EMPTY_DRAFT: Draft = { title: '', note: '', area: 'other', lane: 'next' };

/** The items of one lane, in order. */
function laneItems(items: readonly RoadmapItemOut[], lane: RoadmapLane): RoadmapItemOut[] {
  return items.filter((i) => i.lane === lane).sort(compareRoadmapItems);
}

/** A rank at the end of a lane (for an item moved there, without it). */
function endOf(items: readonly RoadmapItemOut[], lane: RoadmapLane, itemId?: string): number {
  return rankAtEnd(laneItems(items, lane), itemId);
}

const fmtDay = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
const chars = (s: string) => Array.from(s).length;

function ItemForm({ draft, onChange, onSave, onCancel, busy, saving, saveLabel }: {
  draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void;
  /** Any change on its way: Save waits for it. `saving`: this form's own. */
  busy: boolean; saving: boolean; saveLabel: string;
}) {
  const tooLong = chars(draft.title.trim()) > ROADMAP_TITLE_MAX || chars(draft.note) > ROADMAP_NOTE_MAX;
  const empty = draft.title.trim() === '';
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!empty && !tooLong) onSave(); }}
      className="flex flex-col gap-2 bg-white dark:bg-zinc-900 border border-primary/40 rounded-xl p-3"
    >
      <label className="text-xs font-bold text-zinc-500">Title
        <input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          maxLength={ROADMAP_TITLE_MAX * 2}
          autoFocus
          className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-normal text-zinc-900 dark:text-zinc-100"
        />
      </label>
      <label className="text-xs font-bold text-zinc-500">Note
        <textarea
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
          rows={3}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-normal text-zinc-900 dark:text-zinc-100"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs font-bold text-zinc-500">Area
          <select
            value={draft.area}
            onChange={(e) => onChange({ ...draft, area: e.target.value as RoadmapArea })}
            className="ml-2 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-normal text-zinc-900 dark:text-zinc-100"
          >
            {ROADMAP_AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-500">Lane
          <select
            value={draft.lane}
            onChange={(e) => onChange({ ...draft, lane: e.target.value as RoadmapLane })}
            className="ml-2 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-normal text-zinc-900 dark:text-zinc-100"
          >
            {(['now', 'next', 'later', 'done'] as const).map((l) => <option key={l} value={l}>{LANE_LABEL[l]}</option>)}
          </select>
        </label>
      </div>
      {tooLong && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          Too long: the title takes {ROADMAP_TITLE_MAX} characters, the note {ROADMAP_NOTE_MAX}.
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || empty || tooLong} className="min-h-[36px] px-4 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveLabel}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[36px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function AdminRoadmap() {
  const [data, setData] = useState<RoadmapRead | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** The list could not be read again after it had been: what is on screen may be out of date. */
  const [rereadFailed, setRereadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** What is being changed right now (an item id, a proposal id, or 'new'): its buttons wait. */
  const [busy, setBusy] = useState<string | null>(null);
  const [area, setArea] = useState<RoadmapArea | 'all'>('all');
  /**
   * The item being edited (its id), or 'new' for the add form; with what is typed so far, and the version of the item
   * the form was opened on. Kept from the opening: a reload while the form is open must not let Save write over what
   * another admin changed meanwhile (re-review, 07.11.2026).
   */
  const [editing, setEditing] = useState<{ id: string; draft: Draft; seen: number | null } | null>(null);
  /** A read on its way; only the newest one's answer is shown, so two overlapping reads cannot show the older. */
  const [loading, setLoading] = useState(false);
  const readSeq = useRef(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  /** Open or folded by hand; until then, open while there are few (three or fewer) to look at. */
  const [showProposals, setShowProposals] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const mine = ++readSeq.current;
    setLoading(true);
    try {
      const read = await adminGetRoadmap();
      if (mine !== readSeq.current) return;
      setData(read);
      setLoadFailed(false);
      setRereadFailed(false);
    } catch (err) {
      if (mine !== readSeq.current) return;
      reportError(err instanceof Error ? err.message : String(err), { context: 'AdminRoadmap.load' });
      setLoadFailed(true);
      setRereadFailed(true);
    } finally {
      if (mine === readSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The delete question takes the focus onto its safe answer, and Keep gives it back to the item's Delete: the button
  // that had it is gone while the question shows. (`autoFocus` did not take here, measured on the bench.)
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusDeleteOf, setFocusDeleteOf] = useState<string | null>(null);
  useEffect(() => { if (confirmDelete) keepRef.current?.focus(); }, [confirmDelete]);
  useEffect(() => {
    if (!focusDeleteOf) return;
    deleteRefs.current.get(focusDeleteOf)?.focus();
    setFocusDeleteOf(null);
  }, [focusDeleteOf]);

  /** One change, then the list again. What the server refused is said, in its words. */
  const run = useCallback(async (key: string, edits: RoadmapEdit[]) => {
    setBusy(key);
    setActionError(null);
    try {
      for (const edit of edits) await adminEditRoadmap(edit);
      await load();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportError(message, { context: 'AdminRoadmap.edit' });
      setActionError(message.replace(/^FirebaseError:\s*/, ''));
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const shown = useCallback((i: { area: RoadmapArea }) => area === 'all' || i.area === area, [area]);
  const proposals = useMemo(
    () => openProposals(ROADMAP_PROPOSALS, data?.proposals ?? {}).filter(shown),
    [data, shown],
  );
  const dismissed = useMemo(() => dismissedProposals(ROADMAP_PROPOSALS, data?.proposals ?? {}), [data]);
  const proposalsOpen = showProposals ?? proposals.length <= 3;
  const done = useMemo(
    () => laneItems(items, 'done').filter(shown).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    [items, shown],
  );

  /**
   * One place up or down among what is shown (roadmapCore.ts `planShift`): with an area filter on, past the items it
   * hides. A lane whose ranks have grown too close gets fresh ones, in its new order, in one transaction.
   */
  const shift = (item: RoadmapItemOut, by: -1 | 1) => {
    const lane = laneItems(items, item.lane);
    const plan = planShift(lane, new Set(lane.filter(shown).map((i) => i.id)), item.id, by);
    if (!plan) return;
    void run(item.id, [plan.kind === 'rank'
      ? { op: 'move', id: item.id, seen: item.updatedAt, lane: item.lane, rank: plan.rank }
      : { op: 'reorder', lane: item.lane, ids: plan.order }]);
  };

  /** To the end of another lane; to Done keeping its rank (Done is ordered by date). The lane and the rank only. */
  const moveTo = (item: RoadmapItemOut, lane: RoadmapLane) => {
    const rank = lane === 'done' ? item.rank : endOf(items, lane, item.id);
    void run(item.id, [{ op: 'move', id: item.id, seen: item.updatedAt, lane, rank }]);
  };

  const addProposal = (p: RoadmapProposal) => {
    void run(p.id, [{
      op: 'create', proposalId: p.id,
      fields: { title: p.title, note: p.note, area: p.area, lane: p.lane, rank: endOf(items, p.lane) },
    }]);
  };

  const saveDraft = async () => {
    if (!editing) return;
    const { id, draft, seen } = editing;
    const target = id === 'new' ? null : items.find((i) => i.id === id) ?? null;
    if (id !== 'new' && !target) {
      setActionError('That item is gone. The roadmap has been read again.');
      setEditing(null);
      return;
    }
    const rank = target && target.lane === draft.lane ? target.rank : endOf(items, draft.lane, target?.id);
    const fields = { title: draft.title, note: draft.note, area: draft.area, lane: draft.lane, rank };
    const ok = await run(id, [target ? { op: 'update', id: target.id, seen, fields } : { op: 'create', fields }]);
    if (ok) setEditing(null);
  };

  if (!data) {
    return loadFailed ? (
      <div role="alert" className="flex flex-col items-start gap-2 p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-sm text-rose-700 dark:text-rose-300">
        The roadmap could not be loaded. The error has been logged.
        <button type="button" disabled={loading} onClick={() => void load()} className="min-h-[36px] px-3 rounded-lg border border-rose-300 dark:border-rose-700 font-bold">Try again</button>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-sm text-zinc-500 p-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading the roadmap…</div>
    );
  }

  const card = (item: RoadmapItemOut, index: number, count: number) => {
    if (editing?.id === item.id) {
      return (
        <li key={item.id}>
          <ItemForm
            draft={editing.draft}
            onChange={(draft) => setEditing({ ...editing, draft })}
            onSave={() => void saveDraft()}
            onCancel={() => setEditing(null)}
            busy={busy !== null}
            saving={busy === item.id}
            saveLabel="Save"
          />
        </li>
      );
    }
    const laneAt = OPEN_LANES.indexOf(item.lane as OpenLane);
    const left = laneAt > 0 ? OPEN_LANES[laneAt - 1] : null;
    const right = laneAt >= 0 && laneAt < OPEN_LANES.length - 1 ? OPEN_LANES[laneAt + 1] : null;
    const waiting = busy !== null;
    const iconButton = 'p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40';
    return (
      <li key={item.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 break-words min-w-0">{item.title}</p>
          <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200">{AREA_LABEL[item.area]}</span>
        </div>
        {item.note && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-line break-words">{item.note}</p>}
        {confirmDelete === item.id ? (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-rose-700 dark:text-rose-300 font-bold">Delete this item?</span>
            <button type="button" disabled={waiting} onClick={() => { setConfirmDelete(null); void run(item.id, [{ op: 'delete', id: item.id }]); }} aria-label={`Delete “${item.title}” for good`} className="min-h-[32px] px-3 rounded-lg bg-rose-600 text-white font-bold">Delete</button>
            <button type="button" ref={keepRef} onClick={() => { setConfirmDelete(null); setFocusDeleteOf(item.id); }} className="min-h-[32px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700">Keep</button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-0.5">
            <button type="button" disabled={waiting || index === 0} onClick={() => shift(item, -1)} aria-label={`Move “${item.title}” up`} className={iconButton}><ArrowUp className="w-4 h-4" /></button>
            <button type="button" disabled={waiting || index === count - 1} onClick={() => shift(item, 1)} aria-label={`Move “${item.title}” down`} className={iconButton}><ArrowDown className="w-4 h-4" /></button>
            {left && <button type="button" disabled={waiting} onClick={() => moveTo(item, left)} aria-label={`Move “${item.title}” to ${LANE_LABEL[left]}`} className={iconButton}><ArrowLeft className="w-4 h-4" /></button>}
            {right && <button type="button" disabled={waiting} onClick={() => moveTo(item, right)} aria-label={`Move “${item.title}” to ${LANE_LABEL[right]}`} className={iconButton}><ArrowRight className="w-4 h-4" /></button>}
            <button type="button" disabled={waiting} onClick={() => moveTo(item, 'done')} aria-label={`Mark “${item.title}” done`} className={iconButton}><Check className="w-4 h-4" /></button>
            <button type="button" disabled={waiting} onClick={() => setEditing({ id: item.id, seen: item.updatedAt, draft: { title: item.title, note: item.note, area: item.area, lane: item.lane } })} aria-label={`Edit “${item.title}”`} className={iconButton}><Pencil className="w-4 h-4" /></button>
            <button
              type="button" disabled={waiting} onClick={() => setConfirmDelete(item.id)} aria-label={`Delete “${item.title}”`} className={iconButton}
              ref={(el) => { if (el) deleteRefs.current.set(item.id, el); else deleteRefs.current.delete(item.id); }}
            ><Trash2 className="w-4 h-4" /></button>
            {busy === item.id && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing({ id: 'new', seen: null, draft: { ...EMPTY_DRAFT, area: area === 'all' ? 'other' : area } })}
          className="min-h-[36px] px-3 rounded-lg bg-primary text-white text-sm font-bold flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add item
        </button>
        <button
          type="button"
          disabled={busy !== null || loading}
          onClick={() => { setActionError(null); void load(); }}
          className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5"
        >
          <RefreshCw className="w-4 h-4" /> Reload
        </button>
        <label className="text-xs font-bold text-zinc-500 flex items-center gap-2">Area
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as RoadmapArea | 'all')}
            className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-normal text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All areas</option>
            {ROADMAP_AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
          </select>
        </label>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-sm text-rose-700 dark:text-rose-300">
          <span className="flex-1">That change was not saved: {actionError}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss" className="p-1"><X className="w-4 h-4" /></button>
        </div>
      )}
      {rereadFailed && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-200">
          <span className="flex-1">The roadmap could not be read again, so what is shown may be out of date.</span>
          <button type="button" disabled={loading} onClick={() => void load()} className="min-h-[32px] px-3 rounded-lg border border-amber-300 dark:border-amber-700 font-bold">Try again</button>
        </div>
      )}
      {data.truncated && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-300">The roadmap holds more items than this list reads. Delete some; Done items count too.</p>
      )}

      {editing?.id === 'new' && (
        <ItemForm
          draft={editing.draft}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSave={() => void saveDraft()}
          onCancel={() => setEditing(null)}
          busy={busy !== null}
          saving={busy === 'new'}
          saveLabel="Add"
        />
      )}

      {proposals.length > 0 && (
        <section aria-label="Proposed by Claude" className="border border-primary/40 rounded-xl p-3">
          {/* Folded when there are many, so the lanes stay in sight on a phone; the count says how many wait. */}
          <h3 className="text-sm font-bold text-primary">
            <button type="button" onClick={() => setShowProposals((v) => !v)} aria-expanded={proposalsOpen} className="flex items-center gap-1.5 min-h-[32px]">
              <Sparkles className="w-4 h-4" /> Proposed by Claude · {proposals.length} <span aria-hidden="true">{proposalsOpen ? '▾' : '▸'}</span>
            </button>
          </h3>
          {proposalsOpen && <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {proposals.map((p) => (
              <li key={p.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-0 break-words">{p.title}</p>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200">{AREA_LABEL[p.area]}</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-300">{p.note}</p>
                <div className="mt-1 flex gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => addProposal(p)} aria-label={`Add “${p.title}” to ${LANE_LABEL[p.lane]}`} className="min-h-[32px] px-3 rounded-lg bg-primary text-white text-xs font-bold">
                    Add to {LANE_LABEL[p.lane]}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void run(p.id, [{ op: 'dismiss', proposalId: p.id }])} aria-label={`Dismiss “${p.title}”`} className="min-h-[32px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300">
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>}
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {OPEN_LANES.map((lane) => {
          const inLane = laneItems(items, lane).filter(shown);
          return (
            <section key={lane} aria-label={LANE_LABEL[lane]} className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-3">
              <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 flex justify-between mb-2">
                <span>{LANE_LABEL[lane]}</span><span className="text-zinc-400 tabular-nums">{inLane.length}</span>
              </h3>
              {inLane.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">Nothing here yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">{inLane.map((item, n) => card(item, n, inLane.length))}</ul>
              )}
            </section>
          );
        })}
      </div>

      <section aria-label="Done">
        <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
          {showDone ? '▾' : '▸'} Done · {done.length}
        </button>
        {showDone && (
          <ul className="mt-2 flex flex-col gap-1">
            {done.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm py-1 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-xs text-zinc-400 tabular-nums w-28 shrink-0">{fmtDay(item.doneAt)}</span>
                <span className="flex-1 min-w-0 truncate text-zinc-700 dark:text-zinc-200">{item.title}</span>
                <span className="text-[11px] text-zinc-400">{AREA_LABEL[item.area]}</span>
                <button type="button" disabled={busy !== null} onClick={() => moveTo(item, 'next')} aria-label={`Reopen “${item.title}” in Next`} className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><RotateCcw className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dismissed.length > 0 && (
        <section aria-label="Dismissed proposals">
          <button type="button" onClick={() => setShowDismissed((v) => !v)} aria-expanded={showDismissed} className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
            {showDismissed ? '▾' : '▸'} Dismissed proposals · {dismissed.length}
          </button>
          {showDismissed && (
            <ul className="mt-2 flex flex-col gap-1">
              {dismissed.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">{p.title}</span>
                  <button type="button" disabled={busy !== null} onClick={() => void run(p.id, [{ op: 'restore', proposalId: p.id }])} aria-label={`Restore “${p.title}”`} className="min-h-[32px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs">
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
