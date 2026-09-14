// functions/src/aiProviderError.ts
// Telling "the provider said not today" apart from "something is broken".
//
// ── Why this matters more than it looks ──────────────────────────────────────────────
//
// On 2026-09-14 the admin health log held about ninety-five rows, and seventy-four of them were one
// thing: Gemini refusing a call because the project's free-tier allowance (twenty generateContent
// requests per day) was spent. Every real defect in the application sat below it, because the panel
// sorts by how often something happened and nothing real happens seventy-four times.
//
// A quota refusal is not an application error. No input is wrong, no state is corrupt, there is no
// line of code to change. It is an operating condition, it recurs by construction, and it will
// always out-count genuine bugs — so writing it to the error log does not record a problem, it
// hides the others.
//
// It is not dropped, though: `withLedger` already writes a row per AI call with `ok: false` and an
// error code, carrying the uid, the feature, the model and the cost. That is the ledger designed to
// be counted per call, and it holds strictly more than the error log row did.
//
// ── The other half: what the person sees ─────────────────────────────────────────────
//
// Today, nothing. `src/ai.ts` catches the failure and returns null, so the suggestion chip simply
// never appears and the user concludes nothing matched. That is precisely why seventy-four of these
// accumulated over twelve days without anybody noticing. Where the user ASKED for something, they
// deserve the sentence the app already has in six languages: "The app has reached today's AI limit."
// The server says that by throwing the stable code the client already translates.
//
// Pure: no imports, so the app's own suite tests it. See `functionsPurity.test.ts`.

/** The code the client turns into a translated sentence. Must match `aiErrorMessage` in src/ai.ts. */
export const AI_QUOTA_CODE = "ai-budget/global-budget";

/**
 * Did the AI provider refuse this call for rate or quota reasons?
 *
 * Deliberately narrow. A provider being briefly overloaded (503), a malformed request (400) and a
 * bug in our own code are all things somebody should look at, and widening this predicate would
 * post them all to a screen that says "nothing to worry about".
 */
export function isProviderQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  // The SDK's own shape. `GoogleGenerativeAIFetchError` carries `status`, never `code` — which is
  // also why the ledger could not tell a 429 from any other fetch failure.
  if (e.status === 429) return true;
  if (typeof e.code === "number" && e.code === 429) return true;

  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (!message) return false;

  return message.includes("429 too many requests")
    || message.includes("exceeded your current quota")
    || message.includes("resource_exhausted")
    || message.includes("quota exceeded for metric");
}

/**
 * A short, stable label for the ledger's `errorCode`.
 *
 * The old expression read `err.code`, then fell back to `err.name` — and since the Gemini SDK sets
 * neither, every HTTP failure it ever raised was recorded as the single string
 * "GoogleGenerativeAIFetchError". A ledger that cannot tell a quota refusal from a bad request
 * cannot answer the one question it exists for.
 */
export function providerErrorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "error";
  const e = err as Record<string, unknown>;

  if (typeof e.status === "number") return `http-${e.status}`;
  if (typeof e.code === "string" && e.code) return e.code;
  if (typeof e.code === "number") return `http-${e.code}`;
  if (typeof e.name === "string" && e.name) return e.name;
  return "error";
}
