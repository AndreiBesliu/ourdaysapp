// scripts/check-split.mjs
//
// Run the split guard (bundleSplit.mjs) on the real build in dist/. Wired into hosting's predeploy
// and into CI after the build; exits 1 on anything fatal.
//
//   npm run build && node scripts/check-split.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitProblems } from './bundleSplit.mjs';

const DIST = join(import.meta.dirname, '..', 'dist');
const MANIFEST = join(DIST, '.vite', 'manifest.json');
if (!existsSync(MANIFEST)) {
  console.error(`check-split: no ${MANIFEST}. Build first (vite.config.ts writes it with build.manifest).`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const code = {};
for (const f of readdirSync(join(DIST, 'assets'))) {
  if (f.endsWith('.js')) code[`assets/${f}`] = readFileSync(join(DIST, 'assets', f), 'utf8');
}
const { fatal, verified } = splitProblems({ manifest, code });
for (const v of verified) console.log(`  ok   ${v}`);
for (const f of fatal) console.log(`  FAIL ${f}`);
if (fatal.length) process.exit(1);
console.log('check-split: the boot set is clean.');
