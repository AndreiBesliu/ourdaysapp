// functions/src/aiConfigProvenance.ts
//
// "Did something change this outside the admin?"
//
// ── Why this is a function, and why the first version was wrong ───────────────────────────
//
// `aiConfigLog` can never be complete: the Firebase console writes with the Admin SDK, which
// bypasses both the rules and the callable. Rather than present a partial history as a full one,
// the panel compares the document with what the callable last recorded and says when they differ.
//
// The first version compared UIDS — `stored.updatedBy` against the newest row's `by.uid` — and
// could not detect the case it was written for. Editing `globalDailyUsd` in the console leaves
// `updatedBy` and `updatedAt` untouched, so the uids still match, no warning appears, and the
// screen goes on to state "Last changed <old date> by <old email>" — asserting a provenance that
// is false. Comparing the VALUES is the only thing that notices.
//
// Pure so `src/utils/aiConfigProvenance.test.ts` can reach it; `index.ts` imports firebase-admin
// and CI installs only the root package.

export interface ConfigValues {
  globalDailyUsd?: unknown;
  userDailyUsd?: unknown;
  killSwitch?: unknown;
}

/**
 * True when the stored document is not what the callable last wrote.
 *
 * `stored` absent → false: there is nothing to explain. `lastLogged` absent while a document
 * exists → TRUE: a document nobody's callable recorded is exactly the unexplained case, and the
 * uid version treated it as fine.
 */
export function changedOutsideAdmin(
  stored: ConfigValues | null | undefined,
  lastLogged: ConfigValues | null | undefined,
): boolean {
  if (!stored) return false;
  if (!lastLogged) return true;
  return stored.globalDailyUsd !== lastLogged.globalDailyUsd
    || stored.userDailyUsd !== lastLogged.userDailyUsd
    || stored.killSwitch !== lastLogged.killSwitch;
}
