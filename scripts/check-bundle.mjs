// scripts/check-bundle.mjs
//
// The `predeploy` gate for hosting: refuse to publish a bundle that is missing configuration.
//
// Reads what this machine configured and what is actually in `dist/`, and asks `bundleGuard` to
// compare them. Run automatically by `firebase deploy --only hosting`; by hand with
// `npm run check:bundle`.
//
// It never prints a VALUE, only a name. Two of these are public by nature (the Firebase web API
// key and the VAPID public key both ship in the bundle), but a check that habitually echoes
// configuration is one paste away from doing it with something that is not.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundleProblems, REQUIRED, PUSH, OPTIONAL } from './bundleGuard.mjs';

const DIST = join(process.cwd(), 'dist');
const allowMissingPush = process.argv.includes('--allow-missing-push');

function readBundle() {
  const assets = join(DIST, 'assets');
  if (!existsSync(assets)) return '';
  // Every chunk, not just the entry one: a value can land in any of them, and reading a couple of
  // megabytes once is cheaper than a wrong answer.
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
}

/**
 * What this machine configured. Real environment variables win over `.env`, the same order Vite
 * itself uses — so a CI or shell-provided value is honoured rather than reported missing.
 */
function readConfig() {
  const names = [...REQUIRED, PUSH, ...OPTIONAL];
  const config = {};
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (names.includes(m[1]) && value) config[m[1]] = value;
    }
  }
  for (const name of names) {
    if (process.env[name]) config[name] = process.env[name];
  }
  return config;
}

function projectIdFromRc() {
  const rc = join(process.cwd(), '.firebaserc');
  if (!existsSync(rc)) return '';
  try {
    return JSON.parse(readFileSync(rc, 'utf8'))?.projects?.default || '';
  } catch {
    return '';
  }
}

const { fatal, warnings, verified } = bundleProblems({
  bundle: readBundle(),
  config: readConfig(),
  projectId: projectIdFromRc(),
  allowMissingPush,
});

for (const v of verified) console.log(`  ok    ${v}`);
for (const w of warnings) console.log(`  warn  ${w}`);

if (fatal.length) {
  console.error('\nRefusing to deploy this bundle:\n');
  for (const f of fatal) console.error(`  x  ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`\nbundle check: ${verified.length} verified, ${warnings.length} warning(s).`);
