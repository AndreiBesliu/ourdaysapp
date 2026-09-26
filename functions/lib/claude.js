"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_BETA = exports.GOOGLE_IDENTITY_URL = exports.ANTHROPIC_API = void 0;
exports.claudeConfigured = claudeConfigured;
exports.googleIdentityToken = googleIdentityToken;
exports.claudeClient = claudeClient;
exports.resetClaudeClientForTests = resetClaudeClientForTests;
exports.generate = generate;
exports.requestChars = requestChars;
const sdk_1 = require("@anthropic-ai/sdk");
const oidc_federation_1 = require("@anthropic-ai/sdk/lib/credentials/oidc-federation");
const aiModel_1 = require("./aiModel");
const aiLedger_1 = require("./aiLedger");
exports.ANTHROPIC_API = "https://api.anthropic.com";
/** Google's metadata server, for the identity token of the service account this function runs as.
 *  `format=full` puts the `email` claim in the token — without it the federation rule cannot match. */
exports.GOOGLE_IDENTITY_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity" +
    `?audience=${encodeURIComponent(exports.ANTHROPIC_API)}&format=full`;
/** Opt-in for server-side fallbacks, "default" form: a request Opus 5.5's classifiers decline is
 *  re-run on the model Anthropic recommends for that category, instead of coming back empty. */
exports.FALLBACK_BETA = "server-side-fallback-2026-07-01";
function federationEnv() {
    const federationRuleId = process.env.ANTHROPIC_FEDERATION_RULE_ID || "";
    const organizationId = process.env.ANTHROPIC_ORGANIZATION_ID || "";
    const serviceAccountId = process.env.ANTHROPIC_SERVICE_ACCOUNT_ID || "";
    if (!federationRuleId || !organizationId || !serviceAccountId)
        return null;
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID || undefined;
    return Object.assign({ federationRuleId, organizationId, serviceAccountId }, (workspaceId ? { workspaceId } : {}));
}
/** Whether this instance can reach Claude at all. Checked before any budget is held. */
function claudeConfigured() {
    return federationEnv() !== null;
}
/**
 * A FRESH Google identity token on every call. Tokens with a `jti` are single-use at the exchange,
 * so a cached one would be refused the second time; the SDK calls this only when it re-exchanges.
 */
async function googleIdentityToken(fetchImpl = fetch) {
    const res = await fetchImpl(exports.GOOGLE_IDENTITY_URL, {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok)
        throw new Error(`metadata identity token: HTTP ${res.status}`);
    const token = (await res.text()).trim();
    if (!token)
        throw new Error("metadata identity token: empty");
    return token;
}
let cached = null;
/** The client, built once per instance so its token cache survives between calls. */
function claudeClient() {
    if (cached)
        return cached;
    const env = federationEnv();
    if (!env)
        throw new Error("Claude is not configured (federation IDs missing)");
    delete process.env.ANTHROPIC_CUSTOM_HEADERS;
    cached = new sdk_1.default({
        apiKey: null,
        authToken: null,
        baseURL: exports.ANTHROPIC_API,
        credentials: (0, oidc_federation_1.oidcFederationProvider)(Object.assign(Object.assign({ identityTokenProvider: () => googleIdentityToken() }, env), { baseURL: exports.ANTHROPIC_API, 
            // The exchange runs before the request's own timer starts, so it gets one of its own.
            fetch: (url, init) => fetch(url, Object.assign(Object.assign({}, init), { signal: AbortSignal.timeout(10000) })) })),
        timeout: 45000,
        maxRetries: 0,
    });
    return cached;
}
/** For tests: forget the instance-wide client. */
function resetClaudeClientForTests() {
    cached = null;
}
/**
 * THE generation call. Every AI feature goes through here, so the output cap the budget hold
 * assumes (`AI_MAX_OUTPUT_TOKENS`) is the one the model is actually given — pinned by
 * src/utils/aiLedgerShape.test.ts.
 */
async function generate(req) {
    const deadline = { signal: AbortSignal.timeout(60000) };
    return claudeClient().beta.messages.create({
        model: aiModel_1.AI_MODEL,
        max_tokens: aiLedger_1.AI_MAX_OUTPUT_TOKENS,
        betas: [exports.FALLBACK_BETA],
        fallbacks: "default",
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: Object.assign({ effort: req.effort }, (req.schema ? { format: { type: "json_schema", schema: req.schema } } : {})),
    }, deadline);
}
/** Characters the model reads for a request — what the budget estimate is computed from. */
function requestChars(req) {
    return req.system.length + req.prompt.length;
}
//# sourceMappingURL=claude.js.map