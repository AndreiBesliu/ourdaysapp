"use strict";
// functions/src/geminiKey.ts
//
// The Gemini API key — the ONE place any function reads it.
//
// ── For now: the plain variable the live functions already carry ────────────────────────────
//
// It is `GEMINI_API_KEY_LOCAL`, set as a plain environment variable on the seven live functions
// (measured 25.09.2026). The move to Cloud Secret Manager was written and tested on 25.09 (commit
// 23544ce), then POSTPONED by Andrei the same day: it needs him to put the key into Secret Manager
// once, and he chose to do that later. BACKLOG.md holds the recipe; re-applying 23544ce's
// `defineSecret("GEMINI_KEY")` + `secrets: [GEMINI_KEY]` here and in index.ts is the whole code change.
//
// ── The trap this depends on — and the guard that holds it ─────────────────────────────────
//
// A functions deploy keeps a live function's existing environment ONLY when no dotenv file is used
// (firebase-tools 15.18.0, lib/deploy/functions/prepare.js: `inferDetailsFromExisting` merges the
// live variables `if (!usedDotenv)`; usedDotenv = a functions/.env, .env.<project> or .env.<alias>
// exists, OR the code declares params). With such a file, each function gets EXACTLY its contents,
// and this key disappears from all seven — every AI feature stops, web and phones. That nearly
// happened: functions/.env existed from 24.09 to 25.09 for BOOTSTRAP_ADMIN_EMAILS. It was moved out
// of the repository, and scripts/functions-env-guard.mjs (a functions predeploy step) now refuses a
// deploy while any such file exists without this key. No `firebase-functions/params` here either:
// a declared param counts as a dotenv too.
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiKey = geminiKey;
function geminiKey() {
    return process.env.GEMINI_API_KEY_LOCAL || "";
}
//# sourceMappingURL=geminiKey.js.map