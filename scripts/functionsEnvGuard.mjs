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
//   * FORBIDDEN — the Gemini key, under any name it had, in any deploy-loaded file. It lives in Secret
//     Manager; a copy in a dotenv is the plain-text key the move removed, in a folder synced to Drive.

/** Variables every deploy must carry, non-empty. */
export const REQUIRED = ['BOOTSTRAP_ADMIN_EMAILS'];

/** Names that must never be written into a dotenv file (the Gemini key, under any name it had). */
export const FORBIDDEN = ['GEMINI_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KEY_LOCAL'];

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

  for (const f of [...always, ...perAlias]) {
    const leaked = [...new Set(keyNames(f.text).filter((k) => FORBIDDEN.includes(k)))];
    if (leaked.length) {
      problems.push(
        `functions/${f.name} contains ${leaked.join(', ')}. The Gemini key lives in Secret Manager (GEMINI_KEY); `
        + `remove it from the file (by hand; never paste it into a chat).`,
      );
    }
  }
  return problems;
}
