// functions/src/digestRead.ts
//
// The two reads behind the group digest's "Next 7 days". What they decide is in digestEvents.ts,
// pure; this is only the IO.
//
// ── Whose events, and how much of each (16.10.2026) ─────────────────────────────────────────
//
// Until 16.10 both read whole documents. The series query searched the WHOLE database
// (`recurrenceRule != null`, 500 documents, no group): an account with 500 personal events carrying
// any rule at all (`true` sorts before every real one) pushed every group's series out of every
// digest, and padded, ran it out of memory. The dated query brought up to 300 of the group's events
// whole, and any member can pad those (`checklistItems`, `imageUrl` and `hiddenFrom` have no limit in
// the rules). Now both are the group's own, read in pages of ten, only DIGEST_FIELDS, each event
// reduced as it arrives (`compactEvent`, as the reminders do): a padded event costs its few fields.
//
// Neither shape needs an index live lacks, measured on live that day: the series one is equalities
// (`groupId ==`, a frequency `in`), which Firestore serves from single-field indexes; the dated one
// is the composite that already served it. A missing index here would throw, not return less.

import type * as admin from "firebase-admin";
import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FREQUENCIES, type EventDoc } from "./recurrenceServer";
import { compactEvent } from "./remindersCore";
import {
  DIGEST_EVENT_SCAN, DIGEST_FIELDS, DIGEST_PAGE, DIGEST_RECURRING_SCAN, type DigestWindow,
} from "./digestEvents";

export interface DigestRead {
  /** The group's events that can reach the window, each reduced to what the lines are made from. */
  docs: EventDoc[];
  /** A query held more than its cap: the digest must say it is cut. */
  truncated: boolean;
}

export interface DigestReadOptions {
  eventScan?: number;
  recurringScan?: number;
  page?: number;
}

/**
 * One query to its end, page by page, or to one past `cap`: true when it held more than `cap`.
 * Every document fetched counts, a repeated one too (a cursor on a value longer than the 1500 bytes
 * Firestore indexes can repeat a page), so the loop ends whatever the data holds.
 */
async function readPages(
  base: admin.firestore.Query,
  cap: number,
  page: number,
  keep: (d: QueryDocumentSnapshot) => void,
): Promise<boolean> {
  let fetched = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    // One past the cap, to tell "exactly the cap" from "more than it".
    const want = Math.min(page, cap + 1 - fetched);
    const snap = await (last ? base.startAfter(last) : base).limit(want).get();
    for (const d of snap.docs) {
      fetched += 1;
      if (fetched > cap) return true;
      keep(d);
    }
    if (snap.size < want) return false;
    last = snap.docs[snap.docs.length - 1];
  }
}

/** The group's events dated in the scan window, and its series, both read as above. */
export async function readDigestEvents(
  db: admin.firestore.Firestore,
  groupId: string,
  window: DigestWindow,
  opts: DigestReadOptions = {},
): Promise<DigestRead> {
  const page = opts.page ?? DIGEST_PAGE;
  const byId = new Map<string, EventDoc>();
  const keep = (d: QueryDocumentSnapshot): void => {
    const c = compactEvent(d.id, d.data(), window.fromDay, window.toDay);
    if (c) byId.set(d.id, c);
  };
  const events = db.collection("events").where("groupId", "==", groupId);
  const [datedCut, seriesCut] = await Promise.all([
    readPages(events
      .where("date", ">=", window.scanFrom)
      .where("date", "<=", window.scanTo)
      .orderBy("date", "asc")
      .select(...DIGEST_FIELDS), opts.eventScan ?? DIGEST_EVENT_SCAN, page, keep),
    // A rule with a frequency the app knows: any other is not a series to `expandInWindow` either.
    readPages(events
      .where("recurrenceRule.frequency", "in", [...FREQUENCIES])
      .orderBy(FieldPath.documentId())
      .select(...DIGEST_FIELDS), opts.recurringScan ?? DIGEST_RECURRING_SCAN, page, keep),
  ]);
  return { docs: [...byId.values()], truncated: datedCut || seriesCut };
}
