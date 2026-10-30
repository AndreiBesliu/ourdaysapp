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

/**
 * Screens, and parts of screens, that must be dynamic entries, outside the boot set. The calendar's
 * windows and the card code since 29.10.2026: they carried the code libraries, drag-and-drop, the date
 * parser and the arcade into boot (about 300 kB).
 */
export const LAZY_SCREENS = [
  'src/screens/Wallet.tsx', 'src/screens/Chat.tsx', 'src/screens/Settings.tsx',
  'src/screens/Admin.tsx', 'src/screens/PeriodLog.tsx', 'src/screens/Warlord.tsx',
  'src/components/AssetBarcode.tsx', 'src/components/InviteFamilyModal.tsx',
  'src/components/AddEventModal.tsx', 'src/components/EventDetailsModal.tsx', 'src/components/games/GamesHubModal.tsx',
];

/** Code that must never load at boot, found by a string that survives minification. */
export const HEAVY = [
  { what: 'html5-qrcode (the Wallet scanner)', marker: 'Html5Qrcode' },
  // JsBarcode's own error class, and the QR encoder's (qr.js, under react-qr-code): each was in the
  // boot chunk only, through the event window and the invitation window, until 29.10.2026.
  { what: 'JsBarcode (react-barcode, the card codes)', marker: 'InvalidElementException' },
  { what: 'the QR encoder (react-qr-code)', marker: 'bad rs block' },
  // The attribute every draggable carries, and the tag chrono-node puts on its casual dates: each was in
  // boot through the add and details windows (and the rummy game) until 29.10.2026.
  { what: 'drag-and-drop (@hello-pangea/dnd)', marker: 'data-rfd-draggable-id' },
  { what: 'the date parser (chrono-node)', marker: 'parser/ENCasualDateParser' },
  // A string only each language has (30.10.2026): the four loaded on demand, with English and Romanian
  // left in boot (src/utils/i18n.ts).
  { what: 'French (src/utils/lang/fr-FR.ts)', marker: 'Partager avec le groupe' },
  { what: 'Spanish (src/utils/lang/es-ES.ts)', marker: 'TAREAS PENDIENTES' },
  { what: 'Italian (src/utils/lang/it-IT.ts)', marker: 'Panoramica di oggi' },
  { what: 'German (src/utils/lang/de-DE.ts)', marker: 'AUSSTEHENDE AUFGABEN' },
];

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
