"use strict";
// functions/src/aiLedger.ts
// One ledger row per paid call — including the calls that fail.
//
// ── Why this exists before the expensive feature does ──────────────────────────────────
//
// Every project here follows the same rule: anything that costs money writes ONE row per
// call, saying who, what exactly, how many tokens, and what it cost, PRICED AT WRITE TIME.
// This app had none. Five AI callables have been shipping for months with no idea what they
// spend, and the assistant that is coming lets a user choose both the size of a call and how
// many of them to make. Adding the meter after that would be adding it too late.
//
// Priced at write time and never recomputed: a price table changes, and a row that recomputes
// its own cost from today's table quietly rewrites last month's spend.
//
// ── Why the budget is a TRANSACTION, not check-then-increment ──────────────────────────
//
// Checking on the way in and incrementing on the way out bounds nothing under concurrency:
// N parallel calls from one account all read the same pre-spend value and all pass. So the
// turn counter and a PESSIMISTIC pre-charge of the call's ceiling happen in the SAME
// transaction, and the real cost is reconciled downward afterwards. The failure mode becomes
// over-charging, which is the safe direction, and the limit holds under any concurrency.
//
// ── Why there is a global cap as well as a per-user one ────────────────────────────────
//
// Every per-user limit is denominated in accounts, and accounts are free: sign-up is open,
// `assertAiCallerAllowed` does not check `email_verified`, and App Check is not enforced. So
// the per-user budget bounds one attacker's convenience, not the bill. `_global` is the one
// that bounds the bill.
//
// ── What a row must never contain ──────────────────────────────────────────────────────
//
// No prompt text, no response text. A ledger over a family app would otherwise become a
// second, unregulated copy of exactly the private data the rest of this design is careful
// about — and it would sit in a collection whose whole point is that operators read it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_MAX_OUTPUT_TOKENS = exports.AI_CONFIG_PATH = exports.AI_KILL_SWITCH = exports.LIMITS_SOURCE = exports.AI_LIMITS = exports.priceUsd = exports.MODEL_PRICING = exports.AI_MODEL = exports.unfinishedReason = exports.stopReasonOf = exports.jsonOf = exports.textOf = exports.usageOf = void 0;
exports.effectiveLimits = effectiveLimits;
exports.holdBudget = holdBudget;
exports.settleBudget = settleBudget;
exports.charsPerToken = charsPerToken;
exports.openLedgerRow = openLedgerRow;
exports.pricedModel = pricedModel;
exports.attemptsOf = attemptsOf;
exports.costOf = costOf;
exports.closeLedgerRow = closeLedgerRow;
exports.withLedger = withLedger;
exports.estimateUsdFor = estimateUsdFor;
const admin = require("firebase-admin");
const aiProviderError_1 = require("./aiProviderError");
const aiLimits_1 = require("./aiLimits");
var aiResponse_1 = require("./aiResponse");
Object.defineProperty(exports, "usageOf", { enumerable: true, get: function () { return aiResponse_1.usageOf; } });
Object.defineProperty(exports, "textOf", { enumerable: true, get: function () { return aiResponse_1.textOf; } });
Object.defineProperty(exports, "jsonOf", { enumerable: true, get: function () { return aiResponse_1.jsonOf; } });
Object.defineProperty(exports, "stopReasonOf", { enumerable: true, get: function () { return aiResponse_1.stopReasonOf; } });
Object.defineProperty(exports, "unfinishedReason", { enumerable: true, get: function () { return aiResponse_1.unfinishedReason; } });
const aiModel_1 = require("./aiModel");
var aiModel_2 = require("./aiModel");
Object.defineProperty(exports, "AI_MODEL", { enumerable: true, get: function () { return aiModel_2.AI_MODEL; } });
Object.defineProperty(exports, "MODEL_PRICING", { enumerable: true, get: function () { return aiModel_2.MODEL_PRICING; } });
Object.defineProperty(exports, "priceUsd", { enumerable: true, get: function () { return aiModel_2.priceUsd; } });
const https_1 = require("firebase-functions/v2/https");
// The price table and `priceUsd` live in aiModel.ts (pure), next to the model id they price.
/**
 * Stored as micro-USD integers: floats accumulate error and Firestore has no decimal type.
 *
 * `Math.max(0, NaN)` is `NaN`, not 0 — so without the guard a non-finite estimate produced a
 * non-finite hold, `spent + NaN > limit` was FALSE on both checks, the call went through, and
 * `microUsd: NaN` was written to the counter. The next read does `(u.microUsd || 0)`, which turns
 * that NaN into **zero**: the day's spend silently reset. No path reaches it today — every
 * estimate is a finite length times a guarded ratio — but the failure is invisible and the guard
 * is one comparison.
 */
const toMicro = (usd) => Number.isFinite(usd) ? Math.max(0, Math.round(usd * 1000000)) : 0;
/**
 * Resolved ONCE, at module load, through `clampAiLimits`.
 *
 * It used to be `Number(process.env.AI_GLOBAL_DAILY_USD || 5)`, and that was a live bug rather
 * than a tidiness question: mistype the variable and `Number()` yields `NaN`, `toMicro(NaN)` is
 * `NaN`, and `spent + held > NaN` is **false** — so the line that refuses the call never ran. The
 * ceiling did not fail, did not log and did not look any different. It just stopped existing.
 * See `aiLimits.ts`.
 */
exports.AI_LIMITS = (0, aiLimits_1.clampAiLimits)({
    globalDailyUsd: process.env.AI_GLOBAL_DAILY_USD,
    userDailyUsd: process.env.AI_USER_DAILY_USD,
    killSwitch: process.env.AI_KILL_SWITCH,
});
/**
 * Where the numbers came from, so the admin screen can say it.
 *
 * "built-in defaults" and "environment" are very different things to be looking at when a bill
 * surprises you, and a screen that shows 5.00 without saying which is inviting the wrong guess.
 */
exports.LIMITS_SOURCE = process.env.AI_GLOBAL_DAILY_USD || process.env.AI_USER_DAILY_USD || process.env.AI_KILL_SWITCH
    ? "environment"
    : "built-in defaults";
// The environment is now only the FALLBACK. `effectiveLimits()` reads `aiConfig/live` on
// every call, and these values are what it falls back to when that document does not exist
// or cannot be read — which is exactly today's behaviour, so introducing the document changes
// nothing until somebody presses Save.
//
// Exported for the admin screen, which says WHICH source won. `AI_KILL_SWITCH` is no longer
// consulted on the hot path: a switch captured at cold start needs a redeploy to bite.
exports.AI_KILL_SWITCH = exports.AI_LIMITS.killSwitch;
const today = () => new Date().toISOString().slice(0, 10);
/**
 * A refusal is raised HERE, as the wire error, rather than as a custom class each of the five
 * call sites would have to remember to translate. The message is a STABLE CODE — the client
 * renders the sentence through `t()`, so the six languages stay the client's job and the
 * server never ships English at a user.
 */
function refuse(code) {
    throw new https_1.HttpsError("resource-exhausted", `ai-budget/${code}`);
}
/**
 * Take a pessimistic hold, atomically, against BOTH the caller's budget and the whole app's.
 *
 * `estimateUsd` should be the CEILING of what the call could cost, not a guess at the middle:
 * the hold is what bounds concurrency, and a hold that under-estimates bounds nothing.
 */
/** Where `aiConfig/live` lives. One document, written only by `adminSetAiConfig`. */
exports.AI_CONFIG_PATH = "aiConfig/live";
/**
 * The last value we successfully read, kept per function instance.
 *
 * A FALLBACK for when the read throws, never a way to skip the read. Staleness is asymmetric: a
 * stale LIMIT cannot overspend, because you can never exceed `max(old, new)` and the old figure
 * was one the day was already allowed to reach. A stale KILL SWITCH is the opposite — it is
 * pressed precisely because something is spending.
 *
 * ── What this actually gives you, stated honestly ──────────────────────────────────────
 *
 * The paragraph above used to end there, and the code beneath treated both the same. A comment
 * that argues for an asymmetry the code does not implement is worse than no comment: it reads as
 * though the reasoning had been applied.
 *
 * The residual gap is ONE call, per warm instance, per read failure, and only when the switch was
 * pressed AFTER that instance's last successful read. It is bounded by the global cap, which
 * still applies throughout. Two things narrow it further:
 *
 *   * the read is RETRIED once before falling back — a transient blip is the overwhelmingly
 *     likely cause, and one retry converts most of them into a success;
 *   * the cached switch is STICKY: once a successful read has said ON, a later read failure keeps
 *     it on, because nothing but a successful read saying otherwise should turn it off.
 *
 * What is deliberately NOT done: treating any unreadable config as "off limits, refuse
 * everything". That converts a Firestore blip into a total AI outage, and the bill is already
 * bounded by the global cap. Failing closed here would buy very little and cost a lot.
 */
let lastGoodLimits = null;
/**
 * The limits actually in force, read fresh.
 *
 * Read OUTSIDE the transaction, immediately before it. Inside, this one global document would join
 * the read set of every AI budget transaction, so an admin pressing Save would conflict with every
 * call in flight. A Firestore read costs about $0.00000006 against a call costing $0.001 to $0.01:
 * the switch's entire promise for roughly 0.006% of the call it guards.
 *
 * MISSING DOCUMENT means today's behaviour — whatever the environment resolved to — not "no
 * limit" and not "refuse everything". Introducing the document must change nothing until somebody
 * presses Save: absence is overwhelmingly likely to mean "nobody has saved yet", and making that
 * an outage would be a self-inflicted one on the day it ships.
 */
async function effectiveLimits() {
    try {
        let snap;
        try {
            snap = await admin.firestore().doc(exports.AI_CONFIG_PATH).get();
        }
        catch (first) {
            // One retry. The thing being guarded costs a thousand times the read, and a blip is the
            // likeliest reason a single `get()` on one document fails.
            console.error("aiConfig read failed, retrying once", (first === null || first === void 0 ? void 0 : first.message) || first);
            snap = await admin.firestore().doc(exports.AI_CONFIG_PATH).get();
        }
        if (!snap.exists)
            return { limits: exports.AI_LIMITS, source: exports.LIMITS_SOURCE };
        // Clamped at the READER, not only at the writer. This document can also arrive from a restore,
        // an emulator export, or the Firebase console — which uses the Admin SDK and bypasses both the
        // rules and the callable. The writer's clamp produces a good error message; this one is the
        // safety property.
        const limits = (0, aiLimits_1.clampAiLimits)(snap.data());
        lastGoodLimits = limits;
        return { limits, source: "aiConfig/live" };
    }
    catch (err) {
        console.error("aiConfig read failed", (err === null || err === void 0 ? void 0 : err.message) || err);
        // Never fall back to "no limit". The per-user cap is denominated in accounts and sign-up is
        // open, so an unbounded global is genuinely unbounded.
        if (lastGoodLimits)
            return { limits: lastGoodLimits, source: "cache (read failed)" };
        // Never read successfully on this instance: today's behaviour, plus the switch STAYS ON if the
        // environment says so. Sticky in the one direction that costs nothing to be wrong about.
        return { limits: exports.AI_LIMITS, source: exports.LIMITS_SOURCE };
    }
}
async function holdBudget(uid, estimateUsd) {
    // Read the live configuration FIRST, and re-read it on every call. The kill switch used to be
    // a module constant captured from the environment at cold start, which meant turning it on
    // required a redeploy — and a kill switch that takes a deploy to bite is a different product
    // from one that bites now.
    const { limits } = await effectiveLimits();
    if (limits.killSwitch)
        refuse("kill-switch");
    const db = admin.firestore();
    const date = today();
    const heldMicro = toMicro(estimateUsd);
    const userRef = db.doc(`ai_budget/${uid}`);
    const globalRef = db.doc("ai_budget/_global");
    await db.runTransaction(async (tx) => {
        const [userSnap, globalSnap] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
        const u = userSnap.exists ? userSnap.data() : undefined;
        const g = globalSnap.exists ? globalSnap.data() : undefined;
        const userSpent = u && u.date === date ? (u.microUsd || 0) : 0;
        const globalSpent = g && g.date === date ? (g.microUsd || 0) : 0;
        // `limits`, captured before the transaction opened, so a retry cannot silently use a
        // different ceiling halfway through.
        if (userSpent + heldMicro > toMicro(limits.userDailyUsd))
            refuse("user-budget");
        if (globalSpent + heldMicro > toMicro(limits.globalDailyUsd))
            refuse("global-budget");
        tx.set(userRef, { date, microUsd: userSpent + heldMicro }, { merge: true });
        tx.set(globalRef, { date, microUsd: globalSpent + heldMicro }, { merge: true });
    });
    return { heldMicro, uid, date };
}
/** Give back the difference between the hold and what was actually spent. Never goes negative. */
async function settleBudget(hold, actualUsd) {
    const db = admin.firestore();
    const actualMicro = toMicro(actualUsd);
    const refund = hold.heldMicro - actualMicro;
    if (refund === 0)
        return;
    const apply = (ref) => db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : undefined;
        if (!d || d.date !== hold.date)
            return; // the day rolled over; leave it alone
        tx.set(ref, { date: hold.date, microUsd: Math.max(0, (d.microUsd || 0) - refund) }, { merge: true });
    });
    await Promise.all([apply(db.doc(`ai_budget/${hold.uid}`)), apply(db.doc("ai_budget/_global"))]);
}
/**
 * The characters-per-token divisor, CALIBRATED PER USER from what the model actually reported.
 *
 * The usual "4 characters per token" is an English assumption. This corpus is family chat in
 * six languages, with Romanian and German diacritics and emoji, all of which tokenise far
 * worse. A new user starts at 2.5 — pessimistic — rather than at an optimistic 4.
 */
async function charsPerToken(uid) {
    var _a;
    const snap = await admin.firestore().doc(`ai_budget/${uid}`).get();
    const v = snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.charsPerToken : undefined;
    return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.max(2, v) : 2.5;
}
async function recordRatio(uid, chars, tokens) {
    if (!tokens || chars <= 0)
        return;
    const observed = chars / tokens;
    if (!Number.isFinite(observed) || observed <= 0)
        return;
    await admin.firestore().doc(`ai_budget/${uid}`).set(
    // Kept pessimistic: the smaller of what we assumed and what we saw.
    { charsPerToken: Math.max(2, Math.min(observed, await charsPerToken(uid))) }, { merge: true });
}
/**
 * Open a row BEFORE the call. A call that burns tokens and then throws still cost money, so
 * the row has to exist before the thing that might not return.
 */
async function openLedgerRow(entry) {
    const ref = admin.firestore().collection("aiLedger").doc();
    await ref.set(Object.assign(Object.assign({}, entry), { date: today(), at: admin.firestore.FieldValue.serverTimestamp(), ok: null, promptTokens: 0, completionTokens: 0, costUsd: 0 }));
    return { id: ref.id, startedAt: Date.now(), entry };
}
/**
 * The model a call is priced at: the one that actually SERVED it whenever the reply names one (a
 * server-side fallback bills at the fallback model's rate), else the one asked. An unknown served
 * model is priced at the table's dearest rate by `priceUsd` — never at the asked model's.
 */
function pricedModel(asked, usage) {
    const served = usage === null || usage === void 0 ? void 0 : usage.model;
    return typeof served === "string" && served ? served : asked;
}
/**
 * What a turn cost, attempt by attempt. A fallback turn is billed for the declined attempt at its
 * model's rate AND the answering one at its own; the top-level usage names only the latter. An
 * attempt that does not name its model is priced as the one asked.
 */
function attemptsOf(asked, usage) {
    return usage.attempts && usage.attempts.length > 0
        ? usage.attempts
        : [{ model: pricedModel(asked, usage), promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }];
}
function costOf(asked, usage) {
    return attemptsOf(asked, usage)
        .reduce((sum, a) => sum + (0, aiModel_1.priceUsd)(a.model || asked, a.promptTokens, a.completionTokens), 0);
}
/**
 * Close the row with what actually happened, and roll it up. `errorCode` is stable text.
 * `costUsd`, when given, is charged as is — for a billed reply whose usage could not be read.
 */
async function closeLedgerRow(handle, outcome) {
    const db = admin.firestore();
    const usage = outcome.usage || { promptTokens: 0, completionTokens: 0 };
    const model = pricedModel(handle.entry.model, outcome.usage);
    const costUsd = typeof outcome.costUsd === "number"
        ? outcome.costUsd
        : outcome.usage ? costOf(handle.entry.model, outcome.usage) : 0;
    const date = today();
    const batch = db.batch();
    batch.set(db.collection("aiLedger").doc(handle.id), Object.assign({ ok: outcome.ok, errorCode: outcome.errorCode || null, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costUsd, computeMs: Date.now() - handle.startedAt }, (model !== handle.entry.model ? { servedModel: model } : {})), { merge: true });
    const inc = admin.firestore.FieldValue.increment;
    const roll = {
        calls: inc(1),
        failures: inc(outcome.ok ? 0 : 1),
        promptTokens: inc(usage.promptTokens),
        completionTokens: inc(usage.completionTokens),
        microUsd: inc(toMicro(costUsd)),
    };
    // ── The second model arrived (26.09.2026: Gemini → Claude) ─────────────────────────────
    // The rule written here while there was one model: "the moment a second model exists, the
    // `models` rollup path ships in the SAME commit — added afterwards, it can only describe calls
    // made after it". It ships with the switch. Keyed by the model the call was PRICED at, so a
    // fallback-served call is counted where its cost was charged.
    batch.set(db.doc(`aiSpendDaily/${date}`), Object.assign({ date }, roll), { merge: true });
    batch.set(db.doc(`aiSpendDaily/${date}/users/${handle.entry.uid}`), Object.assign({ date }, roll), { merge: true });
    batch.set(db.doc(`aiSpendDaily/${date}/features/${handle.entry.feature}`), Object.assign({ date }, roll), { merge: true });
    // Per model, per ATTEMPT: a fallback turn charges the declined model and the answering one each
    // their own tokens and cost; the call itself is counted once, under the model that answered.
    const perModel = new Map();
    const attempts = outcome.usage && typeof outcome.costUsd !== "number"
        ? attemptsOf(handle.entry.model, outcome.usage)
        : [{ model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }];
    for (const a of attempts) {
        const m = a.model || handle.entry.model;
        const cur = perModel.get(m) || { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, usd: 0 };
        cur.promptTokens += a.promptTokens;
        cur.completionTokens += a.completionTokens;
        cur.usd += typeof outcome.costUsd === "number" ? outcome.costUsd : (0, aiModel_1.priceUsd)(m, a.promptTokens, a.completionTokens);
        perModel.set(m, cur);
    }
    const answered = perModel.get(model) || { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, usd: 0 };
    answered.calls = 1;
    answered.failures = outcome.ok ? 0 : 1;
    perModel.set(model, answered);
    for (const [m, t] of perModel) {
        batch.set(db.doc(`aiSpendDaily/${date}/models/${m}`), {
            date, model: m,
            calls: inc(t.calls), failures: inc(t.failures),
            promptTokens: inc(t.promptTokens), completionTokens: inc(t.completionTokens),
            microUsd: inc(toMicro(t.usd)),
        }, { merge: true });
    }
    await batch.commit();
    if (outcome.chars && usage.promptTokens) {
        await recordRatio(handle.entry.uid, outcome.chars, usage.promptTokens).catch(() => undefined);
    }
    return costUsd;
}
/**
 * The whole paid-call shape in one place, so no call site can forget half of it.
 *
 * Holds budget → opens a row → runs → closes the row and settles, on BOTH paths. A caller that
 * throws still leaves a priced row and a released hold.
 */
async function withLedger(entry, estimateUsd, run, usageFrom, chars, 
/** A billed reply that is not an answer (refused, cut off): its stable code, else null. */
unfinishedFrom) {
    const hold = await holdBudget(entry.uid, estimateUsd);
    const handle = await openLedgerRow(entry);
    // ── ONE line decides whether a refund is honest ─────────────────────────────────────────
    //
    // Everything before `run()` resolves: nothing was generated, nothing was billed, refund in full.
    // Everything after it: the tokens are burned and the money is gone, whatever happens next.
    //
    // These used to share a `try`, with `closeLedgerRow` INSIDE it — and its `batch.commit()` is the
    // last thing between a successful generation and the settle. When it threw, control landed in a
    // catch whose comment asserted "Nothing measurable was spent", which is true for a provider
    // failure and FALSE for this one, and `settleBudget(hold, 0)` gave back the entire hold. Net
    // effect on the day's counter of a call that really cost money: zero. The row was never priced
    // either, so the spend was invisible in both places.
    //
    // Not a remote failure mode: that batch writes `aiSpendDaily/{date}` — ONE document per day for
    // the whole app — on every AI call. Firestore sustains roughly one write per second per
    // document, so the failure rate rises with the request rate, which a caller controls. Since
    // 24.09.2026 every function is capped at ten instances (globalOptions.ts), which
    // bounds that rate but does not remove it: ten instances still contend for the one document.
    let result;
    try {
        result = await run();
    }
    catch (err) {
        // Was `err.code ?? err.name`, which the Gemini SDK sets neither of — so every HTTP failure
        // it ever raised landed here as the one string "GoogleGenerativeAIFetchError".
        const code = (0, aiProviderError_1.providerErrorCode)(err);
        await closeLedgerRow(handle, { ok: false, errorCode: String(code).slice(0, 60) }).catch(() => undefined);
        // The ONLY place a full refund is correct: the call produced nothing.
        await settleBudget(hold, 0).catch(() => undefined);
        throw err;
    }
    // Past this point every failure settles at a price, never at zero. `openLedgerRow` already sits
    // outside the try for the same reason — leaving a hold in place over-charges, which is the safe
    // direction. The success path used to do the opposite.
    let cost = estimateUsd; // the pessimistic hold, kept if we cannot do better
    try {
        const usage = usageFrom(result);
        const unfinished = unfinishedFrom ? unfinishedFrom(result) : null;
        // An unreadable usage is charged at the estimate, NEVER at zero: a zero here refunds the whole
        // hold and the budgets stop bounding anything — the failure the Gemini-shaped reader would have
        // produced on every Claude reply.
        cost = await closeLedgerRow(handle, usage
            ? Object.assign({ ok: !unfinished, usage, chars }, (unfinished ? { errorCode: unfinished } : {})) : { ok: !unfinished, errorCode: unfinished || "usage-unreadable", costUsd: estimateUsd });
    }
    catch (bookkeeping) {
        // The ledger row and the rollups are lost; the CHARGE is not. Priced from the usage if we can
        // read it, and otherwise left at the estimate — an over-charge, which is recoverable, rather
        // than a silent free call, which is not.
        console.error("closeLedgerRow failed after a billed call", (bookkeeping === null || bookkeeping === void 0 ? void 0 : bookkeeping.message) || bookkeeping);
        try {
            const usage = usageFrom(result);
            if (usage)
                cost = costOf(entry.model, usage);
        }
        catch ( /* keep the estimate */_a) { /* keep the estimate */ }
    }
    await settleBudget(hold, cost).catch(() => undefined);
    return result;
}
/**
 * The CEILING a call could cost, for the pessimistic hold.
 *
 * A hold that estimates the middle bounds nothing: the whole point is that N concurrent calls
 * cannot each pass a check against the same pre-spend figure. So input is counted at the
 * caller's own calibrated ratio and output is assumed to be the model's maximum, not its
 * typical.
 */
/**
 * The output ceiling the hold is calculated against — and the one the MODEL is given
 * (`max_tokens`, claude.ts). Every generation carries it, so the pessimistic hold is a real ceiling
 * (src/utils/aiLedgerShape.test.ts).
 *
 * On Claude Opus 5.5 (26.09.2026) it bounds THINKING plus the reply: thinking cannot be switched
 * off, it counts toward `max_tokens`, and it is billed as output. It was 2048 under Gemini, argued
 * as "far beyond a two-paragraph digest" — true of the visible text only. A reply cut off here is
 * billed and then thrown away (`max-tokens` in the ledger), so the cap leaves room for the thinking;
 * every route also runs at effort "low", which keeps that thinking short. The hold is priced at this
 * ceiling ($0.08 on Opus 5.5) and settles to the real cost after the call.
 *
 * Not a ceiling across a server-side FALLBACK: that turn can bill a declined attempt and a full
 * answering one. The settle charges both (`costOf`); the hold covers one.
 */
exports.AI_MAX_OUTPUT_TOKENS = 4096;
function estimateUsdFor(model, promptChars, cpt, maxOutTokens = exports.AI_MAX_OUTPUT_TOKENS) {
    const inTokens = Math.ceil(Math.max(0, promptChars) / Math.max(1, cpt));
    return (0, aiModel_1.priceUsd)(model, inTokens, maxOutTokens);
}
//# sourceMappingURL=aiLedger.js.map