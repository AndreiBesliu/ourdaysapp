"use strict";
// functions/src/geminiKey.ts
//
// The Gemini API key, from Cloud Secret Manager — never from `process.env`. Only the functions
// that list it in `secrets:` receive it (functions/test/geminiSecret.test.ts pins which five).
//
// ── Why it moved, and why NOW (25.09.2026) ─────────────────────────────────────────────────
//
// It was `process.env.GEMINI_API_KEY_LOCAL`: a plain environment variable, readable by anyone with
// viewer rights on the service config, and set on seven live functions, two of which never call
// the model. The audit asked for Secret Manager. What made it urgent was measured in the CLI:
// since 24.09 `functions/.env` exists (for BOOTSTRAP_ADMIN_EMAILS), and when any dotenv file
// exists, `firebase deploy --only functions` sets each function's environment to EXACTLY that
// file — existing variables are not merged back (firebase-tools 15.18.0,
// lib/deploy/functions/prepare.js, inferDetailsFromExisting: the merge runs only `if
// (!usedDotenv)`). The next functions deploy would have removed the key from all seven, and every
// AI feature, on the web and on the phones, would have stopped.
//
// The move was postponed that morning (7969cce: the key stayed a plain variable and functions/.env
// left the repository), then done the same day, at Andrei's choice. The deploy in between had shown
// the price: without functions/.env, BOOTSTRAP_ADMIN_EMAILS was on no function, so `adminSetAiConfig`
// no longer recognised the owner — the AI kill switch could not be turned off from the app.
//
// ── What decides the environment now: functions/.env, not this file ─────────────────────────
//
// A declared secret does NOT change how the CLI builds the environment: secret params never reach
// the resolved values behind `hasEnvsFromParams`, so `usedDotenv` is true only because a
// deploy-loaded dotenv file exists (corrected 25.09 by a review of the CLI source; an earlier
// version of this comment said otherwise). With functions/.env present, each function gets exactly
// its contents plus its secrets — that is what removes the old plain key from the seven. With no
// such file the live environment would be merged back. scripts/functions-env-guard.mjs (a functions
// predeploy step) requires the file, with a non-empty BOOTSTRAP_ADMIN_EMAILS, and refuses a Gemini
// key written into it.
//
// ── The name is new on purpose ──────────────────────────────────────────────────────────────
//
// A secret called GEMINI_API_KEY already exists on live (version 1, 6 May, from an approach
// abandoned the next day; its contents are unknown). Reusing that name, a forgotten
// `secrets:set` would deploy silently against version 1. With a NEW name, a `--non-interactive`
// deploy made before the secret exists fails in `prepare`, before anything changes. From an
// interactive terminal the CLI instead ASKS for the value at a password prompt and creates the
// secret itself (lib/deploy/functions/params.js, handleSecret) — so deploy with --non-interactive.
//
// ── `.value()` only inside a handler ────────────────────────────────────────────────────────
//
// The CLI loads this code with FUNCTIONS_CONTROL_API=true to read the deploy description, and
// `.value()` throws there. At run time it returns the secret, or "" when unset — so every caller
// keeps its `if (!key)` guard.
//
// ── If anyone ever runs the FUNCTIONS emulator ──────────────────────────────────────────────
//
// It reads functions/.secret.local, and for a secret missing there it fetches the PRODUCTION one
// with application-default credentials — and `.firebaserc`'s default is the live project. An EMPTY
// value in .secret.local counts as missing (firebase-tools functionsEmulator.js skips only truthy
// entries). So put a non-empty dummy there first: `GEMINI_KEY=local-disabled`. The callable tests
// in functions/test do not use that emulator; they call the handlers in-process.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEMINI_KEY = void 0;
const params_1 = require("firebase-functions/params");
exports.GEMINI_KEY = (0, params_1.defineSecret)("GEMINI_KEY");
//# sourceMappingURL=geminiKey.js.map