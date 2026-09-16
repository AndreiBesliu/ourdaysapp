// scripts/bundleGuard.mjs
//
// What has to be baked into a bundle before it is allowed onto the live site.
//
// Every Firebase key in this app comes from a gitignored `.env` that exists on ONE machine. Vite
// substitutes each `import.meta.env.VITE_*` at build time, and an absent one becomes the literal
// `undefined` — silently. So `npm run build` succeeds, the bundle uploads, and the app that lands
// in front of people has no project to talk to. Nothing anywhere goes red: CI builds without a
// `.env` at all and reports green, because its job is typecheck and tests, not configuration.
//
// That is not hypothetical here. The live error log carried ten reports of
// "Web push is not configured: no VAPID key" from two people — a whole feature missing from a
// build that every gate had called good. The key was added and the next deploy fixed it, but the
// same shape can take the ENTIRE app down rather than one feature, and would look exactly as green.
//
// ── Why it COMPARES rather than sniffs ───────────────────────────────────────────────────────
//
// The first version of this file looked for shapes: an `AIza…` string, an 87-character base64url
// key. Built without a `.env` at all, it still reported "ok Web push VAPID key" and "ok App Check
// wiring" — the regex had matched something else in a two-megabyte bundle, and the word
// "recaptcha" is in the SDK whether or not a key is configured. A guard that recognises a SHAPE
// says nothing about whether YOUR value is in there.
//
// So it compares two things it can both see: what this machine configured, and what is in the
// artifact. Every configured value must appear verbatim in the bundle. That catches the build
// made before the key was added, the build made without the file, and the stale `dist/` nobody
// rebuilt — none of which a shape can tell apart from success.

/** Without these the app cannot reach Firebase at all. */
export const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

/** Without this, push notifications are silently dead — the failure that prompted this file. */
export const PUSH = 'VITE_FIREBASE_VAPID_KEY';

/** Optional by design: enforcement is a server-side switch and the client skips attestation. */
export const OPTIONAL = ['VITE_APPCHECK_RECAPTCHA_KEY'];

/**
 * Everything wrong with a bundle about to be deployed.
 *
 * @param {object} args
 * @param {string} args.bundle     the built JavaScript, concatenated
 * @param {Record<string,string>} args.config  the VITE_* values this machine configured
 * @param {string} args.projectId  the Firebase project this deploy targets, from .firebaserc
 * @param {boolean} [args.allowMissingPush]  deliberate opt-out for a build shipping without push
 * @returns {{fatal: string[], warnings: string[], verified: string[]}}
 *          `verified` NAMES what was actually found — never values. A check that reports only
 *          failures cannot be told apart from one that ran against the wrong file and found
 *          nothing to complain about.
 */
export function bundleProblems({ bundle, config = {}, projectId, allowMissingPush = false }) {
  const fatal = [];
  const warnings = [];
  const verified = [];

  if (!bundle || bundle.length < 1000) {
    fatal.push('The bundle is empty or absurdly small — was `npm run build` run at all?');
    return { fatal, warnings, verified };
  }

  const set = (name) => typeof config[name] === 'string' && config[name].trim().length > 0;

  if (!REQUIRED.some(set) && !set(PUSH)) {
    fatal.push(
      'No VITE_FIREBASE_* configuration found on this machine. `.env` is gitignored and lives on ' +
      'one computer — see .env.example for the names and where each value comes from.',
    );
    return { fatal, warnings, verified };
  }

  for (const name of [...REQUIRED, PUSH, ...OPTIONAL]) {
    const optional = name !== PUSH && !REQUIRED.includes(name);

    if (!set(name)) {
      if (name === PUSH) {
        if (allowMissingPush) warnings.push(`${name} is not set — web push will be off, as asked.`);
        else fatal.push(`${name} is not set, so push notifications would be silently dead — exactly what the live error log reported for two people. Set it, or pass --allow-missing-push if you mean it.`);
      } else if (optional) {
        warnings.push(`${name} is not set — requests will not be attested by App Check.`);
      } else {
        fatal.push(`${name} is not set; the app cannot reach Firebase without it.`);
      }
      continue;
    }

    // Configured — but did it reach the artifact? This is the half a shape-matching check misses.
    if (bundle.includes(config[name])) {
      verified.push(name);
    } else {
      fatal.push(
        `${name} is configured but does NOT appear in the built bundle. The build is older than ` +
        'the value — run `npm run build` again before deploying.',
      );
    }
  }

  // Catches the opposite mistake from a missing value: a complete config for the WRONG project.
  if (!projectId) {
    warnings.push('No project id in .firebaserc to check the bundle against.');
  } else if (bundle.includes(projectId)) {
    verified.push(`bundle targets ${projectId}`);
  } else {
    fatal.push(`The bundle does not mention "${projectId}" — it was built against a different Firebase project.`);
  }

  return { fatal, warnings, verified };
}
