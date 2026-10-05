// functions/src/accountDeletion.ts
//
// Deleting an account. One function behind both doors: the person's own, from Settings
// (`deleteMyAccount`, 04.10.2026), and an admin's (`adminModerateUser`, action "delete").
//
// ── What happens to what (Andrei, 04.10.2026) ──────────────────────────────────────────────
//
//   * A group they own passes to the member who has been in it longest. A group with no other member
//     is deleted, the way its owner would delete it (groupDeletion.ts).
//   * An event they created in a group stays in that group and passes to the group's owner. A
//     personal event goes.
//   * Their messages stay, in groups and in direct chats, under their name, marked as a deleted
//     account. The public profile, where every screen reads a name, goes with the account, so each
//     conversation they were in keeps `formerMembers.{uid} = { name, deletedAt }`.
//   * Immediately, after a typed confirmation and a recent sign-in. There is no way back.
//
// Everything else they own goes, as the admin deletion already did: wallet cards, the expenses they
// recorded, the games they started, friend requests, notifications, error rows, usage counters, the
// Warlord kingdom, the profile and the sign-in account. Invitations to or from them go, and the
// links they made are revoked and lose their name. They are taken off other people's events
// (assignee, RSVP), and the AI cost ledger keeps its rows without their uid.
//
// Before 04.10.2026 the admin deletion only took them out of `members`. A group they owned kept
// pointing at an owner who no longer existed, so nobody could delete it again, and their events in
// shared calendars were deleted from under everyone else.
//
// ── Who inherits ─────────────────────────────────────────────────────────────────────────────
//
// "Longest in the group" is the order of `members`: a group is created as `[owner]` and every join is
// an `arrayUnion`, which appends. Since 04.10.2026 only the owner may reorder it (firestore.rules):
// before that any member could, and put themselves first in line for a group whose owner deletes the
// account. The hand-over reads the group again inside a transaction, so it never names somebody who
// left while the deletion was running.
//
// An event passes to the group's owner, or, when the owner is not a member or is somebody the event
// is hidden from (`hiddenFrom` — a surprise is the usual reason), to the first member who may see it.
// When nobody may, it goes.
//
// ── Files ────────────────────────────────────────────────────────────────────────────────────
//
// A person's uploads live under their own folders, and the old cascade deleted the folders whole.
// Some of those files are shown by things that stay, and only those are kept — judged from documents
// a stranger cannot fake:
//   * their own events that stay: whatever they show from those folders (a wallet card picked as an
//     event's picture included);
//   * other people's events in their groups, which any member may edit: only what was uploaded INTO an
//     event (`events/`, `checklists/`). A wallet card's file is theirs, and anybody who has seen its
//     link could point an event at it;
//   * a wallet card they gave away: the copy shows the giver's file (assetTransfer.ts), and only the
//     server writes `transferredFrom` (firestore.rules).
// Never a profile photo or a background: nothing that stays shows them. A copy somebody made of an
// event when they left a group loses its pictures: nothing proves where its links came from.
//
// ── A deletion that stops part way can be run again ─────────────────────────────────────────
//
// Every step can be repeated, and the sign-in account goes LAST, so the person can sign in and press
// the button again. The order matters three times:
//   * The files go FIRST, while the person is still in their groups, because the keep list is read
//     from those groups. They go only once: `accountDeletions/{uid}.filesDone` records it, so a second
//     run, after the groups have let the person go, cannot read a shorter list.
//   * They come off other people's events BEFORE they leave the groups: an assignee who is not a
//     member refuses every later write to the event (`namedAreInGroup` checks the resulting document),
//     so a run stopped in between would freeze those events for everybody.
//   * The name kept on conversations is read before the profile goes, and written once.

import * as admin from "firebase-admin";
// The modular entry, not `admin.firestore.FieldValue`: under the functions emulator the namespace loses
// its statics (undefined there, the same objects in production), and this deletion was first run end to
// end on that emulator, where it failed on exactly that (04.10.2026).
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { bootstrapAdminEmails } from "./bootstrapAdmins";
import { deleteQueryInBatches, deleteFilesExcept } from "./batchDelete";
import { deleteGroupData } from "./groupDeletion";
import { groupMedia } from "./groupMedia";
import { logServerError } from "./errorLog";

const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";
const BOOTSTRAP_ADMIN_EMAILS = bootstrapAdminEmails(process.env.BOOTSTRAP_ADMIN_EMAILS);
const ALL = Number.MAX_SAFE_INTEGER;

/** How recent the last sign-in must be for the person to delete their own account. */
export const RECENT_SIGN_IN_S = 5 * 60;

/** Why a deletion was refused, in `HttpsError.details.reason`, so the app can say it properly. */
export const REFUSAL = {
  signInAgain: "recent-sign-in-required",
  admin: "admin-account",
} as const;

/**
 * `auth_time` is when the person last proved who they are, in seconds — not when the token was
 * minted, which happens every hour on its own. A minute of clock difference is tolerated.
 */
export function signedInRecently(authTime: unknown, nowS: number): boolean {
  return typeof authTime === "number" && Number.isFinite(authTime)
    && authTime <= nowS + 60 && nowS - authTime <= RECENT_SIGN_IN_S;
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

/** The first of `members`, in joining order, who is not the one leaving and not in `skip`. */
export function nextOwner(members: unknown, leaving: string, skip: ReadonlySet<string> = new Set()): string | null {
  for (const m of strList(members)) if (m !== leaving && !skip.has(m)) return m;
  return null;
}

/**
 * Who inherits an event the leaving person created in a group: the group's owner, when the owner is
 * a member and may see the event; otherwise the longest-standing member who may. Null: nobody may, and
 * the event goes. `group` is the group as it is now.
 */
export function eventHeir(
  group: Record<string, unknown> | null | undefined, leaving: string, hiddenFrom: unknown,
): string | null {
  if (!group) return null;
  const hidden = new Set(strList(hiddenFrom));
  const members = strList(group.members);
  const owner = group.ownerId;
  if (typeof owner === "string" && owner !== leaving && members.includes(owner) && !hidden.has(owner)) return owner;
  return nextOwner(members, leaving, hidden);
}

/** The name their messages keep. Never the email: an address is not what the others saw. */
export function keptName(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 100);
  }
  return null;
}

/** The person's own folders. The slash, and the `_` of the two flat ones, keep `ab` from reaching `abc`. */
export function ownFolders(uid: string): string[] {
  return [`assets/${uid}/`, `events/${uid}/`, `checklists/${uid}/`, `profiles/${uid}_`, `backgrounds/${uid}_`];
}

/**
 * The Storage object a download URL points at. `getDownloadURL` makes
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?alt=media&token=…`, and the
 * emulator the same on its own host.
 */
export function storagePathOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const m = /^\/v0\/b\/[^/]+\/o\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** The files an event shows: its picture, and its checklist items' pictures. */
export function filesShownBy(ev: Record<string, unknown>): string[] {
  const urls: unknown[] = [ev.imageUrl];
  if (Array.isArray(ev.checklistItems)) {
    for (const item of ev.checklistItems) {
      if (item && typeof item === "object") urls.push((item as Record<string, unknown>).assetUrl);
    }
  }
  const out: string[] = [];
  for (const u of urls) {
    const p = storagePathOf(u);
    if (p) out.push(p);
  }
  return out;
}

const groupIdOf = (ev: Record<string, unknown>): string | null =>
  typeof ev.groupId === "string" && ev.groupId ? ev.groupId : null;

type Doc = admin.firestore.QueryDocumentSnapshot;

/** Called through this object, so a test can make the files fail and prove the deletion stops. */
export const accountFiles = { deleteExcept: deleteFilesExcept };

/**
 * Every document a query matches, page by page, for queries this cascade does not drain as it reads.
 * The cursor is the document id, which an equality or array filter can be ordered by without an index.
 */
async function forEachDoc(query: admin.firestore.Query, each: (d: Doc) => void | Promise<void>): Promise<void> {
  let last: Doc | null = null;
  for (;;) {
    let q = query.orderBy(FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) await each(d);
    if (snap.size < 500) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Apply `each` to a query's documents until none match. Every caller's `each` makes its document
 * stop matching, so the same query drains itself, and every page is committed, so a retry picks up
 * where a stopped run left off. The bound turns a write that silently does nothing into an error
 * instead of a spin.
 */
async function drain(
  query: admin.firestore.Query,
  each: (d: Doc, batch: admin.firestore.WriteBatch) => void | Promise<void>,
): Promise<number> {
  const db = admin.firestore();
  let n = 0;
  for (let page = 0; ; page++) {
    const snap = await query.limit(300).get();
    if (snap.empty) return n;
    if (page >= 200) throw new HttpsError("deadline-exceeded", "Still working through the account's data. Try again.");
    const batch = db.batch();
    for (const d of snap.docs) await each(d, batch);
    await batch.commit();
    n += snap.size;
  }
}

export interface AccountDeletion {
  authDeleted: boolean;
  /** Null when an earlier run had already dealt with the files. */
  files: { deleted: number; kept: number } | null;
  counts: Record<string, number>;
}

/**
 * Delete account `uid`. `by` is who asked: "self", or "admin:<uid>". Throws, with the sign-in
 * account still there, if any step fails, so the deletion can be asked for again.
 */
export async function deleteAccountData(uid: string, by: string): Promise<AccountDeletion> {
  const db = admin.firestore();
  const counts: Record<string, number> = {};
  const add = (key: string, n: number) => { counts[key] = (counts[key] || 0) + n; };

  // ── Who they are, read before anything goes ──────────────────────────────────────────────
  const [userSnap, profileSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`profiles/${uid}`).get()]);
  let authUser: admin.auth.UserRecord | null = null;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (err: any) {
    // "No such account" is an answer: a run that deleted it already, or an admin cleaning up after
    // one. Anything else is the lookup failing, and nothing has been touched yet.
    if (err?.code !== "auth/user-not-found") throw new HttpsError("unavailable", "Could not read the account. Nothing was changed.");
  }
  const user = userSnap.data() || {};
  const name = keptName(profileSnap.data()?.name, user.name, authUser?.displayName);
  const email = (authUser?.email || (typeof user.email === "string" ? user.email : "")).trim().toLowerCase();
  // Anyone can sign up with somebody else's address. Only a proven one may take what was sent to it.
  const provenEmail = email && authUser?.emailVerified ? email : "";
  const former = { name, deletedAt: FieldValue.serverTimestamp() };

  const recordRef = db.doc(`accountDeletions/${uid}`);
  const record = await recordRef.get();
  if (!record.exists) await recordRef.set({ startedAt: FieldValue.serverTimestamp(), by });

  const memberGroups = async () => (await db.collection("groups").where("members", "array-contains", uid).get()).docs;
  const readGroup = async (gid: string): Promise<Record<string, unknown> | null> => {
    const s = await db.doc(`groups/${gid}`).get();
    return s.exists ? (s.data() || {}) : null;
  };

  // ── 1. Their files, except those something that stays still shows. Once. ─────────────────
  let files: AccountDeletion["files"] = null;
  if (record.data()?.filesDone !== true) {
    const groups = await memberGroups();
    const asNow = new Map(groups.map((g) => [g.id, g.data() || {}]));
    const elsewhere = new Map<string, Record<string, unknown> | null>();
    const groupOf = async (gid: string) => {
      if (asNow.has(gid)) return asNow.get(gid)!;
      if (!elsewhere.has(gid)) elsewhere.set(gid, await readGroup(gid));
      return elsewhere.get(gid) ?? null;
    };
    // Their event stays when somebody inherits it. The group's owner may change on the way out, but
    // the heir does not: whoever is first in line now is the owner then. A group with nobody else in
    // it has no heir, and goes with them, their events in it included.
    const theirsStays = async (ev: Record<string, unknown>) => {
      const gid = groupIdOf(ev);
      return !!gid && eventHeir(await groupOf(gid), uid, ev.hiddenFrom) !== null;
    };

    const keep = new Set<string>();
    const keepUnder = (ev: Record<string, unknown>, folders: string[]) => {
      for (const p of filesShownBy(ev)) if (folders.some((f) => p.startsWith(f))) keep.add(p);
    };
    const anyOfTheirs = [`assets/${uid}/`, `events/${uid}/`, `checklists/${uid}/`];
    const uploadedIntoEvents = [`events/${uid}/`, `checklists/${uid}/`];

    for (const g of groups) {
      await forEachDoc(db.collection("events").where("groupId", "==", g.id), async (d) => {
        const ev = d.data() || {};
        if (ev.ownerId !== uid) keepUnder(ev, uploadedIntoEvents);
        else if (await theirsStays(ev)) keepUnder(ev, anyOfTheirs);
      });
    }
    // Their events in groups they had already left: those are inherited too.
    await forEachDoc(db.collection("events").where("ownerId", "==", uid), async (d) => {
      const ev = d.data() || {};
      const gid = groupIdOf(ev);
      if (gid && asNow.has(gid)) return; // read above
      if (await theirsStays(ev)) keepUnder(ev, anyOfTheirs);
    });
    // Wallet cards they gave away.
    await forEachDoc(db.collection("assets").where("transferredFrom", "==", uid), (d) => {
      const p = storagePathOf(d.data()?.imageUrl);
      if (p && p.startsWith(`assets/${uid}/`)) keep.add(p);
    });

    const out = await accountFiles.deleteExcept(ownFolders(uid), keep);
    if (!out.ok) {
      throw new HttpsError("unavailable", "Some of the files could not be removed yet. Try again: it continues where it stopped.");
    }
    await recordRef.set({ filesDone: true, filesDeleted: out.deleted, filesKept: out.kept }, { merge: true });
    files = { deleted: out.deleted, kept: out.kept };
  }

  // ── 2. Off other people's events, while they are still a member ─────────────────────────
  // Reminders also go to every assignee.
  await drain(db.collection("events").where("assigneeIds", "array-contains", uid), (d, batch) => {
    batch.update(d.ref, { assigneeIds: FieldValue.arrayRemove(uid) });
    add("eventsUnassigned", 1);
  });
  // The older single field, which the app keeps as the list's first: after the list, so the next one
  // in it is a person who still exists.
  await drain(db.collection("events").where("assigneeId", "==", uid), (d, batch) => {
    const ids = d.data()?.assigneeIds;
    batch.update(d.ref, { assigneeId: Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : null });
  });
  // An answer from somebody who no longer exists would still count as a guest. Only in their groups:
  // anybody may create events of their own with any answers in them, and those are nobody's business.
  for (const g of await memberGroups()) {
    await forEachDoc(db.collection("events").where("groupId", "==", g.id), async (d) => {
      const rsvps = d.data()?.rsvps;
      if (!rsvps || typeof rsvps !== "object" || !(uid in rsvps)) return;
      await d.ref.update(new FieldPath("rsvps", uid), FieldValue.delete());
      add("rsvpsRemoved", 1);
    });
  }

  // ── 3. Their groups, each read again in a transaction ────────────────────────────────────
  const inGroups = await memberGroups();
  const seen = new Set(inGroups.map((g) => g.id));
  // A group they own without being in it: an owner may take themselves off the list.
  const ownedOnly = (await db.collection("groups").where("ownerId", "==", uid).get()).docs.filter((g) => !seen.has(g.id));
  for (const g of [...inGroups, ...ownedOnly]) {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(g.ref);
      if (!snap.exists) return "gone";
      const data = snap.data() || {};
      const members = strList(data.members);
      const heir = nextOwner(members, uid);
      if (!heir) return "alone";
      // Field paths, not dotted strings: a uid is not guaranteed to be free of dots.
      const changes: unknown[] = [new FieldPath("formerMembers", uid), former];
      if (members.includes(uid)) changes.push("members", FieldValue.arrayRemove(uid));
      if (data.ownerId === uid) changes.push("ownerId", heir);
      // The varargs form, so the field paths stay paths; typed loosely because its overloads cannot
      // take a spread.
      (tx as unknown as { update(ref: unknown, ...fieldsAndValues: unknown[]): unknown }).update(g.ref, ...changes);
      return data.ownerId === uid ? "handedOver" : "left";
    });
    if (outcome === "alone") {
      await deleteGroupData(g.id, uid, new Set());
      add("groupsDeleted", 1);
      continue;
    }
    if (outcome === "handedOver") add("groupsHandedOver", 1);
    if (outcome === "left") add("groupsLeft", 1);
    await db.doc(`groups/${g.id}/typing/${uid}`).delete();
  }

  // ── 4. Their events: a group's stay with whoever inherits, the rest go ───────────────────
  const groupNow = new Map<string, Record<string, unknown> | null>();
  await drain(db.collection("events").where("ownerId", "==", uid), async (d, batch) => {
    const ev = d.data() || {};
    const gid = groupIdOf(ev);
    if (gid && !groupNow.has(gid)) groupNow.set(gid, await readGroup(gid));
    const heir = gid ? eventHeir(groupNow.get(gid), uid, ev.hiddenFrom) : null;
    if (heir) {
      batch.update(d.ref, { ownerId: heir });
      add("eventsHandedOver", 1);
    } else {
      batch.delete(d.ref);
      add("eventsDeleted", 1);
    }
  });

  // ── 5. Direct chats: the conversation stays, and so do both people in it ─────────────────
  // `members` keeps them: it is what names the conversation, and the other person keeps reading it.
  // Once nobody in it is left, it goes, with its photos and voice notes.
  await forEachDoc(db.collection("chats").where("members", "array-contains", uid), async (c) => {
    const data = c.data() || {};
    const fm = data.formerMembers && typeof data.formerMembers === "object" ? data.formerMembers as Record<string, unknown> : {};
    const nobodyLeft = strList(data.members).every((m) => m === uid || !!fm[m]);
    if (nobodyLeft) {
      await groupMedia.sweep(c.id);
      await db.recursiveDelete(c.ref);
      add("chatsDeleted", 1);
      return;
    }
    if (!fm[uid]) {
      await c.ref.update(new FieldPath("formerMembers", uid), former);
      add("chatsMarked", 1);
    }
    await db.doc(`chats/${c.id}/typing/${uid}`).delete();
  });

  // ── 6. Invitations, friend requests and links ────────────────────────────────────────────
  add("invites", await deleteQueryInBatches(db.collection("group_invites").where("fromId", "==", uid), ALL));
  add("invites", await deleteQueryInBatches(db.collection("group_invites").where("toId", "==", uid), ALL));
  add("friendRequests", await deleteQueryInBatches(db.collection("friend_requests").where("fromId", "==", uid), ALL));
  add("friendRequests", await deleteQueryInBatches(db.collection("friend_requests").where("toId", "==", uid), ALL));
  if (provenEmail) {
    add("invites", await deleteQueryInBatches(db.collection("group_invites").where("toEmail", "==", provenEmail), ALL));
    add("friendRequests", await deleteQueryInBatches(db.collection("friend_requests").where("toEmail", "==", provenEmail), ALL));
  }
  // Revoked rather than deleted, as when a group goes: a link that still worked would introduce the
  // newcomer as invited by somebody who no longer exists. And without the name, which anybody holding
  // the link can read without signing in (`peekGroupInviteLink`).
  await forEachDoc(db.collection("invite_links").where("createdBy", "==", uid), async (d) => {
    const link = d.data() || {};
    if (link.revoked === true && link.createdByName == null) return;
    await d.ref.update({ revoked: true, createdByName: null });
    add("linksRevoked", 1);
  });

  // ── 7. Everything else that is theirs ────────────────────────────────────────────────────
  add("assets", await deleteQueryInBatches(db.collection("assets").where("ownerId", "==", uid), ALL));
  add("games", await deleteQueryInBatches(db.collection("games").where("createdBy", "==", uid), ALL));
  // A waiting Warlord challenge keeps its army here until accepted.
  add("warlordDeploys", await deleteQueryInBatches(db.collection("warlordDeploys").where("challengerUid", "==", uid), ALL));
  // Expenses were NOT deleted once, and that corrupted every group the person was in: the rows
  // survived, the members could still read them, the balance still SUMMED the departed person's
  // spending, but the divisor shrank when they left the member list. Everyone left was told they
  // owed more than they did.
  add("expenses", await deleteQueryInBatches(db.collection("expenses").where("ownerId", "==", uid), ALL));
  // Notifications addressed to them: the rules key them to the recipient, so nothing else can.
  add("notifications", await deleteQueryInBatches(db.collection("notifications").where("userId", "==", uid), ALL));

  // ── 8. The AI cost ledger keeps its rows, without them ───────────────────────────────────
  add("aiLedgerRows", await drain(db.collection("aiLedger").where("uid", "==", uid), (d, batch) => {
    batch.update(d.ref, { uid: null });
  }));
  // Their line in each day's spend; the day's totals stay.
  const days = await db.collection("aiSpendDaily").listDocuments();
  for (let i = 0; i < days.length; i += 400) {
    const batch = db.batch();
    for (const day of days.slice(i, i + 400)) batch.delete(day.collection("users").doc(uid));
    await batch.commit();
  }

  // ── 9. Their friends' lists ──────────────────────────────────────────────────────────────
  // In a transaction, like `removeFriend`: a friendship answered at the same moment is not lost.
  const friends: any[] = Array.isArray(user.friends) ? user.friends : [];
  for (const f of friends) {
    if (!f || typeof f.uid !== "string" || !f.uid || f.uid.includes("/")) continue;
    const peerRef = db.doc(`users/${f.uid}`);
    const unlinked = await db.runTransaction(async (tx) => {
      const peer = await tx.get(peerRef);
      const list: any[] = Array.isArray(peer.data()?.friends) ? peer.data()!.friends : [];
      const kept = list.filter((x) => x && x.uid !== uid);
      if (!peer.exists || kept.length === list.length) return false;
      tx.set(peerRef, { friends: kept }, { merge: true });
      return true;
    });
    if (unlinked) add("friendsUnlinked", 1);
  }

  // ── 10. Error rows, after everything above that could write one ──────────────────────────
  // Each carries their uid and, for client reports, their email, user agent and urls. They expire
  // after 90 days (errorRetention.ts); a deleted account's should not wait for that (25.09.2026).
  add("errorLogs", await deleteQueryInBatches(db.collection("errorLogs").where("uid", "==", uid), ALL));

  // ── 11. Their own documents ──────────────────────────────────────────────────────────────
  await Promise.all([
    "users", "profiles", "admins",
    "ai_usage", "ai_preview_usage", "ai_budget", "notif_usage", "error_usage", "warlord_challenge_usage",
    // The world roster and the cloud kingdom. Clients cannot delete either, and the roster is
    // readable by everyone signed in, so a deleted account would linger in the player directory.
    "warlordPlayers", "warlordDomains",
  ].map((c) => db.doc(`${c}/${uid}`).delete()));

  // ── 12. The sign-in account, last ────────────────────────────────────────────────────────
  let authDeleted = false;
  try {
    await admin.auth().deleteUser(uid);
    authDeleted = true;
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw new HttpsError("unavailable", "The account could not be removed yet. Try again.");
  }
  // Everything is gone by now. A note that cannot be written must not turn that into a failure: the
  // app would keep the person signed in to an account that no longer exists.
  try {
    await recordRef.set({ finishedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (err: any) {
    console.error("deleteAccountData: the finish mark was not written", err?.message || err);
  }

  return { authDeleted, files, counts };
}

/**
 * The person deletes their own account, from Settings.
 *
 * A recent sign-in is required here and not only in the app, because a session left open on a
 * shared computer is exactly the case this guards. Admin accounts are refused: losing the last admin
 * would lock the admin screen, and a bootstrap address would simply become one again at the next
 * sign-up.
 */
export const deleteMyAccount = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 540 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");
  if (!signedInRecently(request.auth?.token?.auth_time, Math.floor(Date.now() / 1000))) {
    throw new HttpsError("failed-precondition", "Sign in again to delete your account.", { reason: REFUSAL.signInAgain });
  }

  const db = admin.firestore();
  let email = "";
  try {
    email = ((await admin.auth().getUser(uid)).email || "").toLowerCase();
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw new HttpsError("unavailable", "Could not read the account. Nothing was changed.");
  }
  if ((await db.doc(`admins/${uid}`).get()).exists || BOOTSTRAP_ADMIN_EMAILS.includes(email)) {
    throw new HttpsError("failed-precondition", "An admin account cannot be deleted from here.", { reason: REFUSAL.admin });
  }

  try {
    return { ok: true, ...(await deleteAccountData(uid, "self")) };
  } catch (err: any) {
    // Without the uid: the row would outlive the account it names if the next attempt succeeds.
    await logServerError(String(err?.message || err), "deleteMyAccount", { stack: err?.stack });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "The deletion did not finish. Try again: it continues where it stopped.");
  }
});
