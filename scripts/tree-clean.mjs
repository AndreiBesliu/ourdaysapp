// scripts/tree-clean.mjs
//
// Refuse to deploy from a working tree that does not match the commit.
//
// ── Why this exists, measured twice on 2026-09-20/21 ──────────────────────────────────────
//
// This repo lives in a Google Drive folder, and the sync client rewrites files asynchronously.
// After a mutation-testing run — the harness writes a deliberately broken version of a file, runs
// the suite, writes the original back and re-reads it to confirm — Drive can replay the BROKEN
// version hours later, long after the harness verified the restore and exited.
//
// It is not hypothetical and it is not rare. Over two days it happened to four separate files:
// CalendarHome.tsx, aiErrorKey.ts, aiLedgerShape.test.ts and verifiedEmail.ts, each coming back
// with the exact text of a mutation, with no command in the session having touched them.
//
// Every other net misses this. The tests pass at the moment they run and the file changes after;
// `git status` is clean when you look and dirty an hour later; CI checks the COMMIT, which was
// always correct. The one moment where it can do real harm is a deploy — a build picks up whatever
// is on disk right then — and that is the moment this guard occupies.
//
// Deliberately a whole-tree check and not a list of files: the next resurrection will be a file
// nobody has thought about, which is the entire point.
//
// Not a substitute for judgement: when this fails, READ THE DIFF. A dirty file after a mutation
// run is a mutation until proven otherwise, and if it looks like your own unfinished work, commit
// it. Never restore blind.

import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let status;
try {
  status = git(['status', '--porcelain']);
} catch (err) {
  // Not a git checkout, or git is unavailable. A guard that cannot run must say so and step
  // aside rather than blocking a deploy for a reason that has nothing to do with the tree.
  console.warn(`tree-clean: could not read git status (${err.message.trim()}) — skipping.`);
  process.exit(0);
}

// Untracked files are not a hazard on their own: a build reads what the source imports, and
// nothing imports a file that has never been committed. Modified and staged ones are the risk.
const lines = status.split('\n').map((l) => l.trimEnd()).filter(Boolean);
const dirty = lines.filter((l) => !l.startsWith('??'));

if (dirty.length === 0) {
  console.log(`tree-clean: working tree matches the commit${lines.length ? ` (${lines.length} untracked, ignored)` : ''}.`);
  process.exit(0);
}

console.error('');
console.error('  DEPLOY REFUSED — the working tree does not match the commit.');
console.error('');
for (const line of dirty) console.error(`    ${line}`);
console.error('');
console.error('  What is being deployed is built from these files, not from the commit, so');
console.error('  whatever is in them right now is what reaches live.');
console.error('');
console.error('  This repo is inside Google Drive, and the sync client has replayed the broken');
console.error('  version of a file HOURS after a mutation-testing run verified the restore —');
console.error('  four separate files over 20-21.09.2026. So a file you did not knowingly edit is');
console.error('  a resurrected mutation until you have looked:');
console.error('');
console.error('      git diff --ignore-cr-at-eol <file>');
console.error('');
console.error('  If it is yours, commit it. If it is not, restore it with');
console.error('  `git checkout -- <file>`, then re-read it to confirm the restore actually stuck.');
console.error('');
process.exit(1);
