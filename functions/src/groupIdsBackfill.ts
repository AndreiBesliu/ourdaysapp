// functions/src/groupIdsBackfill.ts
//
// The one-off that puts on the list of used group ids (groupIds.ts) every id the list cannot learn by
// itself: groups that already existed when the list arrived, and ids whose group was deleted before
// the triggers existed (06.10.2026, the review). Without it, a group that existed before is listed only
// when it is deleted; deleted from the installed app or the console, that happens through a trigger,
// seconds later, and in those seconds anybody who knew the id could create it again.
//
// Run once, after the functions are deployed and before the rules: `scripts/backfill-used-group-ids.mjs`
// (a dry run unless told `--apply`). It lists, it does not delete or change anything else.

import * as admin from "firebase-admin";
import { registerGroupId } from "./groupIds";

/** Collections whose field names a group, and that field. */
const POINTERS: readonly [string, string][] = [
  ["events", "groupId"],
  ["expenses", "groupId"],
  ["games", "groupId"],
  ["group_invites", "groupId"],
  ["invite_links", "groupId"],
  ["assets", "sharedGroupId"],
];

/** Only an id that names exactly one document may become a path: anything else is reported, not written. */
export function isPlainDocId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 1500
    && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

export interface GroupIdBackfill {
  /** Groups that exist now. */
  live: number;
  /** Deleted group documents whose subcollections (messages, typing) were left. */
  missingParents: number;
  /** Ids named by events, expenses, games, invitations, links or wallet cards whose group is gone. */
  referencedDead: number;
  /** Everything above, once each: what `--apply` lists. */
  toRegister: string[];
  /** Field values that are not one document id (a '/' in a group id would mean somebody tried). */
  refused: string[];
  /**
   * Live groups created AFTER something of theirs that cannot be moved between groups (a message, a
   * game, an invitation, a link): the sign an id was deleted and created again. Reported, never fixed.
   */
  recreatedSuspects: string[];
}

export async function planGroupIdBackfill(db: admin.firestore.Firestore = admin.firestore()): Promise<GroupIdBackfill> {
  const groups = await db.collection("groups").get();
  const live = new Set(groups.docs.map((g) => g.id));
  const ids = new Set<string>(live);
  const refused = new Set<string>();

  let missingParents = 0;
  for (const ref of await db.collection("groups").listDocuments()) {
    if (live.has(ref.id)) continue;
    missingParents++;
    ids.add(ref.id);
  }

  const dead = new Set<string>();
  for (const [coll, field] of POINTERS) {
    for (const d of (await db.collection(coll).get()).docs) {
      const g = d.get(field);
      if (g === null || g === undefined || g === "") continue;
      if (!isPlainDocId(g)) { refused.add(String(g)); continue; }
      if (!live.has(g)) dead.add(g);
      ids.add(g);
    }
  }

  const recreatedSuspects: string[] = [];
  for (const g of groups.docs) {
    const born = g.createTime.toMillis();
    const older = async (q: admin.firestore.Query) => (await q.get()).docs.some((d) => d.createTime.toMillis() < born);
    if (await older(g.ref.collection("messages"))
        || await older(db.collection("games").where("groupId", "==", g.id))
        || await older(db.collection("group_invites").where("groupId", "==", g.id))
        || await older(db.collection("invite_links").where("groupId", "==", g.id))) {
      recreatedSuspects.push(g.id);
    }
  }

  return {
    live: live.size,
    missingParents,
    referencedDead: dead.size,
    toRegister: [...ids].sort(),
    refused: [...refused].sort(),
    recreatedSuspects: recreatedSuspects.sort(),
  };
}

/** Lists every id of the plan. Idempotent. Returns how many were not on the list before. */
export async function applyGroupIdBackfill(ids: readonly string[], db: admin.firestore.Firestore = admin.firestore()): Promise<number> {
  let added = 0;
  for (const id of ids) {
    if (!isPlainDocId(id)) continue;
    const before = (await db.doc(`usedGroupIds/${id}`).get()).exists;
    await registerGroupId(id);
    if (!before) added++;
  }
  return added;
}
