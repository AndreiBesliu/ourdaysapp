// functions/src/errorGrouping.ts
// Turning a list of errors into a list of PROBLEMS.
//
// ── Why a raw list is unreadable ─────────────────────────────────────────────────────
//
// The health screen shows the fifty most recent rows, newest first. Eighty logged errors is not
// eighty problems — it is usually four or five, each having happened many times, interleaved by
// time so that no two occurrences of the same one sit next to each other. Scrolling that list, the
// thing you cannot see is exactly the thing that matters: which one is happening MOST, and whether
// it is still happening or stopped a fortnight ago.
//
// ── The one thing this has to get right ──────────────────────────────────────────────
//
// Two occurrences of one bug differ in their details — a user id, a chunk hash, a line number, a
// URL. So the key has to ignore those. But ignore too much and two DIFFERENT bugs collapse into
// one group, which is worse than no grouping at all: it hides a problem behind a count that looks
// explained. Both directions are tested, deliberately, because only one of them is obvious.
//
// So the normalisation is conservative. It removes the things that are certainly incidental —
// URLs, long hex runs, standalone numbers, quoted file names with a build hash — and leaves the
// wording alone. Two messages that differ in a word stay two groups.
//
// Pure: no imports, so the app's own test suite can exercise it. See `functionsPurity.test.ts`
// for why that matters here.

export interface RawError {
  id?: string;
  message?: unknown;
  stack?: unknown;
  url?: unknown;
  context?: unknown;
  uid?: unknown;
  email?: unknown;
  /** ISO string, as `adminGetHealth` already converts it. */
  createdAt?: unknown;
}

export interface ErrorGroup {
  key: string;
  /** A real message from the group, not the normalised key — the key is for matching, not reading. */
  sample: string;
  context: string | null;
  count: number;
  /** How many DISTINCT people hit it. One person hitting it forty times is a different story. */
  users: number;
  firstSeen: string | null;
  lastSeen: string | null;
  urls: string[];
  sampleStack: string | null;
  sampleId: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The identity of an error, with the incidental parts removed.
 *
 * Exported so a test can state, in one line, that two things are or are not the same problem.
 */
export function fingerprint(message: unknown, context?: unknown): string {
  let s = str(message).trim();

  // A URL is where it happened, not what happened. Do this first: URLs contain both digits and
  // hex runs, and replacing those first would leave a mangled URL behind to be matched on.
  s = s.replace(/https?:\/\/[^\s)'"]+/gi, "<url>");

  // Built asset names carry a per-build hash, so the same failure fingerprints differently after
  // every deploy — which would split one problem into one group per release.
  s = s.replace(/[\w.-]+-[A-Za-z0-9_-]{6,}\.(js|css|mjs)\b/g, "<asset>");

  // Ids: uids, document ids, long hex. Anchored on length so ordinary words survive.
  s = s.replace(/\b[0-9a-f]{8,}\b/gi, "<id>");
  s = s.replace(/\b[A-Za-z0-9_-]{20,}\b/g, "<id>");

  // Line and column numbers, sizes, counts.
  //
  // A number introduced by "#" is kept, because there it is an IDENTITY rather than a position:
  // React's "#310" and "#185" are two unrelated faults, and this app has had both. Stripping the
  // digit collapsed them into one group — the merge failure that is invisible, since the second
  // fault then hides behind a count that looks explained, and a claim to have fixed one would
  // silently cover the other.
  s = s.replace(/(#)?\d+/g, (match, hash) => (hash ? match : "<n>"));

  s = s.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);

  // The context ("window.onerror", "ErrorBoundary", …) is part of the identity: the same message
  // arriving from a render boundary and from an unhandled rejection are two different situations.
  const c = str(context).trim().toLowerCase();
  return c ? `${c}::${s}` : s;
}

/** Latest first; anything unparseable sorts last rather than throwing. */
const timeOf = (v: unknown): number => {
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Collapse rows into groups, most frequent first.
 *
 * Ties break on recency, so of two problems that happened the same number of times the live one is
 * on top — which is the one worth reading.
 */
export function groupErrors(rows: readonly RawError[], maxUrls = 4): ErrorGroup[] {
  const byKey = new Map<string, {
    g: ErrorGroup;
    uids: Set<string>;
    urls: Set<string>;
    newest: number;
  }>();

  for (const r of rows) {
    const message = str(r.message);
    if (!message) continue;
    const key = fingerprint(message, r.context);
    const at = timeOf(r.createdAt);
    const iso = str(r.createdAt) || null;

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        g: {
          key,
          sample: message.slice(0, 300),
          context: str(r.context) || null,
          count: 0,
          users: 0,
          firstSeen: iso,
          lastSeen: iso,
          urls: [],
          sampleStack: str(r.stack) || null,
          sampleId: str(r.id) || null,
        },
        uids: new Set(),
        urls: new Set(),
        newest: at,
      };
      byKey.set(key, entry);
    }

    entry.g.count += 1;
    if (str(r.uid)) entry.uids.add(str(r.uid));
    if (str(r.url)) entry.urls.add(str(r.url));

    // Keep the NEWEST occurrence's message and stack as the sample. An old stack can point at code
    // that no longer exists, which sends you reading the wrong file.
    if (at > entry.newest || entry.newest === -Infinity) {
      entry.newest = at;
      entry.g.sample = message.slice(0, 300);
      entry.g.sampleStack = str(r.stack) || null;
      entry.g.sampleId = str(r.id) || null;
    }
    if (iso) {
      if (!entry.g.lastSeen || at > timeOf(entry.g.lastSeen)) entry.g.lastSeen = iso;
      if (!entry.g.firstSeen || at < timeOf(entry.g.firstSeen)) entry.g.firstSeen = iso;
    }
  }

  const out = [...byKey.values()].map((e) => {
    e.g.users = e.uids.size;
    e.g.urls = [...e.urls].slice(0, maxUrls);
    return e.g;
  });

  out.sort((a, b) => b.count - a.count || timeOf(b.lastSeen) - timeOf(a.lastSeen));
  return out;
}
