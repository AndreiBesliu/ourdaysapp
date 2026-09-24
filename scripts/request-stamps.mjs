// scripts/request-stamps.mjs
//
// Friend requests and group invitations carrying a `sender` / `verifiedGroupName` stamp that the
// SERVER did not write.
//
// The screen trusts those two fields (utils/requestSender.ts), and only the server may write them —
// but that is only true once three things are deployed: the stamping triggers (functions), the rule
// that refuses them from a client (rules), and then the screen that shows them (hosting). Until the
// rules are live, ANY client may write a stamp. A request created before the functions deploy was
// never stamped by the server, so a stamp on it is forged by construction.
//
//   node scripts/request-stamps.mjs                          count, read-only, prints numbers only
//   node scripts/request-stamps.mjs --before <ISO time>      only docs CREATED before that instant
//   node scripts/request-stamps.mjs --before <ISO> --apply   strip them. ONLY with Andrei's confirmation,
//                                                            and with a key that can write.
//
// `createTime` is the server's, not the client's `createdAt`, so it cannot be forged. Run it after
// the rules deploy and BEFORE hosting, with --before set to the moment the functions went live.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const APPLY = process.argv.includes('--apply');
const bi = process.argv.indexOf('--before');
const BEFORE = bi > 0 ? Date.parse(process.argv[bi + 1]) : null;
if (bi > 0 && !Number.isFinite(BEFORE)) { console.error('--before needs an ISO time'); process.exit(2); }
if (APPLY && BEFORE === null) { console.error('REFUSING: --apply needs --before <functions deploy time>.'); process.exit(2); }

const KEY = process.env.OURDAYS_SA_KEY
  || resolve(process.env.USERPROFILE || process.env.HOME || '', '.ourdays', 'service-account.json');
if (!existsSync(KEY)) { console.error(`No service-account key at ${KEY}.`); process.exit(2); }
const repo = resolve(process.cwd());
if (resolve(KEY).startsWith(repo + sep)) { console.error('REFUSING: the key is inside the repository.'); process.exit(2); }

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const admin = require(resolve(repo, 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
const db = admin.firestore();

const report = {};
const strip = [];
for (const coll of ['friend_requests', 'group_invites']) {
  const snap = await db.collection(coll).get();
  const row = { docs: snap.size, withSender: 0, withGroupName: 0, pending: 0, stampedBefore: 0 };
  for (const d of snap.docs) {
    const x = d.data() || {};
    const has = 'sender' in x || 'verifiedGroupName' in x;
    if ('sender' in x) row.withSender++;
    if ('verifiedGroupName' in x) row.withGroupName++;
    if (x.status === 'pending') row.pending++;
    if (has && BEFORE !== null && d.createTime.toMillis() < BEFORE) { row.stampedBefore++; strip.push(d.ref); }
  }
  report[coll] = row;
}
console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'read-only', before: BEFORE ? new Date(BEFORE).toISOString() : null, ...report }, null, 2));

if (APPLY) {
  const del = admin.firestore.FieldValue.delete();
  for (const ref of strip) await ref.update({ sender: del, verifiedGroupName: del });
  console.log(`\nStripped ${strip.length} forged stamp(s).`);
}
