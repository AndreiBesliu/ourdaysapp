// scripts/migrate-public-birthdays.mjs
//
// Rewrite every `profiles/{uid}.birthday` that still holds a FULL date to day-and-month
// (`0000-MM-DD`) — Andrei's decision of 24.09.2026: the public profile is readable by every
// signed-in account, and a year there is an age. The full date stays in `users/{uid}`.
//
// ── Two modes, and the default is the harmless one ─────────────────────────────────────────
//
//   node scripts/migrate-public-birthdays.mjs            DRY RUN: reads, counts, writes nothing
//   node scripts/migrate-public-birthdays.mjs --apply    writes. ONLY with Andrei's confirmation.
//
// The read-only key used for measurements (`roles/datastore.viewer`) can do the dry run and CANNOT
// do `--apply` — which is the point. Applying needs a credential with write access, supplied by
// Andrei through OURDAYS_SA_KEY, outside the repository.
//
// Prints COUNTS only: never a uid, a name, or a date.
//
// The conversion is imported from `src/utils/publicProfile.ts` itself (Node 23.6+ strips the types),
// so this script and the app cannot disagree about what "public" means.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { publicBirthday } from '../src/utils/publicProfile.ts';

const APPLY = process.argv.includes('--apply');

const KEY = process.env.OURDAYS_SA_KEY
  || resolve(process.env.USERPROFILE || process.env.HOME || '', '.ourdays', 'service-account.json');
if (!existsSync(KEY)) {
  console.error(`No service-account key at ${KEY}. Set OURDAYS_SA_KEY.`);
  process.exit(2);
}
const repo = resolve(process.cwd());
if (resolve(KEY).startsWith(repo + sep)) {
  console.error('REFUSING: the key is inside the repository. Move it outside and try again.');
  process.exit(2);
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const admin = require(resolve(repo, 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
const db = admin.firestore();

const snap = await db.collection('profiles').get();
const counts = { profiles: snap.size, noBirthday: 0, alreadyPublic: 0, toRewrite: 0, unreadable: 0 };
const rewrites = [];
for (const d of snap.docs) {
  const b = d.data()?.birthday;
  if (b === undefined || b === null || b === '') { counts.noBirthday++; continue; }
  if (typeof b === 'string' && /^0000-\d{2}-\d{2}$/.test(b)) { counts.alreadyPublic++; continue; }
  const pub = publicBirthday(b);
  // Unreadable values are left alone and counted: guessing would write something nobody entered.
  if (!pub) { counts.unreadable++; continue; }
  counts.toRewrite++;
  rewrites.push({ ref: d.ref, birthday: pub });
}

console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'dry-run', ...counts }, null, 2));

if (!APPLY) {
  console.log(counts.toRewrite
    ? `\nDry run: ${counts.toRewrite} profile(s) would be rewritten. Nothing was written.`
    : '\nNothing to rewrite.');
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rewrites.length; i += 400) {
  const batch = db.batch();
  for (const r of rewrites.slice(i, i + 400)) batch.update(r.ref, { birthday: r.birthday });
  await batch.commit();
  written += Math.min(400, rewrites.length - i);
}
console.log(`\nRewrote ${written} profile(s).`);
