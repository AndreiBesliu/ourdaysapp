// functions/src/aiSources.ts
// Reading, for one caller, only what that caller could already have seen.
//
// Everything here runs on the Admin SDK, which ignores `firestore.rules` completely. So each
// fetcher below re-derives, in code, the rule it mirrors. That is the whole job of this file,
// and it is why it takes a `Scope` — a branded value with exactly one constructor — instead of
// a `uid` it would have to trust.
//
// Two rules that apply to every fetcher:
//   • NEVER `collectionGroup`. On the Admin SDK `db.collectionGroup('messages')` returns every
//     group in the database and produces a plausible answer rather than an error. It is a
//     one-line catastrophe, and the tempting precedent already exists in this codebase behind
//     an admin gate.
//   • Be NARROWER than the rules, never wider. Where a rule is loose, mirror the intent.

import * as admin from "firebase-admin";
import { inScope, type Scope } from "./aiScope";
import { expandInWindow, lookbackMsFor, type EventDoc } from "./recurrenceServer";
import type { Period } from "./period";
import { planFanOut } from "./fanOut";

export interface SourceResult<T> {
  items: T[];
  /** False when a limit cut the read short. It travels with the data — see the spec's gate. */
  complete: boolean;
  /** Present only when the source cannot be served at all, as a CODE the client translates. */
  unavailable?: string;
}

export interface EventItem {
  id: string;
  day: string;
  title: string;
  isTask: boolean;
  /** The group's name if the caller is still a member; otherwise a code, never a name. */
  scopeLabel: string;
  outOfScope: boolean;
  virtual: boolean;
}

/**
 * THE visibility invariant for one event, written from scratch.
 *
 * NOT ported from `CalendarHome`: the client's filter is wrapped in
 * `activeGroupId !== 'personal'`, a UI variable the server does not have. Ported literally
 * with the caller "in personal view", the condition short-circuits to false and every event a
 * member deliberately hid lands in the cross-group context.
 */
export function maySee(ev: EventDoc, uid: string): boolean {
  if (ev.ownerId === uid) return true; // personal events carry `visibleTo: []`
  const assignees = Array.isArray(ev.assigneeIds) ? ev.assigneeIds : [];
  if (assignees.includes(uid)) return true;
  if (ev.assigneeId === uid || ev.inviteeId === uid) return true; // assignment IS a read grant
  if (!Array.isArray(ev.visibleTo)) return true; // legacy / unset = unrestricted
  return (ev.visibleTo as unknown[]).includes(uid);
}

/** A pending invitation is hidden in the app until it is answered; mirror that. */
export function isPendingInvite(ev: EventDoc, uid: string): boolean {
  return ev.inviteeId === uid && ev.inviteStatus === "pending";
}

/**
 * Events and tasks — the same collection; a task is an event with `isTask: true`.
 *
 * Four branches, deduplicated by document id. The `sharedWithFamily == true` branch that the
 * read rule used to carry is DELIBERATELY ABSENT: it granted any signed-in account, and being
 * narrower than the rules is always safe. (That branch has since been removed from the rules
 * too, but this file must not depend on that having happened.)
 */
export async function fetchEvents(scope: Scope, period: Period, budget: number): Promise<SourceResult<EventItem>> {
  const db = admin.firestore();
  const col = db.collection("events");
  const uid = scope.uid;

  // Recurring parents can start long before the window, so the lower bound reaches back by the
  // client's own horizon. Two bounded passes, never one unbounded scan.
  const shortFrom = new Date(Date.parse(period.from) - lookbackMsFor("weekly")).toISOString();
  const longFrom = new Date(Date.parse(period.from) - lookbackMsFor("yearly")).toISOString();

  const perQuery = Math.max(20, Math.floor(budget / Math.max(1, 3 + scope.groupIds.length)));

  const queries: FirebaseFirestore.Query[] = [
    col.where("ownerId", "==", uid).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery),
    col.where("assigneeIds", "array-contains", uid).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery),
    col.where("assigneeId", "==", uid).where("date", ">=", shortFrom).where("date", "<=", period.to).limit(perQuery),
    col.where("inviteeId", "==", uid).where("date", ">=", shortFrom).where("date", "<=", period.to).limit(perQuery),
  ];
  for (const g of scope.groupIds) {
    queries.push(
      col.where("groupId", "==", g).where("date", ">=", longFrom).where("date", "<=", period.to).limit(perQuery)
    );
  }

  const snaps = await Promise.all(queries.map((q) => q.get().catch(() => null)));

  // Seeded from the scope, like the other fan-out fetchers. The over-claim is SMALLER here than
  // in chat — the ownerId/assignee/invitee branches still catch events inside a dropped group when
  // the caller owns or is named on them, so only passive-member group events go missing — but a
  // smaller lie is still a lie, and this flag is what a caller decides to trust on.
  let complete = !scope.truncated;
  const byId = new Map<string, EventDoc>();
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (!snap) { complete = false; continue; }
    if (snap.size >= perQuery) complete = false;
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      byId.set(doc.id, { id: doc.id, ...data });
    }
  }

  const visible = [...byId.values()].filter(
    (ev) => maySee(ev, uid) && !isPendingInvite(ev, uid)
  );

  const occurrences = expandInWindow(visible, period.fromDay, period.toDay);

  const items: EventItem[] = occurrences.map((occ) => {
    const ev = occ.source;
    const gid = typeof ev.groupId === "string" ? ev.groupId : null;
    // A group the caller has LEFT still yields events where they are a named assignee — the
    // read rule has no membership test on that branch and leaving clears only `members`. Those
    // stay visible in the product, so they stay here; but they are labelled by CODE and never
    // by name, because reading `groups/{id}` for a name would be a read the caller cannot make.
    const outOfScope = !!gid && !inScope(scope, gid);
    return {
      id: occ.virtual ? `${ev.id}_${occ.day}` : ev.id,
      day: occ.day,
      title: typeof ev.title === "string" ? ev.title : "",
      isTask: ev.isTask === true,
      scopeLabel: !gid ? "personal" : outOfScope ? "former-group" : scope.groupNames[gid] || "Group",
      outOfScope,
      virtual: occ.virtual,
    };
  });

  return { items, complete };
}

export interface ChatItem {
  groupId: string;
  senderId: string;
  day: string;
  text: string;
}

/**
 * Group chat, one query PER GROUP. Never `collectionGroup` — see the file header.
 *
 * Soft-deleted messages are skipped entirely, timestamp included: the delete blanks `text` and
 * `imageUrl` but keeps the document, so ingesting the husk yields "X said something at 14:03"
 * about a message somebody deliberately retracted.
 */
export async function fetchChat(scope: Scope, period: Period, budget: number): Promise<SourceResult<ChatItem>> {
  const db = admin.firestore();
  if (scope.groupIds.length === 0) return { items: [], complete: true };

  const perGroup = Math.max(10, Math.floor(budget / scope.groupIds.length));
  const from = admin.firestore.Timestamp.fromDate(new Date(period.from));
  const to = admin.firestore.Timestamp.fromDate(new Date(period.to));

  const snaps = await Promise.all(
    scope.groupIds.map((g) =>
      db.collection(`groups/${g}/messages`)
        .where("createdAt", ">=", from)
        .where("createdAt", "<=", to)
        .orderBy("createdAt", "asc")
        .limit(perGroup)
        .get()
        .then((s) => ({ g, s }))
        .catch(() => null)
    )
  );

  let complete = !scope.truncated; // see fetchExpenses: a capped fan-out is an incomplete read
  const items: ChatItem[] = [];
  for (const entry of snaps) {
    if (!entry) { complete = false; continue; }
    if (entry.s.size >= perGroup) complete = false;
    for (const doc of entry.s.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (d.isDeleted === true) continue;
      const created = d.createdAt as { toDate?: () => Date } | undefined;
      const when = created && typeof created.toDate === "function" ? created.toDate() : null;
      if (!when) continue;
      items.push({
        groupId: entry.g,
        senderId: typeof d.senderId === "string" ? d.senderId : "",
        day: when.toISOString().slice(0, 10),
        text: typeof d.text === "string" ? d.text : "",
      });
    }
  }
  return { items, complete };
}

export interface AssetItem { id: string; name: string }

/** The caller's own inventory, and nothing else. `sharedWithFamily` on an asset is inert —
 *  the assets rule is owner-only and never refers to it. */
export async function fetchAssets(scope: Scope, budget: number): Promise<SourceResult<AssetItem>> {
  const db = admin.firestore();
  const limit = Math.max(20, Math.min(200, budget));
  const snap = await db.collection("assets").where("ownerId", "==", scope.uid).limit(limit).get();
  return {
    items: snap.docs.map((d) => ({
      id: d.id,
      name: typeof d.data().name === "string" ? (d.data().name as string) : "",
    })),
    complete: snap.size < limit,
  };
}


export interface ExpenseItem {
  id: string;
  day: string;
  amount: number;
  description: string;
  paidBy: string;
  /** null for a personal expense — it belongs to no ledger but the caller's own. */
  groupId: string | null;
}

/**
 * Shared and personal spending, mirroring the rule this collection finally has:
 *   ownerId == uid || (groupId != null && isMemberOfGroup(groupId))
 *
 * It returned `unavailable: "no-scoping-field"` until 2026-08-25, and that was the truth rather
 * than a shrug: the documents carried only {amount, description, paidBy, createdAt}, so a Cloud
 * Function would have had to read EVERY expense in the database with nothing to filter on. The
 * collection now carries `ownerId` and `groupId`, so it can be read the same way as everything
 * else here — one query per group, never `collectionGroup`.
 *
 * The two branches overlap for anything the caller paid inside a group, so results are keyed by
 * document id. Amounts are numbers, descriptions are the player's own words: both are things the
 * caller can already see, which is the only test that matters in this file.
 */
export async function fetchExpenses(
  scope: Scope, period: Period, budget: number,
): Promise<SourceResult<ExpenseItem>> {
  const db = admin.firestore();
  const from = admin.firestore.Timestamp.fromDate(new Date(period.from));
  const to = admin.firestore.Timestamp.fromDate(new Date(period.to));
  // One share for the caller's own, the rest split across the groups — so a member of many groups
  // does not lose sight of their own spending.
  //
  // The floor of 10 is what makes a per-group share usable at all, but it USED TO BREAK THE BUDGET:
  // 26 queries at a floor of 10 reads 260 documents against a budget of 150. A budget that is
  // silently exceeded is not a budget. So the floor stays and the FAN-OUT is trimmed to fit it,
  // and trimming is reported rather than hidden — the caller is told the answer is narrower.
  const plan = planFanOut(budget, scope.groupIds.length);
  const groupIds = scope.groupIds.slice(0, plan.take);
  const trimmed = plan.trimmed;
  const perQuery = plan.perQuery;

  const run = (q: FirebaseFirestore.Query) =>
    q.where("createdAt", ">=", from)
      .where("createdAt", "<=", to)
      // DESC, not asc: when `limit` bites, the rows that survive must be the RECENT ones. The
      // Wallet tab sorts newest-first, so an ascending limit could leave the preview and that tab
      // sharing no rows at all — a scope check nobody can actually perform. Needs the matching
      // `createdAt DESCENDING` composite index, which is why the indexes ship first.
      .orderBy("createdAt", "desc")
      .limit(perQuery)
      .get()
      // Swallowing the reason would recreate the exact failure this collection is famous for: a
      // MISSING COMPOSITE INDEX throws, and an empty result then looks identical to "no expenses".
      // `complete: false` travels with the data, and the reason goes to Cloud Logging so it can be
      // told apart from a quiet month.
      .catch((err) => { console.error("fetchExpenses query failed", err?.message || err); return null; });

  const col = db.collection("expenses");
  const snaps = await Promise.all([
    run(col.where("ownerId", "==", scope.uid)),
    ...groupIds.map((g) => run(col.where("groupId", "==", g))),
  ]);

  // Seeded from the scope, not from `true`: `deriveScope` caps the fan-out, so past that cap whole
  // ledgers are never queried at all. Starting at `true` would report a read as complete when
  // entire groups had been dropped before a single query ran.
  let complete = !scope.truncated && !trimmed;
  const byId = new Map<string, ExpenseItem>();
  for (const snap of snaps) {
    if (!snap) { complete = false; continue; }
    if (snap.size >= perQuery) complete = false;
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const gid = typeof d.groupId === "string" && d.groupId ? d.groupId : null;
      // Belt and braces against a document the query matched but the rule would not: a group id
      // outside the caller's scope can only mean the data drifted from the rule.
      if (gid !== null && !inScope(scope, gid) && d.ownerId !== scope.uid) continue;
      const created = d.createdAt as { toDate?: () => Date } | undefined;
      const when = created && typeof created.toDate === "function" ? created.toDate() : null;
      if (!when) continue;
      byId.set(doc.id, {
        id: doc.id,
        day: when.toISOString().slice(0, 10),
        amount: typeof d.amount === "number" && Number.isFinite(d.amount) ? d.amount : 0,
        description: typeof d.description === "string" ? d.description : "",
        paidBy: typeof d.paidBy === "string" ? d.paidBy : "",
        groupId: gid,
      });
    }
  }
  // Every query failing is not a quiet month. Saying so is the whole reason this collection was
  // broken for three months without anyone noticing.
  if (snaps.length > 0 && snaps.every((x) => x === null)) {
    return { items: [], complete: false, unavailable: "read-failed" };
  }
  return { items: [...byId.values()], complete };
}
