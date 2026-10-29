// functions/src/adminRead.ts
//
// How the Admin callables read what members write (29.10.2026).
//
// Since 10.10.2026 every Admin read takes only the fields it counts (`select`). The counted fields
// themselves could still be made large: a personal event's `isTask` or `categoryId`, a game's
// `status`, a notification's `read`, a person's own `name` or `birthday` — up to 1 MiB each, or a list
// of a million nulls, which is about 100 MB once decoded (batchDelete.ts). A few hundred of those ran
// a panel read of 5000 or 8000 documents out of memory, for the admin, at every opening. So:
//   * a number that only says whether a field is set, or how many hold one of the values the app
//     writes, is COUNTED from the index (`count()`): no document is read at all;
//   * what must be read — a card's category, a person's name, a friends list — is read ten a page
//     (FIELD_PAGE), only fields the rules keep to one value each or the server writes, and the read
//     stops at a time budget and says so (`truncated`), rather than running the callable out of time.
// Every count form here was measured on live the day it was written: no new index, and each number
// equal to the one the documents gave.

import * as admin from "firebase-admin";
import { forEachDoc, type Field } from "./batchDelete";
import { withRest } from "./adminTally";

type Query = admin.firestore.Query;

/** How long one paged read may take before it stops (`truncated`). A test sets it below zero. */
export const ADMIN_READ = { budgetMs: 20_000 };

/** The answers a friend request or an invitation can hold; the server writes the last two. */
export const ANSWER_STATUSES = ["pending", "accepted", "declined"] as const;

/** The states a game is in: the arcade's and the Warlord battles'. */
export const GAME_STATUSES = ["waiting", "playing", "finished"] as const;

/** A task's state: the event form writes the first two at creation, the details window the other two. */
export const TASK_STATUSES = ["none", "not-started", "started", "completed"] as const;

/** How many documents a query matches, from the index: nothing is read. 0 when it fails, as the totals always were. */
export function howMany(q: Query): Promise<number> {
  return q.count().get().then((s) => s.data().count).catch(() => 0);
}

/**
 * A breakdown by a field anybody may write, without reading the field: one count for each value the
 * app writes, and everything else (`total` minus those) under `rest`. Unknown text no longer gets a
 * line of its own; it never held anything the app wrote.
 */
export async function breakdown(q: Query, field: string, known: readonly string[], total: Promise<number>, rest: string): Promise<Record<string, number>> {
  const [counts, all] = await Promise.all([Promise.all(known.map((k) => howMany(q.where(field, "==", k)))), total]);
  return withRest(Object.fromEntries(known.map((k, i) => [k, counts[i]])), all, rest);
}

/**
 * Every document of `q`, ten a page with only `fields`, until the budget runs out. True when it read
 * them all; false when it stopped, so the caller can say the numbers are partial.
 */
export async function readPaged(
  q: Query, fields: Field[], each: (d: admin.firestore.QueryDocumentSnapshot) => void,
): Promise<boolean> {
  const started = Date.now();
  const { done } = await forEachDoc(q, fields, each, { stop: () => Date.now() - started > ADMIN_READ.budgetMs });
  return done;
}
