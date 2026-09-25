// scripts/stamp-error-expiry.mjs
//
// Give every `errorLogs` row written BEFORE the TTL change its `expireAt` — createdAt + 90 days —
// so the TTL policy (firestore.indexes.json) retires the old rows too. Without this they keep a
// uid, and for client rows an email and user agent, for ever. See functions/src/errorRetention.ts.
//
// ── Two modes, and the default is the harmless one ─────────────────────────────────────────
//
//   node scripts/stamp-error-expiry.mjs            DRY RUN: reads, counts, writes nothing
//   node scripts/stamp-error-expiry.mjs --apply    writes. ONLY with Andrei's confirmation, and at
//                                                  least an hour after the functions deploy (old
//                                                  instances may still write unstamped rows)
//
// The read-only measurement key can do the dry run and cannot `--apply`, by design. Applying needs
// a credential with write access, supplied by Andrei through OURDAYS_SA_KEY, outside the repo.
//
// A row whose expiry has ALREADY passed (older than 90 days) is deleted by the policy within about
// a day of being stamped — irreversibly. The dry run prints how many; measured 25.09: 110 rows,
// the oldest 61 days, so none. Prints COUNTS only.
//
// `update`, never `set`: a row the TTL deleted between the read and the write must stay deleted,
// not come back as a stub. And `lastUpdateTime`: a row touched meanwhile is skipped, not overwritten.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { ERROR_LOG_TTL_FIELD, errorLogExpiryMs } from '../functions/src/errorRetention.ts';

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

const now = Date.now();
const snap = await db.collection('errorLogs').get();
const counts = { rows: snap.size, alreadyStamped: 0, noCreatedAt: 0, toStamp: 0, wouldExpireAtOnce: 0 };
const todo = [];
for (const d of snap.docs) {
  const x = d.data();
  if (x[ERROR_LOG_TTL_FIELD] !== undefined) { counts.alreadyStamped++; continue; }
  const at = x.createdAt;
  if (!at || typeof at.toMillis !== 'function') { counts.noCreatedAt++; continue; }
  const exp = errorLogExpiryMs(at.toMillis());
  counts.toStamp++;
  if (exp <= now) counts.wouldExpireAtOnce++;
  todo.push({ ref: d.ref, exp, updateTime: d.updateTime });
}

console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'dry-run', ...counts }, null, 2));
if (!APPLY) {
  console.log(counts.toStamp
    ? `\nDry run: ${counts.toStamp} row(s) would get an expiry (${counts.wouldExpireAtOnce} already past it). Nothing was written.`
    : '\nNothing to stamp.');
  process.exit(0);
}

let stamped = 0, skipped = 0;
for (const t of todo) {
  try {
    await t.ref.update({ [ERROR_LOG_TTL_FIELD]: admin.firestore.Timestamp.fromMillis(t.exp) }, { lastUpdateTime: t.updateTime });
    stamped++;
  } catch (e) {
    // 5 NOT_FOUND (deleted meanwhile), 9 FAILED_PRECONDITION (changed meanwhile): leave it be.
    if (e?.code === 5 || e?.code === 9) { skipped++; continue; }
    throw e;
  }
}
console.log(`\nStamped ${stamped} row(s); skipped ${skipped} that changed or vanished meanwhile.`);
