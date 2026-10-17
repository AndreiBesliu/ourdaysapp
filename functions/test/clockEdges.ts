// functions/test/clockEdges.ts
//
// For tests that compute a day themselves while the code under test reads its own clock: a digest asked
// at 23:59:59 and checked at 00:00:01 compares two different days, and so does a reminder due five
// minutes before a check made just past 00:05 UTC (review of 17.10.2026). Rather than fail on a correct
// result, such a test waits until the edge has passed.

const DAY_MS = 86_400_000;

/**
 * Waits until the UTC time of day `edgeMs` (0 = midnight) is at least `marginMs` away, if it is nearer
 * than that now. Kept under the 30 s a hook may take.
 */
export async function awayFromEdge(edgeMs = 0, marginMs = 20_000): Promise<void> {
  const untilEdge = (((edgeMs - (Date.now() % DAY_MS)) % DAY_MS) + DAY_MS) % DAY_MS;
  if (untilEdge < marginMs) await new Promise((resolve) => setTimeout(resolve, untilEdge + 1_000));
}
