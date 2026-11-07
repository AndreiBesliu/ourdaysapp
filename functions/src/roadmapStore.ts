// functions/src/roadmapStore.ts
//
// The roadmap's reads and writes (07.11.2026), behind the two admin callables in index.ts (`adminGetRoadmap`,
// `adminEditRoadmap`), which check the caller is an admin first. What is accepted is decided in roadmapCore.ts.
//
// `roadmap/{id}` holds the items; `roadmapProposals/{proposalId}` remembers what was done with each of Claude's
// proposals (src/utils/roadmapProposals.ts): added (with the item it became) or dismissed. Neither is readable or
// writable by a client (no rule matches them, so the rules refuse; rules-tests/personal.test.ts).
//
// Two admins, or two tabs of one, can act at once. An edit of an item says which version it saw (`seen`) and is
// refused if the item changed since, so a stale tab cannot write its old copy over a newer one; a move touches only
// the lane and the rank; a lane's fresh ranks are written in one transaction, or not at all (review of 07.11.2026).
//
// Like errorLog.ts, it calls `admin.firestore()` only inside its functions, through the `db` it is handed.

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  ROADMAP_AREAS, ROADMAP_MAX_ITEMS, ROADMAP_NOTE_MAX, ROADMAP_READ_MAX, ROADMAP_TITLE_MAX, doneAtAfter,
  shownLane, shownRank, type RoadmapArea, type RoadmapEdit, type RoadmapFields, type RoadmapItemOut, type RoadmapRead,
} from "./roadmapCore";

export const ROADMAP = "roadmap";
export const ROADMAP_PROPOSALS = "roadmapProposals";

const millis = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null);

/**
 * An item as the screen may show it, whatever the document holds: a document written by hand in the console is
 * shown in shape (text cut to the limits, an unknown area as "other", an unknown lane as "later", a rank brought within
 * bounds), never thrown on — and in a shape the edit callable accepts back, so it can be fixed from the screen.
 */
export function itemOut(id: string, d: Record<string, unknown>): RoadmapItemOut {
  const text = (v: unknown, max: number) => (typeof v === "string" ? Array.from(v).slice(0, max).join("") : "");
  return {
    id,
    title: text(d.title, ROADMAP_TITLE_MAX).trim() || "(untitled)",
    note: text(d.note, ROADMAP_NOTE_MAX),
    area: (ROADMAP_AREAS as readonly unknown[]).includes(d.area) ? d.area as RoadmapArea : "other",
    lane: shownLane(d.lane),
    rank: shownRank(d.rank),
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
    doneAt: millis(d.doneAt),
    proposalId: typeof d.proposalId === "string" ? d.proposalId : null,
  };
}

export async function readRoadmap(db: admin.firestore.Firestore): Promise<RoadmapRead> {
  const [itemsSnap, proposalsSnap] = await Promise.all([
    db.collection(ROADMAP).limit(ROADMAP_READ_MAX + 1).get(),
    db.collection(ROADMAP_PROPOSALS).limit(1000).get(),
  ]);
  const docs = itemsSnap.docs.slice(0, ROADMAP_READ_MAX);
  const proposals: Record<string, "added" | "dismissed"> = {};
  for (const p of proposalsSnap.docs) {
    const status = p.get("status");
    if (status === "added" || status === "dismissed") proposals[p.id] = status;
  }
  return {
    items: docs.map((d) => itemOut(d.id, d.data())),
    proposals,
    truncated: itemsSnap.size > ROADMAP_READ_MAX,
  };
}

function fieldsToStore(fields: RoadmapFields) {
  return { title: fields.title, note: fields.note, area: fields.area, lane: fields.lane, rank: fields.rank };
}

const changedElsewhere = () =>
  new HttpsError("failed-precondition", "That item was changed elsewhere since you loaded it. The roadmap has been read again.");
const gone = () => new HttpsError("not-found", "That item is gone. The roadmap has been read again.");

/** The item as it stands, refused if it is gone or no longer the version the client saw. */
async function current(
  tx: admin.firestore.Transaction, ref: admin.firestore.DocumentReference, seen: number | null,
): Promise<admin.firestore.DocumentSnapshot> {
  const snap = await tx.get(ref);
  if (!snap.exists) throw gone();
  if (millis(snap.get("updatedAt")) !== seen) throw changedElsewhere();
  return snap;
}

/** One edit, in a transaction where it reads before it writes; returns the item's id where there is one. */
export async function editRoadmap(
  db: admin.firestore.Firestore, uid: string, edit: RoadmapEdit,
): Promise<{ id: string | null }> {
  const items = db.collection(ROADMAP);
  const proposals = db.collection(ROADMAP_PROPOSALS);
  switch (edit.op) {
    case "create": {
      // Under the cap, counted on the server. Counted before the transaction, so two creates at once can pass it by
      // one; the list reads past the cap (ROADMAP_READ_MAX), so such an item is still seen and can be deleted.
      const count = (await items.count().get()).data().count;
      if (count >= ROADMAP_MAX_ITEMS) {
        throw new HttpsError("resource-exhausted", `The roadmap holds ${ROADMAP_MAX_ITEMS} items. Delete some first.`);
      }
      const ref = items.doc();
      const doc = {
        ...fieldsToStore(edit.fields),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: uid,
        updatedBy: uid,
        doneAt: edit.fields.lane === "done" ? FieldValue.serverTimestamp() : null,
        ...(edit.proposalId ? { proposalId: edit.proposalId } : {}),
      };
      if (!edit.proposalId) {
        await ref.create(doc);
        return { id: ref.id };
      }
      // A proposal becomes ONE item, however many times "Add" is pressed (two tabs, a retried call): the proposal's
      // record says which item it became, in the same transaction that writes the item.
      const proposalRef = proposals.doc(edit.proposalId);
      return db.runTransaction(async (tx) => {
        const proposal = await tx.get(proposalRef);
        const existing = proposal.get("itemId");
        if (proposal.get("status") === "added" && typeof existing === "string") {
          const item = await tx.get(items.doc(existing));
          if (item.exists) return { id: existing };
        }
        tx.create(ref, doc);
        tx.set(proposalRef, { status: "added", itemId: ref.id, at: FieldValue.serverTimestamp(), by: uid });
        return { id: ref.id };
      });
    }
    case "update": {
      const ref = items.doc(edit.id);
      return db.runTransaction(async (tx) => {
        // `update`, never `set`: an item deleted meanwhile (another admin) is not brought back by a late save.
        const snap = await current(tx, ref, edit.seen);
        const doneAt = doneAtAfter<unknown>(edit.fields.lane, snap.get("lane") === "done", snap.get("doneAt") ?? null, FieldValue.serverTimestamp());
        tx.update(ref, { ...fieldsToStore(edit.fields), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid, doneAt });
        return { id: edit.id };
      });
    }
    case "move": {
      const ref = items.doc(edit.id);
      return db.runTransaction(async (tx) => {
        const snap = await current(tx, ref, edit.seen);
        const doneAt = doneAtAfter<unknown>(edit.lane, snap.get("lane") === "done", snap.get("doneAt") ?? null, FieldValue.serverTimestamp());
        // The lane and the rank only: a move from a tab that saw an older title cannot bring that title back.
        tx.update(ref, { lane: edit.lane, rank: edit.rank, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid, doneAt });
        return { id: edit.id };
      });
    }
    case "reorder": {
      // A lane's fresh ranks, 0…n-1 in the order given: all of them, or none. The order must name exactly the items
      // the lane holds now, or the lane changed since the client read it. The lane as the list SHOWS it (`shownLane`):
      // a hand-made document whose lane is not one is shown under Later, so it is counted there too — a query on the
      // stored value would never find it, and every reorder of Later would be refused for good (re-review, 07.11.2026).
      // The whole list is read for that, as the list callable reads it; a reorder is rare.
      await db.runTransaction(async (tx) => {
        const all = await tx.get(items.limit(ROADMAP_READ_MAX + 1));
        const now = new Set(all.docs.filter((d) => shownLane(d.get("lane")) === edit.lane).map((d) => d.id));
        if (now.size !== edit.ids.length || !edit.ids.every((id) => now.has(id))) throw changedElsewhere();
        edit.ids.forEach((id, rank) => {
          tx.update(items.doc(id), { rank, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
        });
      });
      return { id: null };
    }
    case "delete": {
      // An item that was a proposal sends the proposal to "Dismissed", where it can be brought back: deleting it
      // otherwise left the proposal neither open nor dismissed, with no way back from the screen.
      const ref = items.doc(edit.id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const proposalId = snap.get("proposalId");
        const proposalRef = typeof proposalId === "string" && proposalId ? proposals.doc(proposalId) : null;
        const proposal = proposalRef ? await tx.get(proposalRef) : null;
        tx.delete(ref);
        if (proposalRef && proposal?.get("itemId") === edit.id) {
          tx.set(proposalRef, { status: "dismissed", at: FieldValue.serverTimestamp(), by: uid });
        }
      });
      return { id: edit.id };
    }
    case "dismiss": {
      const ref = proposals.doc(edit.proposalId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        // An added proposal stays added: deleting its item is what dismisses it (above).
        if (snap.get("status") === "added") return;
        tx.set(ref, { status: "dismissed", at: FieldValue.serverTimestamp(), by: uid });
      });
      return { id: null };
    }
    case "restore": {
      const ref = proposals.doc(edit.proposalId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("status") === "dismissed") tx.delete(ref);
      });
      return { id: null };
    }
  }
}
