"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIGEST_EVENT_LINES = exports.DIGEST_RECURRING_SCAN = exports.DIGEST_EVENT_SCAN = exports.DIGEST_SPAN_LOOKBACK_DAYS = void 0;
exports.digestWindow = digestWindow;
exports.digestEventLines = digestEventLines;
const eventTime_1 = require("./eventTime");
const recurrenceServer_1 = require("./recurrenceServer");
/**
 * How far back to fetch, so that an event which STARTED earlier and is still running is seen.
 *
 * `endDayOffset` permits up to 366, and this is deliberately far short of it. Reaching back a
 * year would need either a descending order — refused on live for want of a composite index — or
 * an ascending scan whose overflow drops the newest rows, which are exactly the days being asked
 * about. Thirty days covers a holiday or a trip. Past that the event is missed, and the number is
 * named here rather than buried in an expression so that the limit is a decision, not an accident.
 */
exports.DIGEST_SPAN_LOOKBACK_DAYS = 30;
/** Rows fetched. Crossing it sets `truncated` rather than quietly shortening the answer. */
exports.DIGEST_EVENT_SCAN = 300;
/** Recurring parents fetched. They are few; this is a backstop, not a budget. */
exports.DIGEST_RECURRING_SCAN = 500;
/** Lines put in front of the model. Enough for a busy week, short enough to stay a digest. */
exports.DIGEST_EVENT_LINES = 20;
/**
 * The window, from an instant.
 *
 * `null` when the instant is not one — the caller says so out loud instead of falling back to an
 * empty list, because "(No upcoming events)" reads as a calendar with nothing on it.
 */
function digestWindow(nowIso, aheadDays = 7) {
    if (typeof nowIso !== "string" || nowIso.length < 10)
        return null;
    const today = nowIso.slice(0, 10);
    const toDay = (0, eventTime_1.dayPlus)(today, aheadDays);
    const first = (0, eventTime_1.dayPlus)(today, -exports.DIGEST_SPAN_LOOKBACK_DAYS);
    if (!toDay || !first)
        return null;
    return {
        scanFrom: `${first}T00:00:00.000Z`,
        scanTo: `${toDay}T23:59:59.999Z`,
        fromDay: today,
        toDay,
    };
}
/**
 * The lines, from whatever the two queries returned.
 *
 * `docs` may contain documents belonging to other groups: the recurring-parent query is not
 * scoped by group, because on live `groupId ==` alongside `recurrenceRule != null` is refused for
 * want of a composite index. The filter is here, before anything reads them, and it is a test of
 * its own below — a query that widened for an indexing reason must not widen the ANSWER.
 */
function digestEventLines(docs, groupId, window, max = exports.DIGEST_EVENT_LINES) {
    const byId = new Map();
    for (const doc of docs) {
        if (!doc || typeof doc.id !== "string" || !doc.id)
            continue;
        if (doc.groupId !== groupId)
            continue;
        byId.set(doc.id, doc);
    }
    // `expandInWindow` does the deciding: it drops the documents fetched only because they MIGHT
    // reach the window, keeps a multi-day event on every day it covers, emits a series on each of
    // its occurrences, and suppresses a ghost that an override document already stands in for.
    const occurrences = (0, recurrenceServer_1.expandInWindow)([...byId.values()], window.fromDay, window.toDay);
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
//# sourceMappingURL=digestEvents.js.map