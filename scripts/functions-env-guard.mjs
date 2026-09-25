// scripts/functions-env-guard.mjs
//
// Functions predeploy step (firebase.json): refuse a deploy whose dotenv would drop the bootstrap
// address from the live functions, or that carries the Gemini key in plain text. See
// functionsEnvGuard.mjs. Reads variable NAMES only and prints no value.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envGuardProblems } from './functionsEnvGuard.mjs';

const root = join(import.meta.dirname, '..');
const rc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
const projects = rc.projects || {};
const aliases = Object.keys(projects);
const projectIds = [...new Set(Object.values(projects))];

const dir = join(root, 'functions');
const files = readdirSync(dir)
  // Case-insensitive, as the CLI's `fs.existsSync` is on Windows.
  .filter((n) => n.toLowerCase() === '.env' || n.toLowerCase().startsWith('.env.'))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

const problems = projectIds.flatMap((id) => envGuardProblems(files, id, aliases));
if (problems.length) {
  for (const p of new Set(problems)) console.error(`functions-env-guard: ${p}`);
  process.exit(1);
}
console.log('functions-env-guard: the deploy dotenv carries the bootstrap address and no Gemini key.');
