"use strict";
// functions/src/aiLimits.ts
//
// What the AI budget limits actually resolve to, and what to do with a value that is not a number.
//
// ── The bug this exists to close ──────────────────────────────────────────────────────────
//
// The limits were `Number(process.env.AI_GLOBAL_DAILY_USD || 5)`, consumed as
// `spent + held > toMicro(LIMIT)`. Set that variable to anything `Number()` cannot parse —
// `"5 USD"`, `"five"`, a stray space — and it becomes `NaN`. `toMicro(NaN)` is `NaN`, and every
// comparison against `NaN` is **false**, so the branch that refuses the call never runs.
//
// The limit does not fail loudly, does not fall back, and does not log. It simply stops existing,
// and the only symptom is a bill. A ceiling that disappears when its input is mistyped is worse
// than no ceiling at all, because everybody believes it is there.
//
// Second, smaller, same family: `|| 5` means `AI_GLOBAL_DAILY_USD=0` resolves to **5**. Zero is a
// legitimate setting — it is "no paid AI today" — and it was the one value that could not be
// expressed. Here it can. An EMPTY variable is still the default, because an empty string is what
// an unset-but-declared variable looks like, and reading that as "spend nothing" would take the
// feature away by accident rather than by decision.
//
// ── Why it is its own file, and imports nothing ───────────────────────────────────────────
//
// `aiLedger.ts` imports `firebase-admin`, and CI runs `npm ci` only at the repo root, so an app
// test that reached into it would pass on a developer machine and fail in CI. Pure and
// import-free, this module can be tested from `src/utils/aiLimits.test.ts` like any other —
// and `src/utils/functionsPurity.test.ts` walks the relative import graph, so it polices that
// property automatically from the moment the first test imports this.
//
// Phase 2 reuses `clampAiLimits` for the WRITE path, which is the point of the ceiling below: a
// budget editable from a browser needs its bounds enforced on the server, not in the form.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_USER_DAILY_USD = exports.MAX_GLOBAL_DAILY_USD = exports.DEFAULT_USER_DAILY_USD = exports.DEFAULT_GLOBAL_DAILY_USD = void 0;
exports.clampAiLimits = clampAiLimits;
exports.configChangeAllowed = configChangeAllowed;
/** The compiled-in fallbacks. What the app costs if nobody has configured anything. */
exports.DEFAULT_GLOBAL_DAILY_USD = 5;
exports.DEFAULT_USER_DAILY_USD = 0.25;
/**
 * The most the whole app may be allowed to spend in a UTC day, whatever anybody asks for.
 *
 * Not a guess at the right budget — a guard against the extra zero. Phase 2 puts this field in
 * front of a person with a keyboard, and `500` typed where `50` was meant is a hundredfold bill
 * with no other brake on it. The server owns this number; a form cannot raise it.
 */
exports.MAX_GLOBAL_DAILY_USD = 50;
/**
 * The most ONE account may be allowed to spend in a UTC day.
 *
 * Separate from the global ceiling on purpose. Without it, an admin could set the per-user limit
 * equal to the app-wide one, and a single account would be entitled to the entire day's budget —
 * a limit that exists and bounds nothing.
 *
 * Declared HERE, above `clampAiLimits`, and not beside the phase-2 block where it was written.
 * `const` is hoisted but not initialised: read before its assignment it is `undefined`, and
 * `50 > undefined` is `false`, so a partial module initialisation would drop the per-user cap
 * with `clamped: []` — no error, no trace. Unreachable today because this file imports nothing,
 * which is exactly the property that could change without anyone thinking about this line.
 */
exports.MAX_USER_DAILY_USD = 5;
/**
 * A finite, non-negative number, or `null`.
 *
 * Parsed by hand rather than through `Number()`, because `Number()` maps far too much to something
 * plausible: `""` and `" "` and `null` and `[]` all become `0`, and `[5]` becomes `5`. Every one
 * of those is a mistake upstream, and turning a mistake into a budget is how this went wrong.
 */
function usd(v) {
    if (typeof v === "number")
        return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v !== "string")
        return null;
    const s = v.trim();
    // Redundant by construction — the digits regex below rejects "" too — and kept anyway to say
    // out loud that an empty variable means "not configured". A mutation test cannot tell this
    // line from its absence, which is a fact about the line, not a gap in the tests.
    if (s === "")
        return null;
    if (!/^\d+(\.\d+)?$/.test(s))
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
/**
 * Resolve the limits, replacing anything unusable with the compiled default and saying so.
 *
 * `userDailyUsd` is additionally capped at `globalDailyUsd`: a per-account ceiling above the
 * whole-app ceiling cannot bind, so accepting one would display a limit that does nothing.
 */
function clampAiLimits(raw) {
    const r = raw || {};
    const clamped = [];
    let global = usd(r.globalDailyUsd);
    if (r.globalDailyUsd !== undefined && r.globalDailyUsd !== null && r.globalDailyUsd !== ""
        && global === null) {
        clamped.push("globalDailyUsd: not a number");
    }
    if (global === null)
        global = exports.DEFAULT_GLOBAL_DAILY_USD;
    if (global > exports.MAX_GLOBAL_DAILY_USD) {
        clamped.push(`globalDailyUsd: capped at ${exports.MAX_GLOBAL_DAILY_USD}`);
        global = exports.MAX_GLOBAL_DAILY_USD;
    }
    let user = usd(r.userDailyUsd);
    if (r.userDailyUsd !== undefined && r.userDailyUsd !== null && r.userDailyUsd !== ""
        && user === null) {
        clamped.push("userDailyUsd: not a number");
    }
    if (user === null)
        user = exports.DEFAULT_USER_DAILY_USD;
    if (user > exports.MAX_USER_DAILY_USD) {
        clamped.push(`userDailyUsd: capped at ${exports.MAX_USER_DAILY_USD}`);
        user = exports.MAX_USER_DAILY_USD;
    }
    if (user > global) {
        clamped.push("userDailyUsd: capped at the global limit");
        user = global;
    }
    // Only an explicit true switches it on. A truthy accident — the string "false" is truthy —
    // must not be able to turn the whole feature off.
    const killSwitch = r.killSwitch === true || r.killSwitch === "true";
    return { globalDailyUsd: global, userDailyUsd: user, killSwitch, clamped };
}
/**
 * Which direction of change this actor may make.
 *
 * The rule is one sentence: **anyone who can reach the admin may make things SAFER; only the
 * owner may make them riskier.** Turning the kill switch on, or lowering a limit, is available to
 * whoever is holding the phone when the bill starts moving. Turning it off, or raising a limit,
 * needs the one identity in this app that another admin cannot mint.
 *
 * That asymmetry matters here specifically: `adminSetAdmin` is gated by `assertAdmin` alone, so
 * any admin can create another admin. `CLAUDE.md` records that as the reason OurDaysApp was
 * excluded from the publish-to-live feature. A money control behind that same door would
 * re-create exactly what was excluded, on the thing that costs money — unless the dangerous
 * direction is held somewhere else.
 */
function configChangeAllowed(actor, from, to) {
    if (actor === 'owner')
        return { allowed: true };
    if (from.killSwitch && !to.killSwitch) {
        return { allowed: false, reason: 'Only the owner can turn the kill switch off.' };
    }
    if (to.globalDailyUsd > from.globalDailyUsd) {
        return { allowed: false, reason: 'Only the owner can raise the app-wide daily limit.' };
    }
    if (to.userDailyUsd > from.userDailyUsd) {
        return { allowed: false, reason: 'Only the owner can raise the per-person daily limit.' };
    }
    return { allowed: true };
}
//# sourceMappingURL=aiLimits.js.map