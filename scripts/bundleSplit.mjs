// scripts/bundleSplit.mjs
//
// What loads at boot must not contain the screens that were split out of it (25.09.2026), nor the
// heavy library that was the point of splitting Wallet. Pure: it judges a Vite manifest plus the
// chunk texts, so the decision is tested on fixtures (bundleSplit.test.mjs) and run on the real
// build by check-split.mjs.
//
// Two checks, because each is blind where the other sees. The manifest says which FILE is in the
// boot set — but measured on a scratch build, a stray `import BarcodeScanner` in EventDetailsModal
// left Wallet as its own chunk while pulling html5-qrcode into boot code. Only a marker in the text
// catches that.

/** Screens that must be dynamic entries, outside the boot set. */
export const LAZY_SCREENS = [
  'src/screens/Wallet.tsx', 'src/screens/Chat.tsx', 'src/screens/Settings.tsx',
  'src/screens/Admin.tsx', 'src/screens/PeriodLog.tsx', 'src/screens/Warlord.tsx',
];

/** Code that must never load at boot, found by a string that survives minification. */
export const HEAVY = [{ what: 'html5-qrcode (the Wallet scanner)', marker: 'Html5Qrcode' }];

/** File names loaded at boot: the single entry chunk and everything it statically imports. */
export function bootFiles(manifest) {
  const keys = Object.keys(manifest).filter((k) => manifest[k] && manifest[k].isEntry);
  if (keys.length !== 1) return null;
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    files.add(chunk.file);
    for (const dep of chunk.imports || []) visit(dep);
  };
  visit(keys[0]);
  return files;
}

/** `code` maps a chunk file name to its text. Returns names only — never code. */
export function splitProblems({ manifest, code }) {
  const fatal = [];
  const verified = [];
  const boot = bootFiles(manifest);
  if (!boot) return { fatal: ['the manifest does not have exactly one entry chunk'], verified };
  for (const screen of LAZY_SCREENS) {
    const chunk = manifest[screen];
    if (!chunk) { fatal.push(`${screen} has no chunk of its own — it was bundled into another`); continue; }
    if (!chunk.isDynamicEntry) { fatal.push(`${screen} is not loaded lazily`); continue; }
    if (boot.has(chunk.file)) { fatal.push(`${screen} is in the boot set`); continue; }
    verified.push(screen);
  }
  for (const { what, marker } of HEAVY) {
    const holders = Object.keys(code).filter((file) => code[file].includes(marker));
    if (holders.length === 0) { fatal.push(`${what}: marker "${marker}" is in no chunk at all — the check has gone stale`); continue; }
    const inBoot = holders.filter((file) => boot.has(file));
    if (inBoot.length) fatal.push(`${what} is in the boot set`);
    else verified.push(what);
  }
  return { fatal, verified };
}
