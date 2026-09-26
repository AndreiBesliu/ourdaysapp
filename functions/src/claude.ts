// functions/src/claude.ts
//
// The ONE place any function talks to Claude (Anthropic), and how it proves who it is.
//
// ── No API key, anywhere (Andrei, 26.09.2026) ───────────────────────────────────────────────
//
// Authentication is Workload Identity Federation. The function asks Google's metadata server for an
// identity token of the service account it runs as, and the SDK exchanges that token at Anthropic
// for a short-lived access token, re-exchanging before it expires. There is no `sk-ant-…` secret to
// store, paste, rotate or leak — the Gemini key sat in plain text on seven functions for months,
// and setting it in Secret Manager blocked every functions deploy for two days.
//
// What ties the token to THIS app: a federation rule in the Claude Console that accepts only
// Google-signed tokens for one service account (its numeric `sub` and its `email`) and the
// `https://api.anthropic.com` audience. The five AI functions — and only they — run as that
// service account (`serviceAccount: AI_SERVICE_ACCOUNT` in index.ts), so no other function in the
// project can obtain a Claude token.
//
// The four values below come from functions/.env and are NOT secrets: IDs, useless without a token
// Google signs for that exact service account. Missing any of them, `claudeConfigured()` is false
// and every AI feature answers "AI is not configured on the server" before holding any budget.
//
// ── The environment must not be able to take over ───────────────────────────────────────────
//
// The SDK reads `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the environment by default, and
// either one WINS over `credentials` (client.js: "apiKey/authToken win over credentials"); it also
// takes `ANTHROPIC_BASE_URL` for the host. A leftover key would silently bypass federation, and a
// base URL would send the family's chat somewhere else. So all three are passed explicitly, as null
// and the real host. Pinned by functions/test/claudeAuth.test.ts. A fourth, `ANTHROPIC_CUSTOM_HEADERS`,
// is merged into every request — it could replace the federated bearer or add an `x-api-key` — and
// the AI functions need none, so it is removed from this process before the client exists.
//
// ── Time: the app waits 70 s ────────────────────────────────────────────────────────────────
//
// A callable's client gives up after 70 s (the Firebase default; src/ai.ts sets none). An answer
// that arrives later is paid for and thrown away. So every step has its own deadline — the Google
// token 5 s, the exchange 10 s, the request 45 s with no automatic retry (the SDK honours any
// `retry-after`, uncapped) — and the whole call one of 60 s.

import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import { AI_MODEL } from "./aiModel";
import { AI_MAX_OUTPUT_TOKENS } from "./aiLedger";

export const ANTHROPIC_API = "https://api.anthropic.com";

/** Google's metadata server, for the identity token of the service account this function runs as.
 *  `format=full` puts the `email` claim in the token — without it the federation rule cannot match. */
export const GOOGLE_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity" +
  `?audience=${encodeURIComponent(ANTHROPIC_API)}&format=full`;

/** Opt-in for server-side fallbacks, "default" form: a request Opus 5.5's classifiers decline is
 *  re-run on the model Anthropic recommends for that category, instead of coming back empty. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

interface FederationEnv {
  federationRuleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId?: string;
}

function federationEnv(): FederationEnv | null {
  const federationRuleId = process.env.ANTHROPIC_FEDERATION_RULE_ID || "";
  const organizationId = process.env.ANTHROPIC_ORGANIZATION_ID || "";
  const serviceAccountId = process.env.ANTHROPIC_SERVICE_ACCOUNT_ID || "";
  if (!federationRuleId || !organizationId || !serviceAccountId) return null;
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID || undefined;
  return { federationRuleId, organizationId, serviceAccountId, ...(workspaceId ? { workspaceId } : {}) };
}

/** Whether this instance can reach Claude at all. Checked before any budget is held. */
export function claudeConfigured(): boolean {
  return federationEnv() !== null;
}

/**
 * A FRESH Google identity token on every call. Tokens with a `jti` are single-use at the exchange,
 * so a cached one would be refused the second time; the SDK calls this only when it re-exchanges.
 */
export async function googleIdentityToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(GOOGLE_IDENTITY_URL, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`metadata identity token: HTTP ${res.status}`);
  const token = (await res.text()).trim();
  if (!token) throw new Error("metadata identity token: empty");
  return token;
}

let cached: Anthropic | null = null;

/** The client, built once per instance so its token cache survives between calls. */
export function claudeClient(): Anthropic {
  if (cached) return cached;
  const env = federationEnv();
  if (!env) throw new Error("Claude is not configured (federation IDs missing)");
  delete process.env.ANTHROPIC_CUSTOM_HEADERS;
  cached = new Anthropic({
    apiKey: null,
    authToken: null,
    baseURL: ANTHROPIC_API,
    credentials: oidcFederationProvider({
      identityTokenProvider: () => googleIdentityToken(),
      ...env,
      baseURL: ANTHROPIC_API,
      // The exchange runs before the request's own timer starts, so it gets one of its own.
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
    }),
    timeout: 45_000,
    maxRetries: 0,
  });
  return cached;
}

/** For tests: forget the instance-wide client. */
export function resetClaudeClientForTests(): void {
  cached = null;
}

export type Effort = "low" | "medium" | "high";

export interface GenerateRequest {
  /** Standing instructions. User-written text goes in `prompt`, never here. */
  system: string;
  prompt: string;
  /** Opus 5.5 always thinks; effort is the only control, and its default is "medium". Thinking
   *  counts toward `max_tokens`, so every route here runs at "low". */
  effort: Effort;
  /** A JSON schema (root `type: "object"`) the reply must match — structured outputs. */
  schema?: Record<string, unknown>;
}

/**
 * THE generation call. Every AI feature goes through here, so the output cap the budget hold
 * assumes (`AI_MAX_OUTPUT_TOKENS`) is the one the model is actually given — pinned by
 * src/utils/aiLedgerShape.test.ts.
 */
export async function generate(req: GenerateRequest) {
  const deadline = { signal: AbortSignal.timeout(60_000) };
  return claudeClient().beta.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    output_config: {
      effort: req.effort,
      ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema } } : {}),
    },
  }, deadline);
}

/** Characters the model reads for a request — what the budget estimate is computed from. */
export function requestChars(req: Pick<GenerateRequest, "system" | "prompt">): number {
  return req.system.length + req.prompt.length;
}
