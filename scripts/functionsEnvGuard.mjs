// scripts/functionsEnvGuard.mjs
//
// Would a functions deploy set the wrong environment on the live functions? Pure: it judges the
// NAMES of the dotenv files present, the variable NAMES inside them, and whether a required value is
// blank — it never returns a value.
//
// How firebase-tools builds a function's environment (15.18.0, measured in its source 25.09.2026):
//   * it loads `.env`, then `.env.<projectId>`, then `.env.<alias>` — ONE alias, the one the command
//     resolved (`--project live` → `live`, `--project our-days-2a939` → none, nothing → `default`),
//     later files and later lines winning (lib/functions/env.js, findEnvfiles + loadUserEnvs);
//   * if at least one of those files exists, each function gets EXACTLY their merged contents plus
//     its secrets, and nothing of the live environment survives (lib/deploy/functions/prepare.js,
//     `usedDotenv`). A declared `defineSecret` does NOT trigger this: secret params never reach the
//     resolved values that `hasEnvsFromParams` looks at;
//   * with none of them, the live environment is merged back.
//
// What this guard holds:
//   * REQUIRED — BOOTSTRAP_ADMIN_EMAILS non-empty in functions/.env or .env.<projectId>. On 25.09 a
//     deploy that shipped no address demoted the owner: `adminSetAiConfig` stopped recognising him,
//     and the AI kill switch could no longer be turned off from the app. Without any file the CLI
//     would merge the live value back, but this step cannot see live, so the file is the one truth.
//   * no per-alias file — a predeploy step is not told the alias, so a `.env.live` / `.env.default`
//     would make the result depend on how the command was typed;
//   * PRESENT — a param the code declares (`AI_SERVICE_ACCOUNT`, index.ts) must have a LINE in the
//     file, even a blank one: a `--non-interactive` deploy refuses a declared param missing from the
//     dotenv, default or not (firebase-tools deploy/functions/params.js, resolveParams). Caught here,
//     with a sentence that says what to add, instead of halfway through `prepare`.
//   * FEDERATION — Claude authenticates by Workload Identity Federation (functions/src/claude.ts,
//     26.09.2026): the rule, organization and Anthropic service account IDs, and the Google service
//     account the AI functions run as. All four filled, or all four blank. A partial set deploys
//     cleanly and then fails every AI call. All blank deploys too — with a warning, because it means
//     every AI feature answers "not configured".
//   * FORBIDDEN — an AI key in plain text, under any name: the Gemini ones (retired 26.09) and the
//     Anthropic ones. The functions hold no key at all — they federate — and a key in this file would
//     sit in a folder synced to Drive.

/** Variables every deploy must carry, non-empty. */
export const REQUIRED = ['BOOTSTRAP_ADMIN_EMAILS'];

/** Declared params: each needs a line in the file, which may be blank. */
export const PRESENT = ['AI_SERVICE_ACCOUNT'];

/** Claude federation: all filled or all blank. */
export const FEDERATION = [
  'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'AI_SERVICE_ACCOUNT',
];

/**
 * Names that must never be written into a dotenv file: an AI key, under any name it had or has — and
 * the two Anthropic variables that would redirect the calls or rewrite their headers (claude.ts pins
 * the host and drops custom headers, but a file that sets them is a mistake worth stopping).
 */
export const FORBIDDEN = [
  'GEMINI_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_LOCAL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
];

/**
 * How the CLI treats a file in functions/. Case-insensitive: on Windows `fs.existsSync('.env')`
 * finds `.ENV` too.
 *   'always' — loaded for every alias: `.env`, `.env.<projectId>`
 *   'alias'  — loaded only when the command resolves to that alias: `.env.<alias>`
 *   null     — not loaded at deploy: `.env.local` (the emulator's), `.env.example`, anything else
 */
export function loadKind(fileName, projectId, aliases) {
  const n = fileName.toLowerCase();
  if (n === '.env' || n === `.env.${projectId.toLowerCase()}`) return 'always';
  if (aliases.some((a) => n === `.env.${a.toLowerCase()}`)) return 'alias';
  return null;
}

/** Kept for callers that only ask "could the CLI load this at deploy?" */
export function deployLoaded(fileName, projectId, aliases) {
  return loadKind(fileName, projectId, aliases) !== null;
}

function entries(text) {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(l))
    .filter(Boolean);
}

function isBlank(raw) {
  return raw.replace(/(^|\s+)#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim() === '';
}

/** Variable names in a dotenv text: `NAME=…` lines, comments and blanks ignored. */
export function keyNames(text) {
  return entries(text).map((m) => m[1]);
}

/**
 * Names whose value is not blank, LAST line winning, as the CLI reads it. `NAME=`, `NAME=""`,
 * `NAME=''` and a value that is only an inline comment are blank. The value is never returned.
 */
export function filledNames(text) {
  const last = new Map();
  for (const m of entries(text)) last.set(m[1], !isBlank(m[2]));
  return [...last].filter(([, filled]) => filled).map(([name]) => name);
}

/** `files`: [{ name, text }] for every dotenv in functions/. Returns problems (names only). */
export function envGuardProblems(files, projectId, aliases) {
  const problems = [];
  const always = files
    .filter((f) => loadKind(f.name, projectId, aliases) === 'always')
    // The CLI's order: `.env` first, `.env.<projectId>` after it, the later one winning.
    .sort((a, b) => (a.name.toLowerCase() === '.env' ? -1 : 0) - (b.name.toLowerCase() === '.env' ? -1 : 0));
  const perAlias = files.filter((f) => loadKind(f.name, projectId, aliases) === 'alias');

  for (const f of perAlias) {
    problems.push(
      `functions/${f.name} is loaded only when the deploy command names that alias, and this step cannot `
      + `tell which one it does. Put its variables in functions/.env and remove the file.`,
    );
  }

  const filled = new Map();
  for (const f of always) {
    for (const m of entries(f.text)) filled.set(m[1], !isBlank(m[2]));
  }
  const missing = REQUIRED.filter((k) => filled.get(k) !== true);
  if (missing.length) {
    const where = always.length ? always.map((f) => `functions/${f.name}`).join(' + ') : 'no functions/.env';
    problems.push(
      `${where}: ${missing.join(', ')} is missing or empty. With a dotenv the deploy sets every function's `
      + `environment to exactly its contents, and with none it falls back to whatever live has, which this `
      + `step cannot see — so the file must carry it. Without BOOTSTRAP_ADMIN_EMAILS the owner is no longer `
      + `recognised. The file is kept outside the repository in ~/.ourdays/functions.env.bootstrap; copy it `
      + `to functions/.env.`,
    );
  }

  const present = new Set(always.flatMap((f) => keyNames(f.text)));
  const absent = PRESENT.filter((k) => !present.has(k));
  if (absent.length) {
    problems.push(
      `functions/.env has no ${absent.join(', ')} line. The code declares it as a param, and a `
      + `--non-interactive deploy stops when the file lacks one. Add "${absent[0]}=" (blank is fine until the `
      + `AI service account exists).`,
    );
  }

  // A service account is `name@` or `name@project.iam.gserviceaccount.com`. The CLI rejects anything
  // else only per function, during the release — a partial deploy. Judged here on the shape alone,
  // the value never printed.
  let sa = null;
  for (const f of always) for (const m of entries(f.text)) if (m[1] === 'AI_SERVICE_ACCOUNT') sa = m[2];
  const saValue = sa === null ? '' : sa.replace(/(^|\s+)#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (saValue && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@([a-z0-9-]+\.iam\.gserviceaccount\.com)?$/.test(saValue)) {
    problems.push(
      'AI_SERVICE_ACCOUNT is not a service account address: it must be "name@" or '
      + '"name@<project>.iam.gserviceaccount.com".',
    );
  }

  const fed = FEDERATION.filter((k) => filled.get(k) === true);
  if (fed.length > 0 && fed.length < FEDERATION.length) {
    const blank = FEDERATION.filter((k) => filled.get(k) !== true);
    problems.push(
      `Claude federation is half set up: ${blank.join(', ')} ${blank.length === 1 ? 'is' : 'are'} missing or empty. `
      + `All four together or none — a partial set deploys and then fails every AI call.`,
    );
  }

  for (const f of [...always, ...perAlias]) {
    const leaked = [...new Set(keyNames(f.text).filter((k) => FORBIDDEN.includes(k)))];
    if (leaked.length) {
      problems.push(
        `functions/${f.name} contains ${leaked.join(', ')}. The functions hold no AI key: Claude is reached by `
        + `federation (functions/src/claude.ts) and the Gemini key is retired. Remove it from the file (by hand; `
        + `never paste it into a chat).`,
      );
    }
  }
  return problems;
}

/** Not a refusal — a deploy that is allowed but worth saying out loud. Names only. */
export function envGuardWarnings(files, projectId, aliases) {
  const always = files.filter((f) => loadKind(f.name, projectId, aliases) === 'always');
  const filled = new Map();
  for (const f of always) {
    for (const m of entries(f.text)) filled.set(m[1], !isBlank(m[2]));
  }
  return FEDERATION.every((k) => filled.get(k) !== true)
    ? ['Claude is not configured (no federation IDs in functions/.env): after this deploy every AI feature '
      + 'answers "AI is not configured on the server".']
    : [];
}
