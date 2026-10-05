// functions/src/groupLeave.ts
//
// When somebody stops being a member of a group, they come off its events that are still to come
// (Andrei, 05.10.2026; what and why in leaverCore.ts). Server-side, on the group document, because
// that is the one place every way out goes through: leaving (web, and the installed APK whose code
// cannot change), the owner taking somebody off, account deletion. A client could not do it
// anyway: once out, the leaver may no longer write the group's events, and the owner may not
// delete somebody else's RSVP.

import * as admin from "firebase-admin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { earliestTodayOf, leaverPlan } from "./leaverCore";
import { logServerError } from "./errorLog";

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

export interface LeaverSweep {
  /** Events of the group read. */
  events: number;
  /** Events written. */
  changed: number;
  unassigned: number;
  rsvpsRemoved: number;
}

/**
 * Takes everybody who is no longer a member off the group's events still to come. Reads the group
 * NOW, so somebody who came back in the meantime stays, and a run that failed is made good by the
 * next. Null when there is nothing to judge against: the group is gone (deleting a group changes
 * nothing here, by decision) or has no member list, which would make everybody a leaver.
 */
export async function takeLeaversOffEvents(groupId: string, nowMs: number = Date.now()): Promise<LeaverSweep | null> {
  const db = admin.firestore();
  const groupRef = db.doc(`groups/${groupId}`);
  const membersOf = (g: admin.firestore.DocumentSnapshot) => new Set(g.exists ? strList(g.data()?.members) : []);
  const members = membersOf(await groupRef.get());
  if (!members.size) return null;
  const today = earliestTodayOf(nowMs);

  const out: LeaverSweep = { events: 0, changed: 0, unassigned: 0, rsvpsRemoved: 0 };
  const snap = await db.collection("events").where("groupId", "==", groupId)
    .select("date", "endDayOffset", "recurrenceRule", "assigneeIds", "assigneeId", "rsvps")
    .get();
  out.events = snap.size;
  for (const d of snap.docs) {
    if (!leaverPlan(d.data(), members, today)) continue;
    // The event AND the group read again, in one transaction with the write: an edit made in between
    // is not undone, an event deleted or moved to another calendar in between is left alone, and
    // somebody let back in while this runs is judged a member.
    const written = await db.runTransaction(async (tx) => {
      const [fresh, group] = await Promise.all([tx.get(d.ref), tx.get(groupRef)]);
      const now = membersOf(group);
      const plan = fresh.exists && fresh.get("groupId") === groupId && now.size
        ? leaverPlan(fresh.data() ?? {}, now, today)
        : null;
      if (!plan) return null;
      const fields: unknown[] = [];
      if (plan.unassign.length) fields.push("assigneeIds", FieldValue.arrayRemove(...plan.unassign));
      if ("assigneeId" in plan) fields.push("assigneeId", plan.assigneeId);
      // By path: a key is a uid, and only that person's answer goes, never the map.
      for (const u of plan.rsvps) fields.push(new FieldPath("rsvps", u), FieldValue.delete());
      tx.update(fresh.ref, fields[0] as string | FieldPath, fields[1], ...fields.slice(2));
      return plan;
    });
    // Counted once the transaction is through: its body may run more than once.
    if (written) {
      out.changed += 1;
      out.unassigned += written.unassign.length;
      out.rsvpsRemoved += written.rsvps.length;
    }
  }
  return out;
}

/**
 * Fires on every write to a group, a chat message's preview included, and does nothing unless the
 * member list lost somebody. Retried by the platform when it throws: the sweep is the same whatever
 * the number of runs.
 */
export const onGroupMembersChanged = onDocumentUpdated({ document: "groups/{groupId}", retry: true }, async (event) => {
  const after = new Set(strList(event.data?.after.data()?.members));
  if (!strList(event.data?.before.data()?.members).some((u) => !after.has(u))) return;
  const groupId = event.params.groupId;
  try {
    const r = await takeLeaversOffEvents(groupId);
    console.log("LEAVERS_OFF_EVENTS", JSON.stringify({ groupId, ...(r ?? { skipped: true }) }));
  } catch (err) {
    // The group in the message: with retries, one stuck group would otherwise be a run of identical rows.
    await logServerError(`${(err as Error)?.message || "events not cleaned"} (group ${groupId})`, "groupLeave:takeLeaversOffEvents", {
      stack: (err as Error)?.stack,
    });
    throw err;
  }
});
