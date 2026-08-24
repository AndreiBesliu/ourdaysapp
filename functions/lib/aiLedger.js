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
exports.AI_KILL_SWITCH = exports.MODEL_PRICING = void 0;
exports.priceUsd = priceUsd;
exports.holdBudget = holdBudget;
exports.settleBudget = settleBudget;
exports.charsPerToken = charsPerToken;
exports.openLedgerRow = openLedgerRow;
exports.usageOf = usageOf;
exports.closeLedgerRow = closeLedgerRow;
exports.withLedger = withLedger;
exports.estimateUsdFor = estimateUsdFor;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
/** USD per MILLION tokens. Kept in code so a row can be priced the moment it is written. */
exports.MODEL_PRICING = {
    "gemini-2.5-flash-lite": { inPerM: 0.10, outPerM: 0.40 },
    "gemini-2.5-flash": { inPerM: 0.30, outPerM: 2.50 },
};
const DEFAULT_PRICING = { inPerM: 0.30, outPerM: 2.50 };
function priceUsd(model, inTokens, outTokens) {
    const p = exports.MODEL_PRICING[model] || DEFAULT_PRICING;
    return (inTokens / 1000000) * p.inPerM + (outTokens / 1000000) * p.outPerM;
}
/** Stored as micro-USD integers: floats accumulate error and Firestore has no decimal type. */
const toMicro = (usd) => Math.max(0, Math.round(usd * 1000000));
exports.AI_KILL_SWITCH = process.env.AI_KILL_SWITCH === "true";
/** Whole-app ceiling for one UTC day, in USD. The only limit an attacker cannot widen. */
const GLOBAL_DAILY_USD = Number(process.env.AI_GLOBAL_DAILY_USD || 5);
/** Per-account ceiling for one UTC day, in USD. */
const USER_DAILY_USD = Number(process.env.AI_USER_DAILY_USD || 0.25);
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
async function holdBudget(uid, estimateUsd) {
    if (exports.AI_KILL_SWITCH)
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
        if (userSpent + heldMicro > toMicro(USER_DAILY_USD))
            refuse("user-budget");
        if (globalSpent + heldMicro > toMicro(GLOBAL_DAILY_USD))
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
/** Pull usage out of whatever shape the SDK returned, without trusting any of it. */
function usageOf(result) {
    var _a;
    const meta = (_a = result === null || result === void 0 ? void 0 : result.response) === null || _a === void 0 ? void 0 : _a.usageMetadata;
    const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return {
        promptTokens: n(meta === null || meta === void 0 ? void 0 : meta.promptTokenCount),
        completionTokens: n(meta === null || meta === void 0 ? void 0 : meta.candidatesTokenCount),
    };
}
/** Close the row with what actually happened, and roll it up. `errorCode` is stable text. */
async function closeLedgerRow(handle, outcome) {
    const db = admin.firestore();
    const usage = outcome.usage || { promptTokens: 0, completionTokens: 0 };
    const costUsd = priceUsd(handle.entry.model, usage.promptTokens, usage.completionTokens);
    const date = today();
    const batch = db.batch();
    batch.set(db.collection("aiLedger").doc(handle.id), {
        ok: outcome.ok,
        errorCode: outcome.errorCode || null,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costUsd,
        computeMs: Date.now() - handle.startedAt,
    }, { merge: true });
    const inc = admin.firestore.FieldValue.increment;
    const roll = {
        calls: inc(1),
        failures: inc(outcome.ok ? 0 : 1),
        promptTokens: inc(usage.promptTokens),
        completionTokens: inc(usage.completionTokens),
        microUsd: inc(toMicro(costUsd)),
    };
    batch.set(db.doc(`aiSpendDaily/${date}`), Object.assign({ date }, roll), { merge: true });
    batch.set(db.doc(`aiSpendDaily/${date}/users/${handle.entry.uid}`), Object.assign({ date }, roll), { merge: true });
    batch.set(db.doc(`aiSpendDaily/${date}/features/${handle.entry.feature}`), Object.assign({ date }, roll), { merge: true });
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
async function withLedger(entry, estimateUsd, run, usageFrom, chars) {
    const hold = await holdBudget(entry.uid, estimateUsd);
    const handle = await openLedgerRow(entry);
    try {
        const result = await run();
        const usage = usageFrom(result);
        const cost = await closeLedgerRow(handle, { ok: true, usage, chars });
        await settleBudget(hold, cost);
        return result;
    }
    catch (err) {
        const code = typeof (err === null || err === void 0 ? void 0 : err.code) === "string" ? err.code : (err === null || err === void 0 ? void 0 : err.name) || "error";
        await closeLedgerRow(handle, { ok: false, errorCode: String(code).slice(0, 60) }).catch(() => undefined);
        // Nothing measurable was spent, but the hold must not outlive the call.
        await settleBudget(hold, 0).catch(() => undefined);
        throw err;
    }
}
/**
 * The CEILING a call could cost, for the pessimistic hold.
 *
 * A hold that estimates the middle bounds nothing: the whole point is that N concurrent calls
 * cannot each pass a check against the same pre-spend figure. So input is counted at the
 * caller's own calibrated ratio and output is assumed to be the model's maximum, not its
 * typical.
 */
function estimateUsdFor(model, promptChars, cpt, maxOutTokens = 2048) {
    const inTokens = Math.ceil(Math.max(0, promptChars) / Math.max(1, cpt));
    return priceUsd(model, inTokens, maxOutTokens);
}
//# sourceMappingURL=aiLedger.js.map