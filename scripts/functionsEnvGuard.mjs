// scripts/functionsEnvGuard.mjs
//
// Would a functions deploy drop the Gemini key from the live functions? Pure: it judges the NAMES of
// the dotenv files present and the variable NAMES inside them — never a value.
//
// A functions deploy keeps each live function's environment only when it uses no dotenv file; with
// one, each function gets exactly that file's contents (see functions/src/geminiKey.ts). The Gemini
// key lives on live as the plain variable GEMINI_API_KEY_LOCAL until the Secret Manager move, which
// Andrei postponed on 25.09.2026. So any deploy-loaded dotenv without that key switches every AI
// feature off.

/** The variable the live functions carry and must keep. */
export const REQUIRED = ['GEMINI_API_KEY_LOCAL'];

/**
 * Files the CLI loads at DEPLOY (firebase-tools lib/functions/env.js, findEnvfiles): `.env`,
 * `.env.<projectId>`, `.env.<alias>`. `.env.local` is the emulator's only, so it does not count.
 */
export function deployLoaded(fileName, projectId, aliases) {
  return fileName === '.env' || fileName === `.env.${projectId}` || aliases.some((a) => fileName === `.env.${a}`);
}

/** Variable names in a dotenv text: `NAME=…` lines, comments and blanks ignored. */
export function keyNames(text) {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1])
    .filter(Boolean);
}

/** `files`: [{ name, text }] for every dotenv in functions/. Returns problems (names only). */
export function envGuardProblems(files, projectId, aliases) {
  const used = files.filter((f) => deployLoaded(f.name, projectId, aliases));
  if (used.length === 0) return [];
  const names = new Set(used.flatMap((f) => keyNames(f.text)));
  const missing = REQUIRED.filter((k) => !names.has(k));
  if (missing.length === 0) return [];
  return [
    `${used.map((f) => `functions/${f.name}`).join(', ')} would REPLACE every live function's environment, `
    + `and it has no ${missing.join(', ')} — the deploy would switch every AI feature off. Move the file out of `
    + `functions/, or add the key to it (by hand; never paste it into a chat).`,
  ];
}
