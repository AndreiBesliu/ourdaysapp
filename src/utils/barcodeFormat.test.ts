// src/utils/barcodeFormat.test.ts
//
// The one decision in this app where being wrong is worse than doing nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFor, SCANNER_FORMATS } from './barcodeFormat';

describe('the formats the scanner can hand us', () => {
  it('every one of them has a decided answer', () => {
    // The point of the list: adding a format to BarcodeScanner without deciding how to draw it
    // should fail here, rather than falling through to whatever the last `else` happens to be —
    // which is exactly how UPC_E came to be drawn as Code 128.
    for (const f of SCANNER_FORMATS) {
      const r = renderFor(f, '12345670');
      expect(['qr', 'barcode', 'text'], `${f} has no decision`).toContain(r.kind);
    }
  });

  it('matches the list the scanner is actually configured with', () => {
    // Read from the component, so the two cannot drift apart silently. html5-qrcode takes numeric
    // format ids with the NAME in a trailing comment; this counts the commented names.
    const src = readFileSync(join(process.cwd(), 'src/components/BarcodeScanner.tsx'), 'utf8');
    const block = src.slice(src.indexOf('formatsToSupport'), src.indexOf('formatsToSupport') + 900);
    for (const f of SCANNER_FORMATS) {
      expect(block, `${f} is not in the scanner's list any more`).toContain(f);
    }
  });
});

describe('drawing a card as the code it actually is', () => {
  it('draws the two everybody in this database has, exactly as before', () => {
    // 7 EAN-13 and 3 UPC-A on live, and they were the two the old mapping got right. This change
    // must not move them.
    expect(renderFor('EAN_13', '5901234123457')).toEqual({ kind: 'barcode', format: 'EAN13' });
    expect(renderFor('UPC_A', '036000291452')).toEqual({ kind: 'barcode', format: 'UPC' });
  });

  it('draws UPC_E as UPC_E rather than as Code 128', () => {
    // THE defect. A UPC-E symbol is a compressed UPC-A: read as Code 128 those eight digits are
    // just eight digits, while the symbol they came from expands to twelve. Different number, same
    // card, and nothing on screen says so.
    expect(renderFor('UPC_E', '01234565')).toEqual({ kind: 'barcode', format: 'UPCE' });
  });

  it('draws the other four the library supports and the old code did not', () => {
    expect(renderFor('CODE_93', 'ABC123')).toEqual({ kind: 'barcode', format: 'CODE93' });
    expect(renderFor('ITF', '123456')).toEqual({ kind: 'barcode', format: 'ITF' });
    expect(renderFor('CODABAR', 'A12345B')).toEqual({ kind: 'barcode', format: 'codabar' });
    expect(renderFor('CODE_39', 'ABC-123')).toEqual({ kind: 'barcode', format: 'CODE39' });
  });

  it('sends QR to the QR renderer, however the format is spelled', () => {
    expect(renderFor('QR_CODE', 'https://example.test').kind).toBe('qr');
    expect(renderFor('qr_code', 'x').kind).toBe('qr');
  });
});

describe('refusing to draw something that is not the card', () => {
  it('shows the number for 2D codes that cannot be a row of bars', () => {
    for (const f of ['AZTEC', 'DATA_MATRIX', 'PDF_417', 'MAXICODE']) {
      expect(renderFor(f, '12345678'), f).toEqual({ kind: 'text', reason: 'not-drawable' });
    }
  });

  it('shows the number for GS1 DataBar and for an EAN add-on', () => {
    // No JsBarcode encoder for DataBar; UPC_EAN_EXTENSION is an add-on printed beside another
    // code, never a card of its own.
    for (const f of ['RSS_14', 'RSS_EXPANDED', 'UPC_EAN_EXTENSION']) {
      expect(renderFor(f, '12345678'), f).toEqual({ kind: 'text', reason: 'not-drawable' });
    }
  });

  it('shows the number when the value does not fit its own format', () => {
    // The other way to get a card that helps nobody: JsBarcode refuses the value and renders
    // NOTHING, so the screen is blank and it looks like the app is broken.
    expect(renderFor('EAN_13', '123')).toEqual({ kind: 'text', reason: 'value-mismatch' });
    expect(renderFor('EAN_8', '5901234123457')).toEqual({ kind: 'text', reason: 'value-mismatch' });
    expect(renderFor('UPC_A', 'not-digits')).toEqual({ kind: 'text', reason: 'value-mismatch' });
    expect(renderFor('ITF', '12345')).toEqual({ kind: 'text', reason: 'value-mismatch' }); // odd length
  });

  it('says so for an empty code instead of drawing an empty barcode', () => {
    // Four assets in the live database carry a barcodeValue that is an empty string.
    expect(renderFor('EAN_13', '')).toEqual({ kind: 'text', reason: 'empty' });
    expect(renderFor('EAN_13', '   ')).toEqual({ kind: 'text', reason: 'empty' });
    expect(renderFor(null, null)).toEqual({ kind: 'text', reason: 'empty' });
  });
});

describe('every format this module can name is one the installed library can actually draw', () => {
  // Not a formality. `react-barcode`'s TypeScript typings are STALE — they omit CODE93, which the
  // bundled JsBarcode 3.12.3 supports perfectly well. So the component has to cast past its own
  // types, and a cast is only as good as the thing that checks it. This is that thing: it loads
  // the encoders that will actually run and asks each one whether it can encode a sample. If a
  // dependency upgrade ever drops one, this fails instead of a customer holding up a blank card.
  const SAMPLES: Record<string, string> = {
    CODE128: 'LOYALTY-9931',
    CODE39: 'ABC-123',
    CODE93: 'ABC123',
    EAN13: '5901234123457',
    EAN8: '96385074',
    UPC: '036000291452',
    UPCE: '01234565',
    ITF: '123456',
    codabar: 'A12345B',
  };

  it('each one exists and validates a real value', async () => {
    const mod: any = await import('jsbarcode/bin/barcodes/index.js');
    const encoders = mod.default || mod;
    for (const [format, sample] of Object.entries(SAMPLES)) {
      const Enc = encoders[format]?.default || encoders[format];
      expect(Enc, `the installed JsBarcode has no ${format} encoder`).toBeTruthy();
      const instance = new Enc(sample, {});
      expect(instance.valid(), `${format} refuses ${sample}`).toBe(true);
    }
  });

  it('and the module never names a format outside that set', () => {
    // Walk every scanner format plus the hand-typed case; whatever comes back as a barcode must
    // be one of the names proven above.
    const named = new Set<string>();
    for (const f of [...SCANNER_FORMATS, '', 'UNKNOWN', undefined]) {
      const r = renderFor(f, '5901234123457');
      if (r.kind === 'barcode') named.add(r.format);
      const r2 = renderFor(f, 'A12345B');
      if (r2.kind === 'barcode') named.add(r2.format);
    }
    for (const f of named) expect(Object.keys(SAMPLES)).toContain(f);
  });
});

describe('cards that were typed in rather than scanned', () => {
  it('keep the Code 128 they have always been drawn as', () => {
    // Every card added before the scanner existed has no format. Changing what those draw as
    // would break working cards to fix a bug they do not have.
    expect(renderFor(undefined, 'LOYALTY-9931')).toEqual({ kind: 'barcode', format: 'CODE128' });
    expect(renderFor('', '123456')).toEqual({ kind: 'barcode', format: 'CODE128' });
    expect(renderFor('UNKNOWN', 'abc')).toEqual({ kind: 'barcode', format: 'CODE128' });
  });
});
