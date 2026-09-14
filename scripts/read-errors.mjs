// scripts/read-errors.mjs
// Read the live error panel from a terminal, with a service-account key.
//
// ── What this is for ─────────────────────────────────────────────────────────────────
//
// The admin health screen is behind authentication and the Firebase CLI cannot read Firestore, so
// until now every round of "what is broken on live" needed the owner to open the panel and describe
// what was there. `logErrorDigest` closed most of that gap (a summary into the function logs every
// six hours, no credentials needed). This closes the rest: the same data, live, on demand.
//
// ── The thing to be careful about ────────────────────────────────────────────────────
//
// A service-account key is a production credential that bypasses Firestore rules entirely. Two
// consequences shape this script:
//
//   1. It REFUSES to run if the key sits anywhere inside the repository. A key in the tree is one
//      `git add` away from being published for ever, and this repo's own history records a `git add
//      -A` that swept twenty-one unrelated files. The check is cheap and the mistake is permanent.
//   2. It only ever READS: .get(), .getAll(), .count(). The key it expects is a Cloud Datastore
//      VIEWER, chosen deliberately over a writer — Firestore has no collection-scoped roles, so
//      the write role would have handed full write access to every event, chat and wallet in
//      the database in exchange for automating one bookkeeping click. Revoking it is one click
//      in the console’s Keys tab, which is the kill switch.
//   3. It never prints the key, the key's path contents, or any uid or email from the log. What is
//      needed to FIX an error is what it is and how often; who hit it is not part of that.
//
// ── Usage ────────────────────────────────────────────────────────────────────────────
//
//   node scripts/read-errors.mjs                 # the grouped panel
//   node scripts/read-errors.mjs --json          # the same, machine-readable
//   node scripts/read-errors.mjs --stack 2       # the full newest stack for group #2
//   node scripts/read-errors.mjs --status new    # only groups in one state
//
// The key is found at $OURDAYS_SA_KEY, or ~/.ourdays/service-account.json.
//
// Grouping and state come from functions/lib — the SAME compiled code the server runs. Nothing here
// reimplements either, because two implementations of one decision drift, and the one that drifts is
// always the one you are looking at.

import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const KEY_PATH = process.env.OURDAYS_SA_KEY || path.join(homedir(), '.ourdays', 'service-account.json');
const SCAN_LIMIT = 500;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

function die(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

// ── the key, and where it is allowed to live ────────────────────────────────
if (!existsSync(KEY_PATH)) {
  die(`No service-account key at ${KEY_PATH}`,
    'Set OURDAYS_SA_KEY, or put the key at ~/.ourdays/service-account.json. See docs in this file.');
}

const keyReal = realpathSync(KEY_PATH);
const repoReal = realpathSync(REPO);
if (keyReal === repoReal || keyReal.startsWith(repoReal + path.sep)) {
  die(`The key is INSIDE the repository: ${keyReal}`,
    'Move it outside the working tree. A key in the tree is one `git add` away from being published '
    + 'permanently, and no .gitignore rule survives a determined `git add -f` or a tool that ignores it.');
}

let credential;
try {
  credential = JSON.parse(readFileSync(keyReal, 'utf8'));
} catch (err) {
  die(`Could not read the key as JSON: ${err.message}`);
}
if (credential.type !== 'service_account' || !credential.project_id) {
  die('That file is not a service-account key (no "type": "service_account").');
}

// ── connect, read, group ────────────────────────────────────────────────────
const admin = require(path.join(REPO, 'functions', 'node_modules', 'firebase-admin'));
const { groupErrors } = require(path.join(REPO, 'functions', 'lib', 'errorGrouping.js'));
const { joinState, groupDocId, STATUS_RANK } = require(path.join(REPO, 'functions', 'lib', 'errorState.js'));

admin.initializeApp({ credential: admin.credential.cert(credential), projectId: credential.project_id });
const db = admin.firestore();

const [snap, totalSnap] = await Promise.all([
  db.collection('errorLogs').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
  db.collection('errorLogs').count().get().catch(() => null),
]);

const scanned = snap.docs.map((d) => {
  const e = d.data();
  return { id: d.id, ...e, createdAt: e.createdAt?.toDate?.()?.toISOString?.() || null };
});
const grouped = groupErrors(scanned);

// State for every group, by key — never zipped by index. That pairing, done positionally, is
// exactly the defect an adversarial review caught in the server on 14.09: a slice applied to one
// side and not the other made every group past the cap report "new", silently.
const byKey = new Map();
for (let i = 0; i < grouped.length; i += 300) {
  const slice = grouped.slice(i, i + 300);
  const snaps = await db.getAll(...slice.map((g) => db.doc(`errorGroups/${groupDocId(g.key)}`)));
  snaps.forEach((s, j) => { const d = s.data(); if (d) byKey.set(slice[j].key, d); });
}

let groups = joinState(grouped, (k) => byKey.get(k) || null);
groups.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.count - a.count);

const only = value('--status');
if (only) groups = groups.filter((g) => g.status === only);

// ── one group's full stack ──────────────────────────────────────────────────
const stackOf = value('--stack');
if (stackOf !== null) {
  const g = groups[Number(stackOf) - 1];
  if (!g) die(`No group #${stackOf}. There are ${groups.length}.`);
  console.log(`\n#${stackOf}  [${g.status}]  ${g.sample}\n`);
  console.log(g.sampleStack || '(no stack recorded)');
  process.exit(0);
}

if (flag('--json')) {
  console.log(JSON.stringify({ total: totalSnap?.data?.()?.count ?? null, scanned: scanned.length, groups }, null, 2));
  process.exit(0);
}

// ── the readable form ───────────────────────────────────────────────────────
const total = totalSnap?.data?.()?.count ?? scanned.length;
const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');

console.log(`\n  ${total} logged errors · ${grouped.length} distinct problems · scanned the newest ${scanned.length}`);
if (scanned.length >= SCAN_LIMIT) {
  console.log('  (the counts below cover that window, not the whole log)');
}
console.log('');

const counts = groups.reduce((acc, g) => ({ ...acc, [g.status]: (acc[g.status] || 0) + 1 }), {});
console.log(`  regressed ${counts.regressed || 0} · new ${counts.new || 0} · seen ${counts.seen || 0} · resolved ${counts.resolved || 0}\n`);

groups.forEach((g, i) => {
  const tag = g.status === 'regressed' ? 'REGRESSED'
    : g.status === 'new' ? 'new' : g.status === 'seen' ? 'seen' : 'resolved';
  console.log(`  #${i + 1}  ${String(g.count).padStart(4)}×  [${tag}]${g.recurred && g.status !== 'regressed' ? ' (still happening)' : ''}`);
  console.log(`        ${g.sample.slice(0, 150)}`);
  console.log(`        ${g.context || '—'} · ${g.people} ${g.people === 1 ? 'person' : 'people'} · ${day(g.firstSeen)} → ${day(g.lastSeen)}${g.urls?.length ? ` · ${g.urls.join(', ')}` : ''}`);
  console.log('');
});

if (groups.length === 0) console.log('  Nothing in that state.\n');
console.log(`  Full stack for one:  node scripts/read-errors.mjs --stack <n>\n`);
process.exit(0);
