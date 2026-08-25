// functions/src/fanOut.ts
// One sum, kept on its own so it can be tested.
//
// It lives apart from `aiSources.ts` for a dull but decisive reason: that file imports
// `firebase-admin`, so a test importing it would need a service account before it could check a
// piece of arithmetic. The arithmetic is the part that was wrong, so the arithmetic is what has to
// be reachable.

/**
 * How wide a fan-out a document budget can actually pay for.
 *
 * The per-query floor is what makes a share usable at all — one document per group tells you
 * nothing — but multiplying it by the number of groups USED TO BREAK THE BUDGET: 26 queries at a
 * floor of 10 reads 260 documents against a budget of 150. A budget that is silently exceeded is
 * not a budget, so the floor stays and the fan-out is trimmed to fit it. `trimmed` travels back so
 * the caller can say the answer is narrower rather than pretending it is whole.
 *
 * `take` always leaves one query's worth for the caller's OWN documents: a member of many groups
 * must not lose sight of their own row.
 */
export function planFanOut(
  budget: number, groups: number, floor = 10,
): { take: number; perQuery: number; trimmed: boolean } {
  const b = Math.max(floor, Math.floor(budget) || 0);
  const affordable = Math.max(0, Math.floor(b / floor) - 1);
  const take = Math.min(Math.max(0, Math.floor(groups) || 0), affordable);
  return {
    take,
    perQuery: Math.max(floor, Math.floor(b / (take + 1))),
    trimmed: take < groups,
  };
}
