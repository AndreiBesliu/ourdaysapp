// functions/src/errorDigest.ts
// A recurring summary of the error panel, written where it can be read without a key.
//
// ── The problem this solves ──────────────────────────────────────────────────────────
//
// The admin health panel lives behind authentication, and Firestore has no read command in the
// Firebase CLI. So the person who can fix these errors cannot see them: every round trip needed the
// owner to open the panel and describe or screenshot what was there. That turns a five-minute fix
// into a conversation, and it means nobody looks between conversations.
//
// Cloud Functions logs, on the other hand, ARE readable with the CLI that is already authenticated
// on the maintainer's machine (`firebase functions:log --only logErrorDigest`). So every few hours
// this writes the same summary the panel shows, as one JSON line, and the gap closes with no new
// credential, no new endpoint, and nothing for the owner to do.
//
// ── What it deliberately does NOT write ──────────────────────────────────────────────
//
// No uid, no email, no message beyond what is needed to recognise the problem. Counts, not people.
// The logs are a second copy of this data in a second place, and a second copy should always be the
// smaller one — the fix needs to know WHAT is failing and HOW OFTEN, never WHO.
//
// Cloud Logging keeps entries ~30 days by default and caps one entry at 256KB, so this is bounded
// on both sides: the newest groups only, with stacks cut short.

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { groupErrors } from "./errorGrouping";
import { groupDocId, joinState } from "./errorState";

/** How many rows to group over. Matches ERROR_SCAN_LIMIT in index.ts — the same window, so the
 *  digest and the panel cannot disagree about a count. */
const SCAN_LIMIT = 500;

/** How many groups to write. Beyond this, a log entry stops being readable and risks the size cap. */
const MAX_GROUPS = 20;

/** How much stack to keep. Enough to name the file and the frame; not the whole trace. */
const STACK_CHARS = 1200;

export const logErrorDigest = onSchedule(
  // Six-hourly, not daily: the log is the only way the maintainer sees these at all, and a
  // regression that appears at 09:00 should not wait until tomorrow to become visible. The
  // read is a few hundred documents, so four runs a day costs nothing worth saving.
  { schedule: "every 6 hours", timeZone: "UTC", retryCount: 0 },
  async () => {
    const db = admin.firestore();

    const [snap, total] = await Promise.all([
      db.collection("errorLogs").orderBy("createdAt", "desc").limit(SCAN_LIMIT).get(),
      db.collection("errorLogs").count().get().then((s) => s.data().count).catch(() => 0),
    ]);

    const scanned = snap.docs.map((d) => {
      const e = d.data();
      return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.()?.toISOString?.() || null };
    });

    const grouped = groupErrors(scanned as never);

    const head = grouped.slice(0, MAX_GROUPS);
    const refs = head.map((g) => db.doc(`errorGroups/${groupDocId(g.key)}`));
    const snaps = refs.length > 0 ? await db.getAll(...refs) : [];
    const byKey = new Map<string, Record<string, unknown>>();
    snaps.forEach((snap, i) => {
      const data = snap.data() as Record<string, unknown> | undefined;
      if (data) byKey.set(head[i].key, data);
    });

    const groups = joinState(head, (k) => byKey.get(k) || null).map((g) => {
      return {
        status: g.status,
        recurred: g.recurred,
        count: g.count,
        // A number, never an identity. Whoever reads this log does not need to know who.
        people: g.users,
        context: g.context,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        urls: g.urls,
        sample: g.sample,
        stack: g.sampleStack ? g.sampleStack.slice(0, STACK_CHARS) : null,
        // The key is what an admin action addresses, so it belongs here: it is how a reader of this
        // log says which group they mean.
        key: g.key,
      };
    });

    const digest = {
      schema: 1,
      total,
      scanned: scanned.length,
      scanLimit: SCAN_LIMIT,
      // Says plainly when the numbers above are a count of the window rather than of the log.
      truncated: scanned.length >= SCAN_LIMIT,
      distinct: grouped.length,
      shown: groups.length,
      groups,
    };

    // One line, one prefix, so `firebase functions:log | grep ERROR_DIGEST` is the whole protocol.
    console.log(`ERROR_DIGEST ${JSON.stringify(digest)}`);
  },
);
