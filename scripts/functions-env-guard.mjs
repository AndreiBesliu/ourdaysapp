// scripts/functions-env-guard.mjs
//
// Functions predeploy step (firebase.json): refuse a deploy that would drop the Gemini key from the
// live functions. See functionsEnvGuard.mjs. Reads variable NAMES only and prints no value.

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
  .filter((n) => n === '.env' || n.startsWith('.env.'))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

const problems = projectIds.flatMap((id) => envGuardProblems(files, id, aliases));
if (problems.length) {
  for (const p of new Set(problems)) console.error(`functions-env-guard: ${p}`);
  process.exit(1);
}
console.log('functions-env-guard: no dotenv would replace the live environment.');
