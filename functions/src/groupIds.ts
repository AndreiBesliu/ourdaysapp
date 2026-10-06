// functions/src/groupIds.ts
//
// Every group id ever used, so a deleted group's id cannot be created again (06.10.2026).
//
// A group is a document whose id the client chooses, and membership is "the document exists and I
// am in its list" (firestore.rules, `isMemberOfGroup`). So once G was deleted, anybody who knew "G"
// — a former member, an invitee, somebody named on one of its events, a link holder, a photo URL
// from its chat — could create `groups/G` as its only member, and everything still filed under G
// opened to them: its expenses, its games, the wallet cards shared with it, and, after a delete that
// did not go through the server (the installed APK deletes the document itself), its messages and
// events. Reproduced on the rules emulator.
//
// The groups `create` rule now refuses an id in `usedGroupIds`. Three writers fill it: when a group is
// created (a trigger), when the server deletes it (deleteGroupData, before anything else), and when its
// document is deleted by anybody (a trigger: the net for the APK and the console). A group created
// since is therefore listed from its first seconds. One that existed BEFORE the list would be listed
// only by the delete trigger, seconds after a delete from the APK — long enough to be created again —
// so those, and ids whose group was already gone, are listed once by groupIdsBackfill.ts, after the
// functions deploy and before the rules (the review, 06.10.2026). The entry holds a time and nothing
// else — no uid, no name — so nothing about a person has to be cleaned out of it later.

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logServerError } from "./errorLog";

/** Where the ids live. Closed to every client (firestore.rules). */
export const USED_GROUP_IDS = "usedGroupIds";

/** Puts `groupId` on the list. Idempotent: an id already on it is left as it is. */
export async function registerGroupId(groupId: string): Promise<void> {
  try {
    await admin.firestore().doc(`${USED_GROUP_IDS}/${groupId}`).create({ at: FieldValue.serverTimestamp() });
  } catch (err) {
    // ALREADY_EXISTS: on the list since an earlier run, or since the group was created.
    if ((err as { code?: number })?.code === 6) return;
    throw err;
  }
}

/** Retried by the platform when it throws: an id must not stay off the list for want of a retry. */
async function registerOrThrow(groupId: string, where: string): Promise<void> {
  try {
    await registerGroupId(groupId);
  } catch (err) {
    await logServerError(`${(err as Error)?.message || "group id not registered"} (group ${groupId})`, where, {
      stack: (err as Error)?.stack,
    });
    throw err;
  }
}

export const onGroupCreated = onDocumentCreated({ document: "groups/{groupId}", retry: true }, async (event) => {
  await registerOrThrow(event.params.groupId, "groupIds:onGroupCreated");
});

export const onGroupDeleted = onDocumentDeleted({ document: "groups/{groupId}", retry: true }, async (event) => {
  await registerOrThrow(event.params.groupId, "groupIds:onGroupDeleted");
});
