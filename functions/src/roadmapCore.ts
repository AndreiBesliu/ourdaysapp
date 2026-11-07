// functions/src/roadmapCore.ts
//
// The admin's roadmap (07.11.2026, Admin → Roadmap): where Andrei and Claude plan what comes next in the app, in three
// lanes — now, next, later — with what shipped folded under "done". What an item is, and what the server accepts.
//
// Pure: no imports. The server validates with it (roadmapStore.ts), and the admin screen imports the very same limits
// and ordering (src/components/AdminRoadmap.tsx), so the form and the server cannot disagree about what fits;
// src/utils/functionsPurity.test.ts keeps it free of anything only the functions install.

export const ROADMAP_LANES = ["now", "next", "later", "done"] as const;
export type RoadmapLane = (typeof ROADMAP_LANES)[number];

export const ROADMAP_AREAS = ["calendar", "chat", "wallet", "arcade", "warlord", "admin", "infra", "other"] as const;
export type RoadmapArea = (typeof ROADMAP_AREAS)[number];

/** Characters (code points), not UTF-16 units: a title of emoji is as long as it looks. */
export const ROADMAP_TITLE_MAX = 120;
export const ROADMAP_NOTE_MAX = 1000;
/** Items kept at most: a plan, not an archive. The server refuses a create once there are this many. */
export const ROADMAP_MAX_ITEMS = 500;
/**
 * Items the list reads at most. Above the cap on purpose: the cap is counted before the create, outside its
 * transaction, so two creates at once can each find room and pass it by one (review of 07.11.2026). Such an item is
 * still listed, and can be deleted, rather than cut off unseen.
 */
export const ROADMAP_READ_MAX = ROADMAP_MAX_ITEMS + 50;
/** Ranks stay in a range where halving between two neighbours keeps meaning something. */
export const ROADMAP_RANK_MAX = 1e12;

/** A proposal's id (src/utils/roadmapProposals.ts): kebab case, short, and a valid document id by construction. */
export const PROPOSAL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** An item's id as the server makes them (auto ids), and nothing that could be a path. */
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface RoadmapFields {
  title: string;
  note: string;
  area: RoadmapArea;
  lane: RoadmapLane;
  rank: number;
}

/** An item as the list callable returns it (roadmapStore.ts `itemOut`). */
export interface RoadmapItemOut {
  id: string;
  title: string;
  note: string;
  area: RoadmapArea;
  lane: RoadmapLane;
  rank: number;
  /** Milliseconds since the epoch, or null when the server never stamped it (a hand-made document). */
  createdAt: number | null;
  updatedAt: number | null;
  doneAt: number | null;
  proposalId: string | null;
}

export interface RoadmapRead {
  items: RoadmapItemOut[];
  /** What was done with each proposal: added or dismissed. One not listed is still open. */
  proposals: Record<string, "added" | "dismissed">;
  /** More items than are read: the list shows the first ones and says so. */
  truncated: boolean;
}

/**
 * The edits. An edit of an item carries `seen`: the `updatedAt` it was shown with (milliseconds, or null for a
 * hand-made document that never had one). The server refuses it when the item changed since, so a tab left open
 * cannot write back what it last saw over another admin's change (review of 07.11.2026). A move touches only the lane
 * and the rank; a reorder gives a whole lane fresh ranks in one transaction.
 */
export type RoadmapEdit =
  | { op: "create"; fields: RoadmapFields; proposalId?: string }
  | { op: "update"; id: string; seen: number | null; fields: RoadmapFields }
  | { op: "move"; id: string; seen: number | null; lane: RoadmapLane; rank: number }
  | { op: "reorder"; lane: RoadmapLane; ids: string[] }
  | { op: "delete"; id: string }
  | { op: "dismiss"; proposalId: string }
  | { op: "restore"; proposalId: string };

type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };

const chars = (s: string) => Array.from(s).length;

/** Control characters out (a newline stays in a note, never in a title); ends trimmed. */
function cleanText(raw: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  const controls = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g : /[\u0000-\u001F\u007F-\u009F]/g;
  const text = raw.replace(/\r\n?/g, "\n").replace(controls, multiline ? "" : " ");
  return (multiline ? text.replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ")).trim();
}

/** The fields of an item as the server keeps them, or why not. Text is cleaned, never cut: a long one is refused. */
export function cleanRoadmapFields(input: unknown): Verdict<RoadmapFields> {
  if (!input || typeof input !== "object") return { ok: false, reason: "no item" };
  const f = input as Record<string, unknown>;
  if (typeof f.title !== "string") return { ok: false, reason: "the title is not text" };
  const title = cleanText(f.title, false);
  if (!title) return { ok: false, reason: "the title is empty" };
  if (chars(title) > ROADMAP_TITLE_MAX) return { ok: false, reason: `the title is over ${ROADMAP_TITLE_MAX} characters` };
  if (f.note !== undefined && f.note !== null && typeof f.note !== "string") return { ok: false, reason: "the note is not text" };
  const note = typeof f.note === "string" ? cleanText(f.note, true) : "";
  if (chars(note) > ROADMAP_NOTE_MAX) return { ok: false, reason: `the note is over ${ROADMAP_NOTE_MAX} characters` };
  if (!(ROADMAP_AREAS as readonly unknown[]).includes(f.area)) return { ok: false, reason: "no such area" };
  if (!(ROADMAP_LANES as readonly unknown[]).includes(f.lane)) return { ok: false, reason: "no such lane" };
  const rank = f.rank;
  if (!usableRank(rank)) return { ok: false, reason: "the rank is not a usable number" };
  return { ok: true, value: { title, note, area: f.area as RoadmapArea, lane: f.lane as RoadmapLane, rank } };
}

/** An item id the server could have made, and nothing that could be a path. */
export function isRoadmapItemId(id: unknown): id is string {
  // `__…__` ids are Firestore's own (docId.ts `isPlainDocId` refuses them for the same reason).
  return typeof id === "string" && ITEM_ID.test(id) && !/^__.*__$/.test(id);
}

const usableRank = (rank: unknown): rank is number =>
  typeof rank === "number" && Number.isFinite(rank) && Math.abs(rank) <= ROADMAP_RANK_MAX;

/** What a request to the edit callable asks for, checked whole before anything is read or written. */
export function parseRoadmapEdit(input: unknown): Verdict<RoadmapEdit> {
  if (!input || typeof input !== "object") return { ok: false, reason: "no request" };
  const r = input as Record<string, unknown>;
  const itemId = (): Verdict<string> => (isRoadmapItemId(r.id)
    ? { ok: true, value: r.id } : { ok: false, reason: "no such item id" });
  // What the client was shown: a time, or null for an item that never had one. Required: an edit that says nothing
  // about what it saw is the stale write this exists to stop.
  const seen = (): Verdict<number | null> => (r.seen === null || (typeof r.seen === "number" && Number.isFinite(r.seen))
    ? { ok: true, value: r.seen as number | null } : { ok: false, reason: "no version seen" });
  const proposalId = (): Verdict<string> => (typeof r.proposalId === "string" && PROPOSAL_ID.test(r.proposalId)
    ? { ok: true, value: r.proposalId } : { ok: false, reason: "no such proposal id" });
  switch (r.op) {
    case "create": {
      const fields = cleanRoadmapFields(r.fields);
      if (!fields.ok) return fields;
      if (r.proposalId === undefined) return { ok: true, value: { op: "create", fields: fields.value } };
      const p = proposalId();
      return p.ok ? { ok: true, value: { op: "create", fields: fields.value, proposalId: p.value } } : p;
    }
    case "update": {
      const id = itemId();
      if (!id.ok) return id;
      const v = seen();
      if (!v.ok) return v;
      const fields = cleanRoadmapFields(r.fields);
      return fields.ok ? { ok: true, value: { op: "update", id: id.value, seen: v.value, fields: fields.value } } : fields;
    }
    case "move": {
      const id = itemId();
      if (!id.ok) return id;
      const v = seen();
      if (!v.ok) return v;
      if (!(ROADMAP_LANES as readonly unknown[]).includes(r.lane)) return { ok: false, reason: "no such lane" };
      if (!usableRank(r.rank)) return { ok: false, reason: "the rank is not a usable number" };
      return { ok: true, value: { op: "move", id: id.value, seen: v.value, lane: r.lane as RoadmapLane, rank: r.rank } };
    }
    case "reorder": {
      if (!(ROADMAP_LANES as readonly unknown[]).includes(r.lane)) return { ok: false, reason: "no such lane" };
      const ids = r.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > ROADMAP_READ_MAX) return { ok: false, reason: "no order" };
      if (!ids.every(isRoadmapItemId) || new Set(ids).size !== ids.length) return { ok: false, reason: "no such item id" };
      return { ok: true, value: { op: "reorder", lane: r.lane as RoadmapLane, ids: ids as string[] } };
    }
    case "delete": {
      const id = itemId();
      return id.ok ? { ok: true, value: { op: "delete", id: id.value } } : id;
    }
    case "dismiss":
    case "restore": {
      const p = proposalId();
      return p.ok ? { ok: true, value: { op: r.op, proposalId: p.value } } : p;
    }
    default:
      return { ok: false, reason: "no such operation" };
  }
}

/**
 * When an item reached "done": kept while it stays there, stamped when it arrives, cleared when it leaves. `now` is
 * what the caller stamps with (the server's time on the server).
 */
export function doneAtAfter<T>(lane: RoadmapLane, wasDone: boolean, previous: T | null, now: T): T | null {
  if (lane !== "done") return null;
  return wasDone && previous !== null ? previous : now;
}

/**
 * A rank between two neighbours, for an item put there: below everything, above everything, or halfway. Ranks only
 * order; their values mean nothing. Halving keeps working for about fifty moves into the same gap, and the screen
 * spreads a lane out again when two neighbours get too close (`needsRespread`).
 */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/** Neighbours this close cannot be told apart for much longer: time to give the lane fresh, even ranks. */
export function needsRespread(ranks: readonly number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (!(ranks[i] - ranks[i - 1] > 1e-6)) return true;
  }
  return false;
}

/** The order of a lane: by rank, then by when it was made, then by id, so equal ranks never swap between reads. */
export function compareRoadmapItems(
  a: { rank: number; createdAt: number | null; id: string },
  b: { rank: number; createdAt: number | null; id: string },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const ac = a.createdAt ?? 0;
  const bc = b.createdAt ?? 0;
  if (ac !== bc) return ac - bc;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The lane an item is shown in: its own, or Later for a hand-made document whose lane is not one (roadmapStore.ts). */
export function shownLane(lane: unknown): RoadmapLane {
  return (ROADMAP_LANES as readonly unknown[]).includes(lane) ? lane as RoadmapLane : "later";
}

/** A rank as the list may show it: a finite number within the bounds the server accepts back (a hand-made document). */
export function shownRank(rank: unknown): number {
  if (typeof rank !== "number" || !Number.isFinite(rank)) return 0;
  return Math.max(-ROADMAP_RANK_MAX, Math.min(ROADMAP_RANK_MAX, rank));
}

/** What a move becomes: a new rank for the item, or the lane's whole new order when its ranks have grown too close. */
export type MovePlan = { kind: "rank"; rank: number } | { kind: "reorder"; order: string[] } | null;

type Ranked = { id: string; rank: number };

/** Where `item` goes when put at `at` among `others` (the lane without it, in order). */
function placeAt(others: readonly Ranked[], at: number, itemId: string): MovePlan {
  const before = at > 0 ? others[at - 1].rank : null;
  const after = at < others.length ? others[at].rank : null;
  const rank = rankBetween(before, after);
  const ranks = [...others.slice(0, at).map((i) => i.rank), rank, ...others.slice(at).map((i) => i.rank)];
  if (!needsRespread(ranks)) return { kind: "rank", rank };
  return { kind: "reorder", order: [...others.slice(0, at).map((i) => i.id), itemId, ...others.slice(at).map((i) => i.id)] };
}

/**
 * One place up or down, among what the admin SEES: with an area filter on, a step passes the items it hides and lands
 * just before (or after) the next visible one — a step that changed nothing on screen read as a broken button
 * (review of 07.11.2026). `lane` is the whole lane in order, `visible` the ids shown; null when there is nowhere to go.
 */
export function planShift(lane: readonly Ranked[], visible: ReadonlySet<string>, itemId: string, by: -1 | 1): MovePlan {
  const shown = lane.filter((i) => visible.has(i.id));
  const at = shown.findIndex((i) => i.id === itemId);
  if (at < 0) return null;
  const neighbour = shown[at + by];
  if (!neighbour) return null;
  const others = lane.filter((i) => i.id !== itemId);
  const n = others.findIndex((i) => i.id === neighbour.id);
  return placeAt(others, by < 0 ? n : n + 1, itemId);
}

/**
 * The rank at the end of a lane (`lane`: that lane in order): one past the last. The gap there is always a whole 1, so
 * an item put at the end never needs the lane spread out, however crowded its middle is.
 */
export function rankAtEnd(lane: readonly Ranked[], itemId?: string): number {
  const others = itemId ? lane.filter((i) => i.id !== itemId) : lane;
  return rankBetween(others.length ? others[others.length - 1].rank : null, null);
}
