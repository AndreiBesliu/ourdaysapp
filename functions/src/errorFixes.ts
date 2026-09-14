// functions/src/errorFixes.ts
// What has actually been fixed — claimed here, checked by the panel.
//
// ── The problem this solves ──────────────────────────────────────────────────────────
//
// The health panel put a "Resolved" button on every group, which asked the wrong person the wrong
// question. Whoever opens that screen has no way of knowing whether a defect was fixed: the fix
// lives in a commit, and the commit is not on the screen. Clicking it was a guess, and a guess
// recorded as a fact is worse than no record.
//
// So the claim moves to where the knowledge is. Whoever fixes something writes it down HERE, with
// the commit, what was wrong, and how somebody else can see for themselves. The panel then shows a
// Resolved button ONLY for groups that have such a claim — and shows the claim next to it, so the
// click is informed rather than hopeful.
//
// ── And the claim is checked, not trusted ────────────────────────────────────────────
//
// Every entry carries `since`: the moment after which an occurrence would refute it. The panel
// compares that against when the group was last seen. If the error has happened SINCE the fix
// shipped, the fix did not work, and the button is withheld and the failure said out loud. Nobody
// has to remember to check — which is the point, because a claim that only a person verifies is a
// claim that stops being verified the moment attention moves on.
//
// `since` is deliberately the COMMIT time rather than the deploy time, which is a few minutes
// later. That makes the check slightly too strict: an occurrence in the gap reads as a failure. It
// errs towards "this did not work", and between the two directions that is the only safe one.
//
// ── Two kinds of claim ───────────────────────────────────────────────────────────────
//
// `fixed` — code changed, here is the commit.
// `not-a-defect` — investigated and there is nothing to change. That is still a claim, it still
// carries reasoning, and it is still refuted the same way: if it happens again after the judgement,
// the judgement was wrong.
//
// Pure: no imports, so the app's own suite tests it. See `functionsPurity.test.ts`.

export interface ErrorFix {
  /** The exact fingerprint (`errorGrouping.fingerprint`) this claim is about. */
  fingerprint: string;
  kind: "fixed" | "not-a-defect";
  /** ISO. An occurrence after this refutes the claim. */
  since: string;
  /** The commit that did it. A judgement has none. */
  commit?: string;
  /** One sentence: what was actually wrong. */
  what: string;
  /** How somebody can see for themselves, without reading code. */
  verify: string;
}

/** No claim at all · claim holding · claim refuted by a later occurrence. */
export type FixVerdict = "unclaimed" | "holding" | "failed";

export const ERROR_FIXES: ErrorFix[] = [
  {
    fingerprint:
      "errorboundary::minified react error #310; visit <url> for the full message or use the non-minified dev environment for full errors and additional helpful warnings.",
    kind: "fixed",
    since: "2026-09-14T11:35:18Z",
    commit: "23931ef",
    what: "A useRef sat below the early return in EventDetailsModal, which CalendarHome keeps permanently mounted — so a closed render ran eight hooks and an open one ran nine, and React threw on every event anybody opened.",
    verify: "Hard-reload, then open an event. The details modal opens instead of the error screen.",
  },
  {
    fingerprint:
      // Truncated at the 200-character cap `fingerprint()` applies, trailing space and all —
      // the full sentence would be a claim that can never match a real group.
      "ai:suggestasset::[googlegenerativeai error]: error fetching from <url> [<n> too many requests] you exceeded your current quota, please check your plan and billing details. for more information on this error, head to: ",
    kind: "fixed",
    since: "2026-09-14T11:54:18Z",
    commit: "9ed89a8",
    what: "Gemini refusing a call over the free-tier quota was being written to the error log as though it were an application defect. It is an operating condition; it now goes to the AI ledger instead, where it belongs.",
    verify: "The count stops growing. When the daily limit is hit, asking for a checklist now says so in your language instead of failing silently.",
  },
  {
    fingerprint: "errorboundary::failed to fetch dynamically imported module: <url>",
    kind: "fixed",
    since: "2026-09-14T11:54:18Z",
    commit: "9ed89a8",
    what: "A tab left open across a deploy asks for a chunk hash the server no longer has. It was reported as a crash; it now offers a reload, and is logged under its own context (StaleChunk) so it stops competing with real defects.",
    verify: "Future occurrences appear as a separate StaleChunk group, so this one stops growing.",
  },
  {
    fingerprint: "window.onerror::uncaught typeerror: t is not a function",
    kind: "not-a-defect",
    since: "2026-09-14T12:00:00Z",
    what: "Four occurrences over twelve days, all naming chunk hashes from one build that no longer exists. The minified name `t` survives normalisation, so the same fault from another build would have formed its own group — one group across twelve days is the signature of one stale tab, not a live bug. Nothing has reproduced it in a month.",
    verify: "If it appears again naming a CURRENT chunk hash, this judgement was wrong and the group will refuse to stay resolved.",
  },
];

/** The claim for a fingerprint, if anybody has made one. */
export function fixFor(
  fingerprint: unknown, fixes: readonly ErrorFix[] = ERROR_FIXES,
): ErrorFix | null {
  if (typeof fingerprint !== "string" || !fingerprint) return null;
  return fixes.find((f) => f.fingerprint === fingerprint) || null;
}

const timeOf = (v: unknown): number => {
  const t = Date.parse(typeof v === "string" ? v : "");
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Does the claim still stand?
 *
 * An unreadable `since` counts as FAILED rather than holding: a claim nobody can check is not a
 * claim, and offering a Resolved button on the strength of one would be the exact thing this file
 * exists to prevent.
 */
export function fixVerdict(fix: ErrorFix | null | undefined, lastSeen: unknown): FixVerdict {
  if (!fix) return "unclaimed";
  const since = timeOf(fix.since);
  if (Number.isNaN(since)) return "failed";
  const seen = timeOf(lastSeen);
  // A group with no readable last occurrence cannot refute anything.
  if (Number.isNaN(seen)) return "holding";
  return seen > since ? "failed" : "holding";
}
