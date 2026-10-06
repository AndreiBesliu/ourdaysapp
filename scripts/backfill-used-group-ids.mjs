// scripts/backfill-used-group-ids.mjs
//
// Puts on the list of used group ids (functions/src/groupIds.ts) every id it cannot learn by itself:
// the groups that exist now, deleted groups whose messages were left, and ids still named by events,
// expenses, games, invitations, links or wallet cards. Without it, a group that existed before the
// list is listed only when it is deleted, and deleted from the installed app or the console that
// happens seconds later, through a trigger: long enough for somebody who knows the id to create it
// again (06.10.2026). The logic is functions/src/groupIdsBackfill.ts, tested on the emulator.
//
// ── Two modes, and the default is the harmless one ─────────────────────────────────────────
//
//   node scripts/backfill-used-group-ids.mjs           DRY RUN: reads, prints the plan, writes nothing
//   node scripts/backfill-used-group-ids.mjs --apply   writes. ONLY with Andrei's confirmation, AFTER the
//                                                      functions deploy and BEFORE the rules deploy
//
// The read-only measurement key can do the dry run and cannot `--apply`, by design. Applying needs a
// credential with write access, supplied by Andrei through OURDAYS_SA_KEY, outside the repo. It only
// adds entries to `usedGroupIds`; it never deletes or changes anything else. Prints counts, plus the
// ids it refuses (not a single document id) and any group that looks created again.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';

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

const require = createRequire(import.meta.url);
const admin = require(resolve(repo, 'functions', 'node_modules', 'firebase-admin'));
const cred = JSON.parse(readFileSync(KEY, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(cred), projectId: cred.project_id });
// The compiled functions, so `admin` above is the very instance they use (functions/lib is built and
// committed with every change to functions/src).
const { planGroupIdBackfill, applyGroupIdBackfill } = require(resolve(repo, 'functions', 'lib', 'groupIdsBackfill.js'));

const plan = await planGroupIdBackfill();
console.log(JSON.stringify({
  project: cred.project_id,
  mode: APPLY ? 'APPLY' : 'dry run',
  liveGroups: plan.live,
  deletedGroupsWithSubcollectionsLeft: plan.missingParents,
  deletedGroupIdsStillNamed: plan.referencedDead,
  idsToList: plan.toRegister.length,
  refused: plan.refused,
  groupsThatLookCreatedAgain: plan.recreatedSuspects,
}, null, 1));

if (!APPLY) {
  console.log('Dry run: nothing written. Re-run with --apply, with Andrei\'s confirmation, after the functions deploy.');
  process.exit(0);
}
const added = await applyGroupIdBackfill(plan.toRegister);
console.log(JSON.stringify({ listedNow: added, alreadyListed: plan.toRegister.length - added }));
process.exit(0);
