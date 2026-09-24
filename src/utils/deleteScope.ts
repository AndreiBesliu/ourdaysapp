// src/utils/deleteScope.ts
//
// What deleting one occurrence of a repeating event is allowed to do, decided where it can be run.
//
// ── The defect this replaces ──────────────────────────────────────────────────────────────────
//
// The question had THREE answers — only this one, the whole series, or never mind — and it was
// asked with `window.confirm`, which has two buttons. OK deleted the series; Cancel deleted the
// occurrence. There was no way to back out: pressing Cancel, the one button every person reaches
// for when they did not mean it, deleted something. So did Escape, since a dismissed confirm IS
// Cancel. A data-losing action wearing the label of the safe one.
//
// The rule now: dismissing the question in ANY way — the Cancel button, Escape, the Back button,
// a tap on the backdrop — writes nothing. Only an explicit choice deletes.

export type DeleteScope = 'one' | 'series' | 'cancel';

/** What a choice commits to. `nothing` is the only answer a dismissal may produce. */
export type DeletePlan = 'nothing' | 'add-exception' | 'delete-series';

export function deletePlanFor(scope: unknown): DeletePlan {
  // Anything that is not one of the two explicit choices is a dismissal. `unknown` on purpose: a
  // future caller passing an event object, `undefined`, or a boolean from an old confirm must land
  // on the safe side, not on whichever branch its truthiness happens to pick.
  if (scope === 'one') return 'add-exception';
  if (scope === 'series') return 'delete-series';
  return 'nothing';
}
