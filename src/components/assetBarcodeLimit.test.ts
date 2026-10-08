// src/components/assetBarcodeLimit.test.ts
//
// The most a QR code can hold, measured on the real encoder (08.10.2026). One byte over, react-qr-code
// throws while rendering, and that took down whatever was showing the card: an event a member opened,
// the wallet's code view, the offline Cards page. A shared card's code is anybody's to write, so the
// limit is decided before drawing (barcodeFormat.ts, QR_MAX_BYTES) and the code is shown as text.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCode } from 'react-qr-code';
import AssetBarcode from './AssetBarcode';
import { QR_MAX_BYTES, renderFor } from '../utils/barcodeFormat';

const bytes = (n: number) => 'x'.repeat(n);

describe('a QR code at its limit', () => {
  it('the encoder takes QR_MAX_BYTES and throws one byte later', () => {
    expect(() => renderToStaticMarkup(createElement(QRCode, { value: bytes(QR_MAX_BYTES) }))).not.toThrow();
    expect(() => renderToStaticMarkup(createElement(QRCode, { value: bytes(QR_MAX_BYTES + 1) }))).toThrow();
  });

  it('so a card that long is drawn as its text, and nothing throws', () => {
    expect(renderFor('QR_CODE', bytes(QR_MAX_BYTES))).toEqual({ kind: 'qr' });
    expect(renderFor('QR_CODE', bytes(QR_MAX_BYTES + 1))).toEqual({ kind: 'text', reason: 'not-drawable' });
    // Bytes, not characters: 1477 two-byte letters are 2954 bytes.
    expect(renderFor('QR_CODE', 'ă'.repeat(1477))).toEqual({ kind: 'text', reason: 'not-drawable' });
    const html = renderToStaticMarkup(createElement(AssetBarcode, { value: bytes(QR_MAX_BYTES + 1), format: 'QR_CODE' }));
    expect(html).toContain(bytes(40));
    expect(html).not.toContain('<svg');
  });
});
