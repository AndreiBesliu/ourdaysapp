// scripts/check-offline.mjs — predeploy (firebase.json) and CI, after the build.
//
// Refuses a dist whose offline Cards page and service worker do not belong together, or whose page
// loads anything from elsewhere (scripts/offlineStamp.mjs, distProblems). Also refuses a CSP that
// would block the page's inline script: firebase.json's policy has no script-src / default-src today,
// and the page depends on that.
import { readFileSync, existsSync } from 'node:fs';
import { distProblems, swRev } from './offlineStamp.mjs';
import { offlineKillSwitch } from './offlineFlag.mjs';

// .env files included, exactly as the app build saw it (scripts/offlineFlag.mjs).
const killSwitch = offlineKillSwitch();
const problems = [];
for (const f of ['dist/sw.js', 'public/sw.js']) if (!existsSync(f)) problems.push(`${f} is missing`);
if (!problems.length) {
  const html = existsSync('dist/offline/cards.html') ? readFileSync('dist/offline/cards.html', 'utf8') : null;
  problems.push(...distProblems({
    html,
    sw: readFileSync('dist/sw.js', 'utf8'),
    publicSw: readFileSync('public/sw.js', 'utf8'),
    killSwitch,
  }));
}
const fb = JSON.parse(readFileSync('firebase.json', 'utf8'));
const csp = JSON.stringify(fb.hosting?.headers ?? []);
if (/script-src|default-src/.test(csp)) problems.push('the hosting CSP sets script-src/default-src; the offline page uses an inline script');

if (problems.length) {
  console.error(`check-offline: FAILED\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
// Said from what dist/sw.js actually carries, not from the flag.
const rev = swRev(readFileSync('dist/sw.js', 'utf8'));
console.log(rev === 'off' ? "check-offline: kill switch on, worker stamped 'off'." : `check-offline: page and worker belong together (rev ${rev}).`);
