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

import * as admin from "firebase-admin";
import { providerErrorCode } from "./aiProviderError";
import { clampAiLimits, type AiLimits } from "./aiLimits";
export { usageOf, textOf, type Usage } from "./aiResponse";
import type { Usage } from "./aiResponse";
import { HttpsError } from "firebase-functions/v2/https";

/** USD per MILLION tokens. Kept in code so a row can be priced the moment it is written. */
export const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "gemini-2.5-flash-lite": { inPerM: 0.10, outPerM: 0.40 },
  "gemini-2.5-flash": { inPerM: 0.30, outPerM: 2.50 },
  // Introductory pricing: $0.75 / $3.75 through 31 December 2026, then $1.50 / $7.50. Written as
  // the price being charged TODAY, because the ledger prices a row the moment it is written and
  // a future number here would misprice every row until that date.
  "gemini-3.8-flash": { inPerM: 0.75, outPerM: 3.75 },
};

const DEFAULT_PRICING = { inPerM: 0.30, outPerM: 2.50 };

export function priceUsd(model: string, inTokens: number, outTokens: number): number {
  const p = MODEL_PRICING[model] || DEFAULT_PRICING;
  return (inTokens / 1_000_000) * p.inPerM + (outTokens / 1_000_000) * p.outPerM;
}

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
const toMicro = (usd: number) =>
  Number.isFinite(usd) ? Math.max(0, Math.round(usd * 1_000_000)) : 0;

/**
 * Resolved ONCE, at module load, through `clampAiLimits`.
 *
 * It used to be `Number(process.env.AI_GLOBAL_DAILY_USD || 5)`, and that was a live bug rather
 * than a tidiness question: mistype the variable and `Number()` yields `NaN`, `toMicro(NaN)` is
 * `NaN`, and `spent + held > NaN` is **false** — so the line that refuses the call never ran. The
 * ceiling did not fail, did not log and did not look any different. It just stopped existing.
 * See `aiLimits.ts`.
 */
export const AI_LIMITS: AiLimits = clampAiLimits({
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
export const LIMITS_SOURCE: "environment" | "built-in defaults" =
  process.env.AI_GLOBAL_DAILY_USD || process.env.AI_USER_DAILY_USD || process.env.AI_KILL_SWITCH
    ? "environment"
    : "built-in defaults";

// The environment is now only the FALLBACK. `effectiveLimits()` reads `aiConfig/live` on
// every call, and these values are what it falls back to when that document does not exist
// or cannot be read — which is exactly today's behaviour, so introducing the document changes
// nothing until somebody presses Save.
//
// Exported for the admin screen, which says WHICH source won. `AI_KILL_SWITCH` is no longer
// consulted on the hot path: a switch captured at cold start needs a redeploy to bite.
export const AI_KILL_SWITCH = AI_LIMITS.killSwitch;

const today = () => new Date().toISOString().slice(0, 10);

export interface BudgetHold {
  /** Micro-USD taken up front; reconciled down when the real cost is known. */
  heldMicro: number;
  uid: string;
  date: string;
}

/**
 * A refusal is raised HERE, as the wire error, rather than as a custom class each of the five
 * call sites would have to remember to translate. The message is a STABLE CODE — the client
 * renders the sentence through `t()`, so the six languages stay the client's job and the
 * server never ships English at a user.
 */
function refuse(code: "kill-switch" | "user-budget" | "global-budget"): never {
  throw new HttpsError("resource-exhausted", `ai-budget/${code}`);
}

/**
 * Take a pessimistic hold, atomically, against BOTH the caller's budget and the whole app's.
 *
 * `estimateUsd` should be the CEILING of what the call could cost, not a guess at the middle:
 * the hold is what bounds concurrency, and a hold that under-estimates bounds nothing.
 */
/** Where `aiConfig/live` lives. One document, written only by `adminSetAiConfig`. */
export const AI_CONFIG_PATH = "aiConfig/live";

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
let lastGoodLimits: AiLimits | null = null;

export interface EffectiveLimits {
  limits: AiLimits;
  /** Which source won, so the admin screen can say it instead of the operator inferring it. */
  source: "aiConfig/live" | "environment" | "built-in defaults" | "cache (read failed)";
}

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
export async function effectiveLimits(): Promise<EffectiveLimits> {
  try {
    let snap;
    try {
      snap = await admin.firestore().doc(AI_CONFIG_PATH).get();
    } catch (first) {
      // One retry. The thing being guarded costs a thousand times the read, and a blip is the
      // likeliest reason a single `get()` on one document fails.
      console.error("aiConfig read failed, retrying once",
        (first as { message?: string })?.message || first);
      snap = await admin.firestore().doc(AI_CONFIG_PATH).get();
    }
    if (!snap.exists) return { limits: AI_LIMITS, source: LIMITS_SOURCE };
    // Clamped at the READER, not only at the writer. This document can also arrive from a restore,
    // an emulator export, or the Firebase console — which uses the Admin SDK and bypasses both the
    // rules and the callable. The writer's clamp produces a good error message; this one is the
    // safety property.
    const limits = clampAiLimits(snap.data() as Record<string, unknown>);
    lastGoodLimits = limits;
    return { limits, source: "aiConfig/live" };
  } catch (err) {
    console.error("aiConfig read failed", (err as { message?: string })?.message || err);
    // Never fall back to "no limit". The per-user cap is denominated in accounts and sign-up is
    // open, so an unbounded global is genuinely unbounded.
    if (lastGoodLimits) return { limits: lastGoodLimits, source: "cache (read failed)" };
    // Never read successfully on this instance: today's behaviour, plus the switch STAYS ON if the
    // environment says so. Sticky in the one direction that costs nothing to be wrong about.
    return { limits: AI_LIMITS, source: LIMITS_SOURCE };
  }
}

export async function holdBudget(uid: string, estimateUsd: number): Promise<BudgetHold> {
  // Read the live configuration FIRST, and re-read it on every call. The kill switch used to be
  // a module constant captured from the environment at cold start, which meant turning it on
  // required a redeploy — and a kill switch that takes a deploy to bite is a different product
  // from one that bites now.
  const { limits } = await effectiveLimits();
  if (limits.killSwitch) refuse("kill-switch");

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
    if (userSpent + heldMicro > toMicro(limits.userDailyUsd)) refuse("user-budget");
    if (globalSpent + heldMicro > toMicro(limits.globalDailyUsd)) refuse("global-budget");

    tx.set(userRef, { date, microUsd: userSpent + heldMicro }, { merge: true });
    tx.set(globalRef, { date, microUsd: globalSpent + heldMicro }, { merge: true });
  });

  return { heldMicro, uid, date };
}

/** Give back the difference between the hold and what was actually spent. Never goes negative. */
export async function settleBudget(hold: BudgetHold, actualUsd: number): Promise<void> {
  const db = admin.firestore();
  const actualMicro = toMicro(actualUsd);
  const refund = hold.heldMicro - actualMicro;
  if (refund === 0) return;
  const apply = (ref: FirebaseFirestore.DocumentReference) =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : undefined;
      if (!d || d.date !== hold.date) return; // the day rolled over; leave it alone
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
export async function charsPerToken(uid: string): Promise<number> {
  const snap = await admin.firestore().doc(`ai_budget/${uid}`).get();
  const v = snap.exists ? snap.data()?.charsPerToken : undefined;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.max(2, v) : 2.5;
}

async function recordRatio(uid: string, chars: number, tokens: number): Promise<void> {
  if (!tokens || chars <= 0) return;
  const observed = chars / tokens;
  if (!Number.isFinite(observed) || observed <= 0) return;
  await admin.firestore().doc(`ai_budget/${uid}`).set(
    // Kept pessimistic: the smaller of what we assumed and what we saw.
    { charsPerToken: Math.max(2, Math.min(observed, await charsPerToken(uid))) },
    { merge: true }
  );
}

export interface LedgerEntry {
  feature: string;
  model: string;
  uid: string;
}

export interface LedgerHandle {
  id: string;
  startedAt: number;
  entry: LedgerEntry;
}

/**
 * Open a row BEFORE the call. A call that burns tokens and then throws still cost money, so
 * the row has to exist before the thing that might not return.
 */
export async function openLedgerRow(entry: LedgerEntry): Promise<LedgerHandle> {
  const ref = admin.firestore().collection("aiLedger").doc();
  await ref.set({
    ...entry,
    date: today(),
    at: admin.firestore.FieldValue.serverTimestamp(),
    ok: null,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  });
  return { id: ref.id, startedAt: Date.now(), entry };
}

/** Close the row with what actually happened, and roll it up. `errorCode` is stable text. */
export async function closeLedgerRow(
  handle: LedgerHandle,
  outcome: { ok: boolean; usage?: Usage; errorCode?: string; chars?: number }
): Promise<number> {
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
  // ── A rule for whoever adds the second model ───────────────────────────────────────────
  // `model` is on the raw ledger row and in NONE of these three rollups. That is harmless only
  // while `AI_MODEL` is a single hard-coded constant, so every row in the database carries one
  // value and a per-model report would be a column of identicals. The moment a second model
  // exists, the `models` rollup path ships in the SAME commit — added afterwards, it can only
  // describe calls made after it, and the history it would have explained is unreconstructable.
  batch.set(db.doc(`aiSpendDaily/${date}`), { date, ...roll }, { merge: true });
  batch.set(db.doc(`aiSpendDaily/${date}/users/${handle.entry.uid}`), { date, ...roll }, { merge: true });
  batch.set(db.doc(`aiSpendDaily/${date}/features/${handle.entry.feature}`), { date, ...roll }, { merge: true });
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
export async function withLedger<T>(
  entry: LedgerEntry,
  estimateUsd: number,
  run: () => Promise<T>,
  usageFrom: (result: T) => Usage,
  chars?: number,
): Promise<T> {
  const hold = await holdBudget(entry.uid, estimateUsd);
  const handle = await openLedgerRow(entry);
  try {
    const result = await run();
    const usage = usageFrom(result);
    const cost = await closeLedgerRow(handle, { ok: true, usage, chars });
    await settleBudget(hold, cost);
    return result;
  } catch (err: any) {
    // Was `err.code ?? err.name`, which the Gemini SDK sets neither of — so every HTTP failure
    // it ever raised landed here as the one string "GoogleGenerativeAIFetchError".
    const code = providerErrorCode(err);
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
export function estimateUsdFor(model: string, promptChars: number, cpt: number, maxOutTokens = 2048): number {
  const inTokens = Math.ceil(Math.max(0, promptChars) / Math.max(1, cpt));
  return priceUsd(model, inTokens, maxOutTokens);
}
