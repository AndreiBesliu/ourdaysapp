// scripts/profile-shape.mjs
// Which FIELD NAMES exist on live `profiles` documents — nothing else.
//
// ── Why this exists ─────────────────────────────────────────────────────────────────
//
// `profiles/{uid}` had `allow write: if isOwner(userId)` with no shape constraint at all, on a
// document every signed-in account can read and that five screens bulk-fetch and render. The file
// twenty lines below already contains `warlordPlayerShapeOk` — a field whitelist with length caps —
// written for exactly that reason. The fix is to give `profiles` the same thing.
//
// But a whitelist is only safe if it names every field real documents carry. `hasOnly` is evaluated
// against the MERGED document, so a legacy key nobody remembers would make the owner's next profile
// edit fail — a rule that "protects" people by locking them out. The client writes name, photoURL
// and birthday today; what OLDER code wrote is a question about live data, not about the repo.
//
// So: measure first. Vezi [[feedback_masoara_inainte_sa_construiesti]].
//
// ── What it prints, and what it refuses to print ────────────────────────────────────
//
// Field NAMES and how many documents carry each. Never a value, never a uid, never a document id.
// A display name, an avatar URL and a date of birth are exactly the data this whole exercise is
// about protecting; reading them to decide how to protect them would be its own joke.
//
// Same rules as `read-errors.mjs`: refuses a key inside the repository, and only ever reads.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const KEY = process.env.OURDAYS_SA_KEY
  || resolve(process.env.USERPROFILE || process.env.HOME || '', '.ourdays', 'service-account.json');

if (!existsSync(KEY)) {
  console.error(`No service-account key at ${KEY}. Set OURDAYS_SA_KEY, or skip this measurement.`);
  process.exit(2);
}

// A key inside the tree is one `git add` away from being published for ever.
const repo = resolve(process.cwd());
if (resolve(KEY).startsWith(repo + sep)) {
  console.error('REFUSING: the key is inside the repository. Move it outside and try again.');
  process.exit(2);
}

// `firebase-admin` lives in functions/, not at the root: CI installs only the root package, and
// adding a 100 MB dependency there to run one measurement would be a poor trade. `read-errors.mjs`
// resolves it the same way.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const admin = require(resolve(repo, 'functions', 'node_modules', 'firebase-admin'));

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(KEY, 'utf8'))) });
const db = admin.firestore();

const snap = await db.collection('profiles').get();
const counts = new Map();
for (const doc of snap.docs) {
  for (const key of Object.keys(doc.data() || {})) {
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}

console.log(`profiles documents: ${snap.size}`);
console.log('field names present (name only, never a value):');
for (const [field, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${field}`);
}
