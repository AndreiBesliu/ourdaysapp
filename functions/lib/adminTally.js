"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.wireKey = wireKey;
exports.inc = inc;
exports.countOf = countOf;
exports.withRest = withRest;
exports.clip = clip;
exports.memberText = memberText;
exports.timeMs = timeMs;
/**
 * The key a breakdown is counted under: the text as it is, unless the wire or an object cannot carry
 * it — a name of something every object has ("constructor", "hasOwnProperty", "__proto__") or
 * anything starting with "@" — which is counted in brackets ("[hasOwnProperty]"). The admin still sees
 * it, and nothing a member writes can be a property every object already has.
 */
function wireKey(key) {
    return key in Object.prototype || key.startsWith("@") ? `[${key}]` : key;
}
/**
 * Count one under `key`, or under `fallback` when `key` is not text (a breakdown then still adds up to
 * the documents read). With no fallback, a key that is not text is not counted: a group id or a uid
 * that is not text names nothing.
 */
function inc(obj, key, fallback) {
    const text = typeof key === "string" && key ? key : fallback;
    if (!text)
        return;
    const k = wireKey(text);
    obj[k] = (Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : 0) + 1;
}
/** What was counted under `key`, read as the counter's own: 0 for anything never counted. */
function countOf(obj, key) {
    if (typeof key !== "string" || !key)
        return 0;
    const k = wireKey(key);
    return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : 0;
}
/**
 * A breakdown from counts of the values the app writes: the documents none of them matched (`total`
 * minus their sum, when that is more than 0) are added under `rest`, and a value counted 0 times has no
 * line, as when the documents themselves were tallied (29.10.2026, adminRead.ts).
 */
function withRest(counts, total, rest) {
    const out = {};
    let sum = 0;
    for (const [k, n] of Object.entries(counts)) {
        sum += n;
        if (n > 0)
            out[k] = n;
    }
    const left = total - sum;
    if (left > 0)
        out[rest] = (Object.prototype.hasOwnProperty.call(out, rest) ? out[rest] : 0) + left;
    return out;
}
/**
 * Text cut to `max` characters; anything else as it is. For a value a member wrote that the Admin keeps
 * or sends on — a name, a category used as a key — which the rules keep to one value but not to a length.
 * What is cut is a copy: a slice of a long string points at the whole of it, and V8 keeps the whole
 * alive for as long as the slice is kept (review of 29.10.2026, measured: a hundred slices of a megabyte
 * each held 100 MB).
 */
function clip(v, max) {
    return typeof v === "string" && v.length > max ? v.slice(0, max).split("").join("") : v;
}
/**
 * A member's text as the Admin keeps and sends it: cut to `max`, or null when it is not text. A name or a
 * birthday stored as bytes or a time would reach the screen as an object it cannot render, and bytes
 * become one key a byte on the callable's wire (review of 29.10.2026).
 */
function memberText(v, max) {
    return typeof v === "string" ? clip(v, max) : null;
}
/** A stored time in epoch milliseconds — an ISO string or a Firestore time — or 0 for anything else. */
function timeMs(v) {
    try {
        if (typeof v === "string") {
            const t = Date.parse(v);
            return Number.isFinite(t) ? t : 0;
        }
        const toMillis = v === null || v === void 0 ? void 0 : v.toMillis;
        if (typeof toMillis === "function") {
            const t = Number(toMillis.call(v));
            return Number.isFinite(t) ? t : 0;
        }
    }
    catch ( /* a value that only looks like a time */_a) { /* a value that only looks like a time */ }
    return 0;
}
//# sourceMappingURL=adminTally.js.map