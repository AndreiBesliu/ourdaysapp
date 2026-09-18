// src/utils/barcodeAdoption.test.ts
//
// A saved card's code is drawn in ONE place, and this is what keeps it that way.
//
// ── Why ───────────────────────────────────────────────────────────────────────────────
//
// On 16.09 the wallet stopped guessing how to draw a code and started asking
// `barcodeFormat.ts`, because the old chain mapped four of the seventeen formats the scanner can
// report and sent the rest to CODE128 — including UPC_E, a COMPRESSED UPC-A, which a till reads
// back as a DIFFERENT number than the card holds.
//
// That fix reached one of three call sites. `EventDetailsModal` kept the old chain twice for two
// more days, and one of those two is the copy people actually hold up at a till: the card that
// appears next to "buy milk" on a shopping checklist. Nothing failed, nothing was logged, and
// three green gates said the defect was fixed.
//
// A unit test on the module cannot see that, because the module was never the problem — the
// problem was who ASKED it. So this test asks the source: who draws a barcode?

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const APP = join(__dirname, '..', '..');
const SRC = join(APP, 'src');

/** The one component allowed to draw a saved card's code. */
const RENDERER = 'src/components/AssetBarcode.tsx';

/**
 * QR is also used for something that is NOT a saved card: the invite code you show somebody so
 * they can join a group. That has no `barcodeFormat` and no till, so it is not this test's
 * business — named explicitly rather than pattern-matched, so a new one has to be argued for.
 */
const QR_ELSEWHERE = ['src/components/InviteFamilyModal.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'warlord' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((f) => ({
  rel: f.slice(APP.length + 1).split(sep).join('/'),
  src: readFileSync(f, 'utf8'),
}));

describe('one renderer for a saved card', () => {
  it('finds the source at all, so this cannot pass by finding nothing', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.rel === RENDERER)).toBe(true);
  });

  it('only AssetBarcode imports the barcode library', () => {
    const drawers = files.filter((f) => /from ['"]react-barcode['"]/.test(f.src)).map((f) => f.rel);
    expect(drawers, `these draw a barcode without going through ${RENDERER}`).toEqual([RENDERER]);
  });

  it('only AssetBarcode and the group invite draw a QR', () => {
    const drawers = files.filter((f) => /from ['"]react-qr-code['"]/.test(f.src)).map((f) => f.rel).sort();
    expect(drawers).toEqual([RENDERER, ...QR_ELSEWHERE].sort());
  });

  it('nobody hand-maps a scanner format to a library format any more', () => {
    // The shape of the chain that shipped the defect: a ternary from the scanner's spelling
    // (EAN_13, UPC_A, CODE_39 — underscored) to JsBarcode's (EAN13, UPC, CODE39).
    const offenders = files
      .filter((f) => f.rel !== 'src/utils/barcodeFormat.ts')
      .filter((f) => /['"](?:EAN_13|EAN_8|UPC_A|UPC_E|CODE_39|CODE_93)['"]\s*\?/.test(f.src))
      .map((f) => f.rel);
    expect(offenders, 'hand-rolled symbology mapping; use renderFor via AssetBarcode').toEqual([]);
  });

  it('and the renderer is the only thing that asks barcodeFormat how to draw', () => {
    const askers = files.filter((f) => /\brenderFor\s*\(/.test(f.src)).map((f) => f.rel).sort();
    expect(askers).toEqual([RENDERER, 'src/utils/barcodeFormat.ts'].sort());
  });
});
