// functions/src/adminTally.ts
//
// The helpers the Admin statistics count with (10.10.2026). They read values any member can write —
// an event's category, a game's type or status, a card's category, a group's id, a creation time —
// and the old ones broke on those that were not of the app's kind, taking the whole statistics panel
// (`adminGetStats`, `adminListGroups`) or the growth chart (`adminGetGrowth`) down for the admin:
//   * a key that was a map whose `toString` was not a function threw while being turned into a key;
//   * a time that was a map with a `toDate` that was not a function threw;
//   * a key named like a property of every object read the inherited one: `evByGroup['constructor']`
//     is a function, which reached the screen as `{}` and crashed React;
//   * and the callable's own wire cannot carry every key: the server's `encode` drops `__proto__`,
//     the client's `decode` calls `o.hasOwnProperty(key)` (a key "hasOwnProperty" replaces it) and
//     reads `@type` as its own marker — either way the whole answer failed to arrive.
// Pure, so src/utils/adminTally.test.ts runs it, through the real `encode`.

/**
 * The key a breakdown is counted under: the text as it is, unless the wire or an object cannot carry
 * it — a name of something every object has ("constructor", "hasOwnProperty", "__proto__") or
 * anything starting with "@" — which is counted in brackets ("[hasOwnProperty]"). The admin still sees
 * it, and nothing a member writes can be a property every object already has.
 */
export function wireKey(key: string): string {
  return key in Object.prototype || key.startsWith("@") ? `[${key}]` : key;
}

/**
 * Count one under `key`, or under `fallback` when `key` is not text (a breakdown then still adds up to
 * the documents read). With no fallback, a key that is not text is not counted: a group id or a uid
 * that is not text names nothing.
 */
export function inc(obj: Record<string, number>, key: unknown, fallback?: string): void {
  const text = typeof key === "string" && key ? key : fallback;
  if (!text) return;
  const k = wireKey(text);
  obj[k] = (Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : 0) + 1;
}

/** What was counted under `key`, read as the counter's own: 0 for anything never counted. */
export function countOf(obj: Record<string, number>, key: unknown): number {
  if (typeof key !== "string" || !key) return 0;
  const k = wireKey(key);
  return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : 0;
}

/** A stored time in epoch milliseconds — an ISO string or a Firestore time — or 0 for anything else. */
export function timeMs(v: unknown): number {
  try {
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : 0;
    }
    const toMillis = (v as { toMillis?: unknown } | null | undefined)?.toMillis;
    if (typeof toMillis === "function") {
      const t = Number(toMillis.call(v));
      return Number.isFinite(t) ? t : 0;
    }
  } catch { /* a value that only looks like a time */ }
  return 0;
}
