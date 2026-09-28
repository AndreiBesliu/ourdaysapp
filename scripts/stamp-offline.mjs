// scripts/stamp-offline.mjs — run by `npm run build`, after both Vite builds.
//
// Stamps the offline Cards page's revision into the page and into dist/sw.js (scripts/offlineStamp.mjs).
// With VITE_OFFLINE_CARDS=0 the worker is stamped 'off': it removes any stored page and declines
// navigations exactly as before the offline page existed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pageProblems, swProblems, revOf, stampPage, stampSw } from './offlineStamp.mjs';
import { offlineKillSwitch } from './offlineFlag.mjs';

const PAGE = 'dist/offline/cards.html';
const SW = 'dist/sw.js';
// .env files included, exactly as the app build saw it (scripts/offlineFlag.mjs).
const killSwitch = offlineKillSwitch();

const fail = (lines) => {
  console.error(`stamp-offline: refused\n  - ${lines.join('\n  - ')}`);
  process.exit(1);
};

if (!existsSync(SW)) fail([`${SW} is missing (run the app build first)`]);
const sw = readFileSync(SW, 'utf8');
const swBad = swProblems(sw);
if (swBad.length) fail(swBad);

if (killSwitch) {
  writeFileSync(SW, stampSw(sw, 'off'));
  console.log("stamp-offline: VITE_OFFLINE_CARDS=0 — worker stamped 'off' (the offline page is disabled).");
} else {
  if (!existsSync(PAGE)) fail([`${PAGE} is missing (run the offline build first)`]);
  const html = readFileSync(PAGE, 'utf8');
  const pageBad = pageProblems(html);
  if (pageBad.length) fail(pageBad);
  const rev = revOf(html);
  writeFileSync(PAGE, stampPage(html, rev));
  writeFileSync(SW, stampSw(sw, rev));
  console.log(`stamp-offline: rev ${rev} (${Buffer.byteLength(html, 'utf8')} bytes).`);
}
