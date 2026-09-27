"use strict";
// functions/src/aiSpendMerge.ts
//
// Adding up N days of AI-spend rollups into one ranking.
//
// ── The mistake this is shaped to prevent ─────────────────────────────────────────────────
//
// `adminGetAiSpend` answered "which feature / which person cost the most" for TODAY only, because
// the rollups are per-day documents. Widening that to a week or a month is a fan-out: read each
// day's `features` and `users` subcollections and add them up.
//
// The tempting shortcut is to reuse the per-day `orderBy("microUsd","desc").limit(10)` the
// callable already runs, and merge thirty top-tens. It is wrong, and wrong in the direction that
// looks right: somebody who is ELEVENTH every day for thirty days spends more than somebody who
// was FIRST once, and the truncated merge never sees them. A month's ranking requires every row
// for every day in the window. A silently mis-ordered table is worse than an absent one, because
// nothing about it looks broken.
//
// So: no truncation before the sum. The window is capped instead — the cost is bounded by how
// many days you ask for, never by how much history exists.
//
// Pure and import-free so `src/utils/aiSpendMerge.test.ts` can reach it; the arithmetic otherwise
// lives inside a callable that imports `firebase-admin`, which no app test may load (CI installs
// only the root package). See `src/utils/functionsPurity.test.ts`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRollups = mergeRollups;
exports.mergeModelDays = mergeModelDays;
/** A count that is actually a count. A missing or corrupt field contributes nothing, never NaN. */
const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
/**
 * Sum per-day rollup rows by id, newest-first or oldest-first, it makes no difference.
 *
 * Sorted by spend descending, then by id, so the order is total rather than "whatever the sum
 * happened to produce" — two rows at the same cost must not swap places between two renders of
 * the same data.
 */
function mergeRollups(days) {
    const by = new Map();
    for (const day of days) {
        if (!day)
            continue; // a failed day's read is absent, not zero — see below
        for (const row of day) {
            if (!row || typeof row.id !== "string" || !row.id)
                continue;
            const acc = by.get(row.id) || { calls: 0, failures: 0, micro: 0 };
            acc.calls += num(row.calls);
            acc.failures += num(row.failures);
            acc.micro += num(row.microUsd);
            by.set(row.id, acc);
        }
    }
    return [...by.entries()]
        .map(([id, a]) => ({ id, calls: a.calls, failures: a.failures, usd: a.micro / 1000000 }))
        .sort((x, y) => (y.usd - x.usd) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
/**
 * Sum the per-model rows of every day in the window, and say what they do not cover.
 *
 * A day counts as unsplit only by its CALLS: the model rows and the day's total are written in the
 * same batch, so a day whose calls are all accounted for is fully split, and any difference in
 * dollars there is rounding (each row is rounded to micro-dollars on its own).
 */
function mergeModelDays(days) {
    var _a, _b;
    const by = new Map();
    const unsplit = { calls: 0, micro: 0, days: 0 };
    let complete = true;
    for (const day of days) {
        if (!day)
            continue;
        if (!day.models) {
            complete = false;
            continue;
        } // unreadable: absent, not zero
        let calls = 0;
        let micro = 0;
        for (const row of day.models) {
            if (!row || typeof row.id !== "string" || !row.id)
                continue;
            const acc = by.get(row.id) || { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, micro: 0 };
            acc.calls += num(row.calls);
            acc.failures += num(row.failures);
            acc.promptTokens += num(row.promptTokens);
            acc.completionTokens += num(row.completionTokens);
            acc.micro += num(row.microUsd);
            by.set(row.id, acc);
            calls += num(row.calls);
            micro += num(row.microUsd);
        }
        const missing = num((_a = day.total) === null || _a === void 0 ? void 0 : _a.calls) - calls;
        if (missing > 0) {
            unsplit.calls += missing;
            unsplit.micro += Math.max(0, num((_b = day.total) === null || _b === void 0 ? void 0 : _b.microUsd) - micro);
            unsplit.days += 1;
        }
    }
    const rows = [...by.entries()]
        .map(([model, a]) => ({
        model, calls: a.calls, failures: a.failures,
        promptTokens: a.promptTokens, completionTokens: a.completionTokens, usd: a.micro / 1000000,
    }))
        .sort((x, y) => (y.usd - x.usd) || (x.model < y.model ? -1 : x.model > y.model ? 1 : 0));
    return { rows, unsplit: { calls: unsplit.calls, usd: unsplit.micro / 1000000, days: unsplit.days }, complete };
}
//# sourceMappingURL=aiSpendMerge.js.map