// functions/src/digestEvents.ts
//
// Which events the group digest's "Next 7 days" section is actually about.
//
// ── Why this is not inline in the callable ───────────────────────────────────────────────
//
// It was, and it was wrong three ways at once, each of which REMOVED events from a section that
// claimed to list them all. None of the three could be seen from outside: the digest is one
// paragraph of generated prose, so an event that never reached the model is simply an event the
// paragraph does not mention, which is indistinguishable from an event nobody had.
//
//   1. The bounds were INSTANTS. An event's `date` is midnight UTC — the client writes
//      `new Date('2026-09-19').toISOString()` — and the lower bound was `new Date().toISOString()`.
//      From one millisecond past midnight, `date >= now` was already past everything happening
//      TODAY. The nearest day the section promised was the one day it could never contain.
//   2. A repeating event is ONE document, dated when the series began. A weekly dinner started in
//      March matches no window in September, so recurring events never appeared at all.
//   3. A multi-day event is also one document, dated on its FIRST day. One that began last week
//      and runs until Friday had to be fetched before anything could decide it is still on.
//
// Pulled out here so the window and the selection can be stated and proved without a Firestore.
// The IO stays in `index.ts`; everything that decides anything is below, and pure.

import { dayPlus } from "./eventTime";
import { expandInWindow, type EventDoc } from "./recurrenceServer";

/**
 * How far back to fetch, so that an event which STARTED earlier and is still running is seen.
 *
 * `endDayOffset` permits up to 366, and this is deliberately far short of it. Reaching back a
 * year would need either a descending order — refused on live for want of a composite index — or
 * an ascending scan whose overflow drops the newest rows, which are exactly the days being asked
 * about. Thirty days covers a holiday or a trip. Past that the event is missed, and the number is
 * named here rather than buried in an expression so that the limit is a decision, not an accident.
 */
export const DIGEST_SPAN_LOOKBACK_DAYS = 30;

/** Rows fetched. Crossing it sets `truncated` rather than quietly shortening the answer. */
export const DIGEST_EVENT_SCAN = 300;

/** Recurring parents fetched. They are few; this is a backstop, not a budget. */
export const DIGEST_RECURRING_SCAN = 500;

/**
 * Events hiding from the viewer, read as references (digestRead.ts). Past it, which of the rest hide is
 * unknown, and only what is the viewer's, or names them, gets a line.
 */
export const DIGEST_HIDDEN_SCAN = 5000;

/** Lines put in front of the model. Enough for a busy week, short enough to stay a digest. */
export const DIGEST_EVENT_LINES = 20;

/**
 * Every field the lines are made from: `expandInWindow` (the series, its exceptions and edits, the
 * span, whose edit is whose) and the title. The two reads bring ONLY these (digestRead.ts,
 * 16.10.2026): any member can pad a group's event to a megabyte. Of the rule, only the two parts a
 * series is expanded from. A field read and missing here reads as absent, and the digest quietly
 * changes; src/utils/digestCompact.test.ts holds the two together.
 */
export const DIGEST_FIELDS = [
  "date", "recurrenceRule.frequency", "recurrenceRule.onlyOn", "recurrenceExceptions", "overrideOfParent",
  "overrideDate", "ownerId", "groupId", "endDayOffset", "title",
] as const;

/**
 * Who may see each event: what `maySee` and `isPendingInvite` read (aiVisibility.ts), the rule the
 * calendar and the Period Log apply, but `hiddenFrom` (17.10.2026). `ownerId` is on the list above. No
 * line is made from these, so they are not on that list. Every one is bounded by the rules (the
 * assignees at 200, the rest single values); `hiddenFrom` is not, so digestRead.ts asks by a query of
 * references which events hide from the viewer instead of reading it.
 */
export const DIGEST_VISIBILITY_FIELDS = ["assigneeIds", "assigneeId", "inviteeId", "inviteStatus"] as const;

/** Events per page of those reads. Ten is safe only because the rules bound every field above (17.10.2026,
 *  firestore.rules "What the server reads in bulk"): a list is decoded at about a hundred times its stored
 *  size, so before that one page of padded exceptions was ten times what the function could hold. */
export const DIGEST_PAGE = 10;

export interface DigestWindow {
  /** Lower bound for the query — a day literal, matching how `date` is STORED. */
  scanFrom: string;
  /** Upper bound for the query. */
  scanTo: string;
  /** First and last day the digest is ABOUT, which is narrower than what is fetched. */
  fromDay: string;
  toDay: string;
}

/**
 * The window, from an instant.
 *
 * `null` when the instant is not one — the caller says so out loud instead of falling back to an
 * empty list, because "(No upcoming events)" reads as a calendar with nothing on it.
 */
export function digestWindow(nowIso: string, aheadDays = 7): DigestWindow | null {
  if (typeof nowIso !== "string" || nowIso.length < 10) return null;
  const today = nowIso.slice(0, 10);
  const toDay = dayPlus(today, aheadDays);
  const first = dayPlus(today, -DIGEST_SPAN_LOOKBACK_DAYS);
  if (!toDay || !first) return null;
  return {
    scanFrom: `${first}T00:00:00.000Z`,
    scanTo: `${toDay}T23:59:59.999Z`,
    fromDay: today,
    toDay,
  };
}

export interface DigestSelection {
  lines: string[];
  truncated: boolean;
}

const NOBODY_HIDDEN: ReadonlySet<string> = new Set();

/**
 * The lines, from whatever the two queries returned.
 *
 * Both queries are the group's own since 16.10.2026 (digestRead.ts). Until then the series one was
 * not, for want of an index, and `docs` held other groups' documents. The filter stays here, before
 * anything reads them, and it is a test of its own: a query that widens again must not widen the
 * ANSWER. `hidden` are the ids the viewer may not see (digestRead.ts decides them).
 */
export function digestEventLines(
  docs: readonly EventDoc[],
  groupId: string,
  window: DigestWindow,
  max = DIGEST_EVENT_LINES,
  hidden: ReadonlySet<string> = NOBODY_HIDDEN,
): DigestSelection {
  const byId = new Map<string, EventDoc>();
  for (const doc of docs) {
    if (!doc || typeof doc.id !== "string" || !doc.id) continue;
    if (doc.groupId !== groupId) continue;
    byId.set(doc.id, doc);
  }

  // `expandInWindow` does the deciding: it drops the documents fetched only because they MIGHT
  // reach the window, keeps a multi-day event on every day it covers, emits a series on each of
  // its occurrences, and suppresses a ghost that an override document already stands in for.
  //
  // What the viewer may not see goes only AFTER that, by the document each occurrence comes from: a
  // hidden EDIT still stands in for its parent's occurrence, and dropping it first would put the
  // parent's ghost back on that day. And BEFORE the cut: a hidden event takes no line from the viewer,
  // nor makes the viewer's digest say it is cut.
  const occurrences = expandInWindow([...byId.values()], window.fromDay, window.toDay)
    .filter((occ) => !hidden.has(occ.source.id));
  const shown = occurrences.slice(0, Math.max(0, max));

  return {
    lines: shown.map((occ) => {
      const title = typeof occ.source.title === "string" && occ.source.title
        ? occ.source.title
        : "(untitled)";
      // `occ.day`, not the document's own date. For an occurrence of a series those are different
      // days, and the parent's is the one nobody asked about.
      return `- ${title} on ${occ.day}`;
    }),
    truncated: shown.length < occurrences.length,
  };
}
